import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  limit,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import {
  FRONT_DESK_QUEUE_DEFS,
  NO_APPT_BOOKED_QUEUE_DEF,
  NO_APPT_BOOKED_QUEUE_ID,
  buildQueueIndexes,
  buildQueueRows,
  getFrontDeskQueueDef,
  isStandaloneFrontDeskQueue,
  type AgeBucketFilter,
  type QueueBuildContext,
  type QueueRow,
  type VisitWeekBucketFilter,
} from '../data/queueRules';
import type { DentrixProcedureCodeDoc } from '../lib/procedureCodeTypes';
import { getQueueCodeRulesLabel } from '../lib/queueProcedureCodes';
import { fetchLedgerForPatients } from '../lib/ledgerTransactions';
import type { DentrixLedgerTransactionDoc } from '../lib/ledgerTransactions';
import FollowUpsPage from './FollowUpsPage';
import type { DentrixAppointmentDoc, DentrixPatientDoc, DentrixPatientAppointmentInfoDoc } from '../lib/dentrix';
import { PatientProfileTrigger } from '../components/PatientProfileTrigger';
import { QUEUE_ROW_TRACKING_COLLECTION, queueTrackingDocId } from '../lib/queueRowTracking';
import type { QueueRowTrackingDoc } from '../lib/queueRowTracking';
import { getNotRebookedReasonOptionsForQueue } from '../lib/notRebookedReasons';
import { APPOINTMENTS_QUERY_LIMIT, FUTURE_APPOINTMENTS_QUERY_LIMIT, mergeAppointmentsById } from '../lib/appointmentsQuery';
import { format, startOfDay } from 'date-fns';
import { Search } from 'lucide-react';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import {
  PATIENT_REFERRAL_LINK_COLLECTIONS,
  REFERRAL_PROGRESS_TRACKING_COLLECTION,
  REFERRAL_TYPE_DOCTOR_OR_SOURCE,
  buildReferralDoctorQueueRows,
  type DentrixPatientReferralLinkDoc,
  type DentrixReferralDoc,
  type ReferralProgressTrackingDoc,
} from '../lib/referralDoctorQueue';
import { useNavBadges } from '../contexts/NavBadgeContext';

const REFERRAL_DOCTOR_QUEUE_ID = 'referral_doctor_followup';

const AGE_OPTIONS: { id: AgeBucketFilter; label: string }[] = [
  { id: 'all', label: 'All dates' },
  { id: '0-1', label: '0–1 mo' },
  { id: '1-3', label: '1–3 mo' },
  { id: '3-6', label: '3–6 mo' },
  { id: '6-9', label: '6–9 mo' },
  { id: '9-12', label: '9–12 mo' },
  { id: '12+', label: '1+ yr' },
];

const LEDGER_PATIENT_CAP = 2500;

const WEEK_OPTIONS: { id: VisitWeekBucketFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'w1', label: '1 week' },
  { id: 'w2', label: '2 weeks' },
  { id: 'w3', label: '3 weeks' },
  { id: 'w4plus', label: '4+ weeks' },
];

const USE_WEEK_FILTER = new Set(['emerg_follow_up', 'new_patient_follow_up']);

type ReferralProgressFilter = 'all' | 'needs_update';

function queueRowMatchesSearch(row: QueueRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    row.patientName,
    row.detail,
    row.dateLabel ?? '',
    row.provider ?? '',
    row.patientId,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function referralRowMatchesSearch(
  row: { patientName: string; patientId: string; referrerDisplay: string; referrerPhone: string; referrerCity: string },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [row.patientName, row.patientId, row.referrerDisplay, row.referrerPhone, row.referrerCity]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export interface FrontDeskQueuesPageProps {
  /** Opens a specific queue (e.g. no appt booked when arriving from legacy nav). */
  initialQueueId?: string;
}

function QueueNavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto min-w-[1.1rem] px-1.5 py-0.5 rounded-full bg-teal-600 text-white text-[9px] font-black text-center">
      {count > 99 ? '99+' : count}
    </span>
  );
}

const FrontDeskQueuesPage: React.FC<FrontDeskQueuesPageProps> = ({ initialQueueId }) => {
  const { frontDeskByQueue } = useNavBadges();
  const [activeId, setActiveId] = useState(initialQueueId ?? FRONT_DESK_QUEUE_DEFS[0].id);

  useEffect(() => {
    if (initialQueueId) setActiveId(initialQueueId);
  }, [initialQueueId]);
  const [ageBucket, setAgeBucket] = useState<AgeBucketFilter>('all');
  const [visitWeekBucket, setVisitWeekBucket] = useState<VisitWeekBucketFilter>('all');
  const [referralProgressFilter, setReferralProgressFilter] = useState<ReferralProgressFilter>('needs_update');
  const [appointments, setAppointments] = useState<DentrixAppointmentDoc[]>([]);
  const [futureAppointments, setFutureAppointments] = useState<DentrixAppointmentDoc[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
  const [patientInfoById, setPatientInfoById] = useState<Record<string, DentrixPatientAppointmentInfoDoc>>({});
  const [doctorReferrals, setDoctorReferrals] = useState<DentrixReferralDoc[]>([]);
  const [patientReferralLinksByCol, setPatientReferralLinksByCol] = useState<
    Record<string, DentrixPatientReferralLinkDoc[]>
  >({});
  const [referralsReady, setReferralsReady] = useState(false);
  const [referralProgressByDocId, setReferralProgressByDocId] = useState<Record<string, ReferralProgressTrackingDoc>>({});
  const [trackingByApptId, setTrackingByApptId] = useState<Record<string, QueueRowTrackingDoc>>({});
  const [noteDraftByApptId, setNoteDraftByApptId] = useState<Record<string, string>>({});
  const [refNoteDraftByDocId, setRefNoteDraftByDocId] = useState<Record<string, string>>({});
  const [savingApptId, setSavingApptId] = useState<string | null>(null);
  const [savingRefDocId, setSavingRefDocId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [procedureCodes, setProcedureCodes] = useState<DentrixProcedureCodeDoc[]>([]);
  const [ledgerByPatientId, setLedgerByPatientId] = useState<Map<number, DentrixLedgerTransactionDoc[]>>(new Map());
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [saveNoticeApptId, setSaveNoticeApptId] = useState<string | null>(null);
  const [sectionSearch, setSectionSearch] = useState('');

  useEffect(() => {
    const unsubProc = onSnapshot(collection(db, 'procedure_codes'), (snap) => {
      setProcedureCodes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixProcedureCodeDoc)));
    });
    return unsubProc;
  }, []);

  const allAppointments = useMemo(
    () => mergeAppointmentsById(appointments, futureAppointments),
    [appointments, futureAppointments]
  );

  useEffect(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const a of allAppointments) {
      const pid = String(a.patient_id ?? '');
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      ids.push(pid);
      if (ids.length >= LEDGER_PATIENT_CAP) break;
    }
    if (!ids.length) {
      setLedgerByPatientId(new Map());
      return;
    }

    let cancelled = false;
    setLedgerLoading(true);
    void fetchLedgerForPatients(ids)
      .then((map) => {
        if (!cancelled) setLedgerByPatientId(map);
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [allAppointments]);

  const queueBuildCtx = useMemo<QueueBuildContext>(
    () => ({ procedureCodes, ledgerByPatientId, trackingByApptId, patientInfoById }),
    [procedureCodes, ledgerByPatientId, trackingByApptId, patientInfoById]
  );

  useEffect(() => {
    const todayStart = format(startOfDay(new Date()), "yyyy-MM-dd'T'00:00:00'Z'");
    const unsubA = onSnapshot(
      query(collection(db, 'appointments'), orderBy('appointment_date', 'desc'), limit(APPOINTMENTS_QUERY_LIMIT)),
      (snap) => {
        setAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc)));
        setLoading(false);
      }
    );
    const unsubFuture = onSnapshot(
      query(
        collection(db, 'appointments'),
        where('appointment_date', '>=', todayStart),
        orderBy('appointment_date', 'asc'),
        limit(FUTURE_APPOINTMENTS_QUERY_LIMIT)
      ),
      (snap) => {
        setFutureAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc)));
      }
    );
    const unsubP = onSnapshot(collection(db, 'patients'), (snap) => {
      const map: Record<string, DentrixPatientDoc> = {};
      snap.docs.forEach((d) => {
        const row = { id: d.id, ...d.data() } as DentrixPatientDoc;
        map[String(row.patient_id ?? row.id)] = row;
      });
      setPatientsById(map);
    });
    const unsubInfo = onSnapshot(collection(db, 'patient_appointment_info'), (snap) => {
      const map: Record<string, DentrixPatientAppointmentInfoDoc> = {};
      snap.docs.forEach((d) => {
        const row = { id: d.id, ...d.data() } as DentrixPatientAppointmentInfoDoc;
        map[String(row.patient_id ?? row.id)] = row;
      });
      setPatientInfoById(map);
    });
    const unsubT = onSnapshot(collection(db, QUEUE_ROW_TRACKING_COLLECTION), (snap) => {
      const map: Record<string, QueueRowTrackingDoc> = {};
      snap.docs.forEach((d) => {
        map[d.id] = { ...(d.data() as QueueRowTrackingDoc), appointmentId: d.id };
      });
      setTrackingByApptId(map);
    });
    return () => {
      unsubA();
      unsubFuture();
      unsubP();
      unsubInfo();
      unsubT();
    };
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, 'referrals'),
      where('ref_type', '==', REFERRAL_TYPE_DOCTOR_OR_SOURCE),
      limit(5000)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setDoctorReferrals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixReferralDoc)));
        setReferralsReady(true);
      },
      () => setReferralsReady(true)
    );
    return unsub;
  }, []);

  useEffect(() => {
    const unsubs = PATIENT_REFERRAL_LINK_COLLECTIONS.map((colName) =>
      onSnapshot(
        collection(db, colName),
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixPatientReferralLinkDoc));
          setPatientReferralLinksByCol((prev) => ({ ...prev, [colName]: rows }));
        },
        () => {
          setPatientReferralLinksByCol((prev) => ({ ...prev, [colName]: [] }));
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, REFERRAL_PROGRESS_TRACKING_COLLECTION), (snap) => {
      const map: Record<string, ReferralProgressTrackingDoc> = {};
      snap.docs.forEach((d) => {
        map[d.id] = { ...(d.data() as ReferralProgressTrackingDoc) };
      });
      setReferralProgressByDocId(map);
    });
    return unsub;
  }, []);

  const queueRows = useMemo(() => {
    if (activeId === REFERRAL_DOCTOR_QUEUE_ID || activeId === NO_APPT_BOOKED_QUEUE_ID) return [];
    return buildQueueRows(
      activeId,
      allAppointments,
      patientsById,
      0,
      new Date(),
      ageBucket,
      USE_WEEK_FILTER.has(activeId) ? visitWeekBucket : 'all',
      queueBuildCtx
    );
  }, [activeId, allAppointments, patientsById, ageBucket, visitWeekBucket, queueBuildCtx]);

  const sectionSearchTrimmed = sectionSearch.trim();
  const displayedQueueRows = useMemo(
    () => queueRows.filter((row) => queueRowMatchesSearch(row, sectionSearch)),
    [queueRows, sectionSearch]
  );

  const patientReferralLinks = useMemo(
    () => PATIENT_REFERRAL_LINK_COLLECTIONS.flatMap((c) => patientReferralLinksByCol[c] ?? []),
    [patientReferralLinksByCol]
  );

  const referralRows = useMemo(
    () => buildReferralDoctorQueueRows(patientsById, doctorReferrals, patientReferralLinks),
    [patientsById, doctorReferrals, patientReferralLinks]
  );

  const referralRowsForFilter = useMemo(() => {
    if (referralProgressFilter === 'all') return referralRows;
    return referralRows.filter((row) => {
      const tr = referralProgressByDocId[row.progressDocId];
      return tr?.referrerUpdatedOnProgress !== true;
    });
  }, [referralRows, referralProgressByDocId, referralProgressFilter]);

  const filteredReferralRows = useMemo(
    () => referralRowsForFilter.filter((row) => referralRowMatchesSearch(row, sectionSearch)),
    [referralRowsForFilter, sectionSearch]
  );

  useEffect(() => {
    setSectionSearch('');
  }, [activeId]);

  const localQueueCounts = useMemo(() => {
    const counts: Record<string, number> = {
      [NO_APPT_BOOKED_QUEUE_ID]: frontDeskByQueue[NO_APPT_BOOKED_QUEUE_ID] ?? 0,
    };
    if (loading || ledgerLoading) {
      for (const q of FRONT_DESK_QUEUE_DEFS) {
        counts[q.id] = frontDeskByQueue[q.id] ?? 0;
      }
      return counts;
    }

    const now = new Date();
    const sharedIndexes = buildQueueIndexes(allAppointments, queueBuildCtx, patientsById);
    for (const q of FRONT_DESK_QUEUE_DEFS) {
      counts[q.id] = buildQueueRows(
        q.id,
        allAppointments,
        patientsById,
        0,
        now,
        'all',
        'all',
        queueBuildCtx,
        sharedIndexes
      ).length;
    }
    return counts;
  }, [allAppointments, patientsById, queueBuildCtx, loading, ledgerLoading, frontDeskByQueue]);

  const queueNavCount = (queueId: string) => {
    if (queueId === REFERRAL_DOCTOR_QUEUE_ID) {
      return referralRows.length;
    }
    if (queueId === NO_APPT_BOOKED_QUEUE_ID || FRONT_DESK_QUEUE_DEFS.some((q) => q.id === queueId)) {
      return localQueueCounts[queueId] ?? 0;
    }
    return frontDeskByQueue[queueId] ?? 0;
  };

  const activeDef = getFrontDeskQueueDef(activeId);
  const isNoApptBookedQueue = activeId === NO_APPT_BOOKED_QUEUE_ID;
  const isStandaloneQueue = isStandaloneFrontDeskQueue(activeId);
  const showAgeFilter =
    !isNoApptBookedQueue &&
    activeId !== 'no_shows_past_week' &&
    !USE_WEEK_FILTER.has(activeId) &&
    activeId !== REFERRAL_DOCTOR_QUEUE_ID;
  const showWeekFilter = USE_WEEK_FILTER.has(activeId);
  const isReferralQueue = activeId === REFERRAL_DOCTOR_QUEUE_ID;

  const flashQueueSaveNotice = useCallback((appointmentFirestoreId: string) => {
    setSaveNoticeApptId(appointmentFirestoreId);
    window.setTimeout(() => {
      setSaveNoticeApptId((prev) => (prev === appointmentFirestoreId ? null : prev));
    }, 2500);
  }, []);

  const persistTracking = useCallback(
    async (appointmentFirestoreId: string, patientId: string, patch: Partial<QueueRowTrackingDoc>) => {
      setSavingApptId(appointmentFirestoreId);
      try {
        const id = queueTrackingDocId(appointmentFirestoreId);
        await setDoc(
          doc(db, QUEUE_ROW_TRACKING_COLLECTION, id),
          {
            appointmentId: id,
            patientId,
            queueId: activeId,
            updatedAt: new Date().toISOString(),
            ...patch,
          },
          { merge: true }
        );
        flashQueueSaveNotice(appointmentFirestoreId);
      } finally {
        setSavingApptId(null);
      }
    },
    [activeId, flashQueueSaveNotice]
  );

  const persistReferralProgress = useCallback(
    async (row: { progressDocId: string; patientId: string; referralRefId: number }, patch: Partial<ReferralProgressTrackingDoc>) => {
      setSavingRefDocId(row.progressDocId);
      try {
        await setDoc(
          doc(db, REFERRAL_PROGRESS_TRACKING_COLLECTION, row.progressDocId),
          {
            patientId: row.patientId,
            referralRefId: row.referralRefId,
            updatedAt: new Date().toISOString(),
            ...patch,
          },
          { merge: true }
        );
      } finally {
        setSavingRefDocId(null);
      }
    },
    []
  );

  const reasonOptions = getNotRebookedReasonOptionsForQueue(activeId);
  const reasonDisabled = (rebooked: boolean | undefined) => activeId === 'no_shows_past_week' && rebooked === true;

  const showMainLoader = isNoApptBookedQueue ? false : isReferralQueue ? !referralsReady : loading || ledgerLoading;

  if (!activeDef) {
    return null;
  }

  return (
    <div className={cn('flex min-h-[calc(100vh-3rem)] bg-slate-50/80 font-sans', !isStandaloneQueue && 'flex-col md:flex-row')}>
      {!isStandaloneQueue && (
        <aside className="w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 bg-white p-3 overflow-y-auto max-h-[36vh] md:max-h-none">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-2 mb-2">No future appointments</p>
          <nav className="space-y-0.5">
            <button
              type="button"
              onClick={() => setActiveId(NO_APPT_BOOKED_QUEUE_ID)}
              className={cn(
                'w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-colors',
                activeId === NO_APPT_BOOKED_QUEUE_ID
                  ? 'bg-teal-50 text-teal-800 border border-teal-100'
                  : 'text-slate-600 hover:bg-slate-50 border border-transparent'
              )}
            >
              <span className="truncate">{NO_APPT_BOOKED_QUEUE_DEF.label}</span>
              <QueueNavBadge count={queueNavCount(NO_APPT_BOOKED_QUEUE_ID)} />
            </button>
            {FRONT_DESK_QUEUE_DEFS.map((q) => (
              <button
                key={q.id}
                type="button"
                title={getQueueCodeRulesLabel(q.id) ? `ADA: ${getQueueCodeRulesLabel(q.id)}` : undefined}
                onClick={() => setActiveId(q.id)}
                className={cn(
                  'w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-colors',
                  activeId === q.id ? 'bg-teal-50 text-teal-800 border border-teal-100' : 'text-slate-600 hover:bg-slate-50 border border-transparent'
                )}
              >
                <span className="truncate">{q.label}</span>
                <QueueNavBadge count={queueNavCount(q.id)} />
              </button>
            ))}
          </nav>
        </aside>
      )}
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        {isNoApptBookedQueue ? (
          <FollowUpsPage embedded />
        ) : (
        <>
        <div className="mb-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">{activeDef.label}</h1>
            <p className="text-[11px] text-slate-500 mt-1 max-w-3xl">{activeDef.description}</p>
            {getQueueCodeRulesLabel(activeId) ? (
              <p className="text-[10px] font-bold text-teal-800 mt-2 font-mono tracking-tight">
                ADA codes: {getQueueCodeRulesLabel(activeId)}
                {activeId === 'new_patient_follow_up' ? ' (plus appointment text match)' : ''}
              </p>
            ) : null}
          </div>
          {isReferralQueue && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Show</span>
              {(
                [
                  { id: 'needs_update' as const, label: 'Needs update' },
                  { id: 'all' as const, label: 'All' },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setReferralProgressFilter(o.id)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[9px] font-bold uppercase border',
                    referralProgressFilter === o.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {showWeekFilter && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Since last visit</span>
              {WEEK_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setVisitWeekBucket(o.id)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[9px] font-bold uppercase border',
                    visitWeekBucket === o.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {showAgeFilter && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Last visit</span>
              {AGE_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setAgeBucket(o.id)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[9px] font-bold uppercase border',
                    ageBucket === o.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {showMainLoader ? (
          <div className="p-24 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">Loading…</div>
        ) : isReferralQueue ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative flex-1 max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search this section: patient, referrer, phone, city…"
                  value={sectionSearch}
                  onChange={(e) => setSectionSearch(e.target.value)}
                  className="h-10 pl-9 text-xs font-bold border-slate-200"
                  aria-label="Search referrals"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {sectionSearchTrimmed ? (
                  <>
                    <span className="text-[10px] font-bold text-slate-500 tabular-nums">
                      {filteredReferralRows.length} of {referralRowsForFilter.length} in this section
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-[10px] font-black uppercase"
                      onClick={() => setSectionSearch('')}
                    >
                      Clear
                    </Button>
                  </>
                ) : (
                  <span className="text-[10px] font-bold text-slate-400">
                    {referralRowsForFilter.length} referral{referralRowsForFilter.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>
            {filteredReferralRows.length === 0 ? (
              <div className="p-12 text-center border border-dashed border-slate-200 rounded-md text-xs text-slate-400 font-bold uppercase tracking-widest">
                {referralRowsForFilter.length === 0
                  ? 'No rows: sync patient↔referrer links (e.g. sp_getpatientreferrals) into Firestore as patient_referrals with patient_id + referral_id, and/or set referred_by_ref_id on patients. Doctor sources must have ref_type = 1 in referrals.'
                  : sectionSearchTrimmed
                    ? 'No referrals match your search'
                    : 'No rows for this filter'}
              </div>
            ) : (
          <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[960px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <th className="p-3 pl-4">
                    Patient
                    <span className="block font-normal normal-case text-[9px] text-slate-400 tracking-normal mt-0.5">
                      Tap for contact card
                    </span>
                  </th>
                  <th className="p-3">Referring doctor / source</th>
                  <th className="p-3">Contact</th>
                  <th className="p-3 min-w-[160px]">Referrer updated?</th>
                  <th className="p-3 pr-4 min-w-[220px]">Progress notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                  {filteredReferralRows.map((row) => {
                    const tr = referralProgressByDocId[row.progressDocId];
                    const draftKey = row.progressDocId;
                    const noteVal =
                      refNoteDraftByDocId[draftKey] !== undefined ? refNoteDraftByDocId[draftKey] : (tr?.notes ?? '');
                    return (
                      <tr key={row.progressDocId} className="hover:bg-slate-50/80 align-top">
                        <td className="p-3 pl-4 font-bold text-slate-900">
                          <PatientProfileTrigger patientId={row.patientId} className="font-bold">
                            {row.patientName}
                          </PatientProfileTrigger>
                          <p className="text-[10px] font-bold text-slate-400 uppercase mt-1 pointer-events-none">
                            ID {row.patientId} · Ref #{row.referralRefId}
                          </p>
                        </td>
                        <td className="p-3 text-xs text-slate-800 font-semibold">{row.referrerDisplay}</td>
                        <td className="p-3 text-xs text-slate-600">
                          {row.referrerPhone ? <p className="tabular-nums">{row.referrerPhone}</p> : <span className="text-slate-400">—</span>}
                          {row.referrerCity ? <p className="text-[10px] text-slate-500 mt-1">{row.referrerCity}</p> : null}
                        </td>
                        <td className="p-3">
                          <select
                            className="w-full max-w-[180px] h-9 rounded-md border border-slate-200 text-[10px] font-bold uppercase bg-white disabled:opacity-40"
                            disabled={savingRefDocId === row.progressDocId}
                            value={tr?.referrerUpdatedOnProgress === true ? 'yes' : 'no'}
                            onChange={(e) =>
                              persistReferralProgress(row, {
                                referrerUpdatedOnProgress: e.target.value === 'yes',
                              })
                            }
                          >
                            <option value="no">Not yet</option>
                            <option value="yes">Updated referrer</option>
                          </select>
                        </td>
                        <td className="p-3 pr-4">
                          <Textarea
                            rows={2}
                            className="text-[11px] min-h-[52px] resize-y"
                            disabled={savingRefDocId === row.progressDocId}
                            value={noteVal}
                            onChange={(e) =>
                              setRefNoteDraftByDocId((prev) => ({ ...prev, [draftKey]: e.target.value }))
                            }
                            placeholder="What you told the referrer, or next step…"
                          />
                          <button
                            type="button"
                            className="mt-1 text-[9px] font-black uppercase text-teal-700 hover:underline disabled:opacity-40"
                            disabled={savingRefDocId === row.progressDocId}
                            onClick={() =>
                              persistReferralProgress(row, {
                                notes: noteVal.trim() || undefined,
                              }).then(() =>
                                setRefNoteDraftByDocId((prev) => {
                                  const next = { ...prev };
                                  delete next[draftKey];
                                  return next;
                                })
                              )
                            }
                          >
                            Save notes
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative flex-1 max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search this section: patient, detail, provider, date…"
                  value={sectionSearch}
                  onChange={(e) => setSectionSearch(e.target.value)}
                  className="h-10 pl-9 text-xs font-bold border-slate-200"
                  aria-label="Search queue"
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {sectionSearchTrimmed ? (
                  <>
                    <span className="text-[10px] font-bold text-slate-500 tabular-nums">
                      {displayedQueueRows.length} of {queueRows.length} in this section
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-[10px] font-black uppercase"
                      onClick={() => setSectionSearch('')}
                    >
                      Clear
                    </Button>
                  </>
                ) : (
                  <span className="text-[10px] font-bold text-slate-400">
                    {queueRows.length} row{queueRows.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>

            {displayedQueueRows.length === 0 ? (
              <div className="p-12 text-center border border-dashed border-slate-200 rounded-md text-xs text-slate-400 font-bold uppercase tracking-widest">
                {queueRows.length === 0
                  ? 'No rows for this queue / filter'
                  : 'No rows match your search'}
              </div>
            ) : (
          <div className="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto max-h-[calc(100vh-16rem)] overflow-y-auto bg-white">
            <table className="w-full text-left text-sm min-w-[1100px]">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  <th className="p-3 pl-4">
                    Patient
                    <span className="block font-normal normal-case text-[9px] text-slate-400 tracking-normal mt-0.5">
                      Tap row name for phone and notes
                    </span>
                  </th>
                  <th className="p-3">Detail</th>
                  <th className="p-3">Last appt</th>
                  {activeId === 'no_shows_past_week' ? (
                    <th className="p-3">Rebooked?</th>
                  ) : (
                    <>
                      <th className="p-3">Mo ago</th>
                      <th className="p-3">Provider</th>
                    </>
                  )}
                  <th className="p-3 min-w-[140px]">Why not rebooked</th>
                  <th className="p-3 pr-4 min-w-[200px]">Notes</th>
                  <th className="p-3 pr-4 min-w-[148px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                  {displayedQueueRows.map((row) => {
                    const tr = trackingByApptId[row.appointmentFirestoreId];
                    const draftKey = row.appointmentFirestoreId;
                    const noteVal =
                      noteDraftByApptId[draftKey] !== undefined ? noteDraftByApptId[draftKey] : (tr?.notes ?? '');
                    return (
                      <tr key={row.id} className="hover:bg-slate-50/80 align-top">
                        <td className="p-3 pl-4 font-bold text-slate-900">
                          <PatientProfileTrigger patientId={row.patientId} className="font-bold">
                            {row.patientName}
                          </PatientProfileTrigger>
                        </td>
                        <td className="p-3 text-slate-600 text-xs">{row.detail}</td>
                        <td className="p-3 text-xs text-slate-500 tabular-nums whitespace-nowrap">{row.dateLabel ?? '—'}</td>
                        {activeId === 'no_shows_past_week' ? (
                          <td className="p-3">
                            <span
                              className={cn(
                                'text-[10px] font-black uppercase px-2 py-1 rounded',
                                row.rebooked ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                              )}
                            >
                              {row.rebooked ? 'Rebooked' : 'Not rebooked'}
                            </span>
                          </td>
                        ) : (
                          <>
                            <td className="p-3 text-xs text-slate-600 tabular-nums">
                              {row.monthsSince != null ? `${row.monthsSince} mo` : '—'}
                              {row.recallIntervalMonths != null && (
                                <p className="text-[9px] text-slate-400 font-bold mt-0.5">
                                  {row.recallIntervalMonths} mo recall
                                  {row.isOverdue ? ' · overdue' : ''}
                                </p>
                              )}
                            </td>
                            <td className="p-3 text-xs text-slate-500">{row.provider ?? '—'}</td>
                          </>
                        )}
                        <td className="p-3">
                          <select
                            className="w-full max-w-[160px] h-9 rounded-md border border-slate-200 text-[10px] font-bold uppercase bg-white disabled:opacity-40"
                            disabled={reasonDisabled(row.rebooked) || savingApptId === row.appointmentFirestoreId}
                            value={tr?.notRebookedReason ?? ''}
                            onChange={(e) => {
                              const value = e.target.value;
                              persistTracking(row.appointmentFirestoreId, row.patientId, {
                                notRebookedReason: value || undefined,
                                notRebookedReasonAt: value ? new Date().toISOString() : undefined,
                              });
                            }}
                          >
                            {reasonOptions.map((o) => (
                              <option key={o.value || 'empty'} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          {tr?.notRebookedReason && (tr.notRebookedReasonAt || tr.updatedAt) ? (
                            <p className="text-[9px] text-slate-400 font-bold mt-1 tabular-nums">
                              Updated{' '}
                              {format(
                                new Date(tr.notRebookedReasonAt ?? tr.updatedAt!),
                                'MMM d, yyyy h:mm a'
                              )}
                            </p>
                          ) : null}
                        </td>
                        <td className="p-3 pr-4">
                          <Textarea
                            rows={2}
                            className="text-[11px] min-h-[52px] resize-y"
                            disabled={savingApptId === row.appointmentFirestoreId}
                            value={noteVal}
                            onChange={(e) =>
                              setNoteDraftByApptId((prev) => ({ ...prev, [draftKey]: e.target.value }))
                            }
                            placeholder="Internal notes…"
                          />
                          <div className="mt-1 flex items-center gap-2">
                            <button
                              type="button"
                              className="text-[9px] font-black uppercase text-teal-700 hover:underline disabled:opacity-40"
                              disabled={savingApptId === row.appointmentFirestoreId}
                              onClick={() =>
                                persistTracking(row.appointmentFirestoreId, row.patientId, {
                                  notes: noteVal.trim() || undefined,
                                }).then(() =>
                                  setNoteDraftByApptId((prev) => {
                                    const next = { ...prev };
                                    delete next[draftKey];
                                    return next;
                                  })
                                )
                              }
                            >
                              Save notes
                            </button>
                            {saveNoticeApptId === row.appointmentFirestoreId && (
                              <span className="text-[9px] font-bold text-teal-700 uppercase">Saved</span>
                            )}
                          </div>
                          {tr?.updatedAt && (
                            <p className="text-[9px] text-slate-400 font-bold mt-1">
                              Last updated {format(new Date(tr.updatedAt), 'MMM d, yyyy h:mm a')}
                            </p>
                          )}
                        </td>
                        <td className="p-3 pr-4 align-top">
                            <div className="flex flex-col gap-2 min-w-[132px]">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 w-full text-[9px] font-black uppercase border-teal-300 text-teal-800 hover:bg-teal-50 whitespace-nowrap"
                                disabled={savingApptId === row.appointmentFirestoreId}
                                onClick={() =>
                                  persistTracking(row.appointmentFirestoreId, row.patientId, {
                                    treatmentComplete: true,
                                    treatmentCompleteAt: new Date().toISOString(),
                                  })
                                }
                              >
                                Treatment complete
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 w-full text-[9px] font-black uppercase border-rose-200 text-rose-700 hover:bg-rose-50 whitespace-nowrap"
                                disabled={savingApptId === row.appointmentFirestoreId}
                                onClick={() =>
                                  persistTracking(row.appointmentFirestoreId, row.patientId, {
                                    removedFromList: true,
                                    removedAt: new Date().toISOString(),
                                  })
                                }
                              >
                                Remove
                              </Button>
                            </div>
                          </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
            )}
          </div>
        )}
        </>
        )}
      </main>
    </div>
  );
};

export default FrontDeskQueuesPage;
