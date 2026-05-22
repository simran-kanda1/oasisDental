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
  buildQueueRows,
  type AgeBucketFilter,
  type VisitWeekBucketFilter,
} from '../data/queueRules';
import FollowUpsPage from './FollowUpsPage';
import type { DentrixAppointmentDoc, DentrixPatientDoc } from '../lib/dentrix';
import { PatientProfileTrigger } from '../components/PatientProfileTrigger';
import { QUEUE_ROW_TRACKING_COLLECTION, queueTrackingDocId } from '../lib/queueRowTracking';
import type { QueueRowTrackingDoc } from '../lib/queueRowTracking';
import { NOT_REBOOKED_REASON_OPTIONS } from '../lib/notRebookedReasons';
import { Textarea } from '../components/ui/textarea';
import {
  PATIENT_REFERRAL_LINK_COLLECTIONS,
  REFERRAL_PROGRESS_TRACKING_COLLECTION,
  REFERRAL_TYPE_DOCTOR_OR_SOURCE,
  buildReferralDoctorQueueRows,
  type DentrixPatientReferralLinkDoc,
  type DentrixReferralDoc,
  type ReferralProgressTrackingDoc,
} from '../lib/referralDoctorQueue';

const REFERRAL_DOCTOR_QUEUE_ID = 'referral_doctor_followup';

const AGE_OPTIONS: { id: AgeBucketFilter; label: string }[] = [
  { id: 'all', label: 'All dates' },
  { id: '0-3', label: 'Up to 3 mo' },
  { id: '3-6', label: '3–6 mo' },
  { id: '6-9', label: '6–9 mo' },
  { id: '9-12', label: '9–12 mo' },
  { id: '12+', label: '12 mo +' },
];

const WEEK_OPTIONS: { id: VisitWeekBucketFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'w1', label: '1 week' },
  { id: 'w2', label: '2 weeks' },
  { id: 'w3', label: '3 weeks' },
  { id: 'w4plus', label: '4+ weeks' },
];

const USE_WEEK_FILTER = new Set(['emerg_follow_up', 'new_patient_follow_up']);

type ReferralProgressFilter = 'all' | 'needs_update';

export interface FrontDeskQueuesPageProps {
  /** Opens a specific queue (e.g. no appt booked when arriving from legacy nav). */
  initialQueueId?: string;
}

const FrontDeskQueuesPage: React.FC<FrontDeskQueuesPageProps> = ({ initialQueueId }) => {
  const [activeId, setActiveId] = useState(initialQueueId ?? FRONT_DESK_QUEUE_DEFS[0].id);

  useEffect(() => {
    if (initialQueueId) setActiveId(initialQueueId);
  }, [initialQueueId]);
  const [ageBucket, setAgeBucket] = useState<AgeBucketFilter>('all');
  const [visitWeekBucket, setVisitWeekBucket] = useState<VisitWeekBucketFilter>('all');
  const [referralProgressFilter, setReferralProgressFilter] = useState<ReferralProgressFilter>('needs_update');
  const [appointments, setAppointments] = useState<DentrixAppointmentDoc[]>([]);
  const [patientsById, setPatientsById] = useState<Record<string, DentrixPatientDoc>>({});
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

  useEffect(() => {
    const unsubA = onSnapshot(
      query(collection(db, 'appointments'), orderBy('appointment_date', 'desc'), limit(5000)),
      (snap) => {
        setAppointments(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc)));
        setLoading(false);
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
    const unsubT = onSnapshot(collection(db, QUEUE_ROW_TRACKING_COLLECTION), (snap) => {
      const map: Record<string, QueueRowTrackingDoc> = {};
      snap.docs.forEach((d) => {
        map[d.id] = { ...(d.data() as QueueRowTrackingDoc), appointmentId: d.id };
      });
      setTrackingByApptId(map);
    });
    return () => {
      unsubA();
      unsubP();
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
      appointments,
      patientsById,
      0,
      new Date(),
      ageBucket,
      USE_WEEK_FILTER.has(activeId) ? visitWeekBucket : 'all'
    );
  }, [activeId, appointments, patientsById, ageBucket, visitWeekBucket]);

  const patientReferralLinks = useMemo(
    () => PATIENT_REFERRAL_LINK_COLLECTIONS.flatMap((c) => patientReferralLinksByCol[c] ?? []),
    [patientReferralLinksByCol]
  );

  const referralRows = useMemo(
    () => buildReferralDoctorQueueRows(patientsById, doctorReferrals, patientReferralLinks),
    [patientsById, doctorReferrals, patientReferralLinks]
  );

  const filteredReferralRows = useMemo(() => {
    if (referralProgressFilter === 'all') return referralRows;
    return referralRows.filter((row) => {
      const tr = referralProgressByDocId[row.progressDocId];
      return tr?.referrerUpdatedOnProgress !== true;
    });
  }, [referralRows, referralProgressByDocId, referralProgressFilter]);

  const activeDef =
    activeId === NO_APPT_BOOKED_QUEUE_ID
      ? NO_APPT_BOOKED_QUEUE_DEF
      : FRONT_DESK_QUEUE_DEFS.find((d) => d.id === activeId);
  const isNoApptBookedQueue = activeId === NO_APPT_BOOKED_QUEUE_ID;
  const showAgeFilter =
    !isNoApptBookedQueue &&
    activeId !== 'no_shows_past_week' &&
    !USE_WEEK_FILTER.has(activeId) &&
    activeId !== REFERRAL_DOCTOR_QUEUE_ID;
  const showWeekFilter = USE_WEEK_FILTER.has(activeId);
  const isReferralQueue = activeId === REFERRAL_DOCTOR_QUEUE_ID;

  const persistTracking = useCallback(
    async (appointmentFirestoreId: string, patientId: string, patch: Partial<QueueRowTrackingDoc>) => {
      setSavingApptId(appointmentFirestoreId);
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
      setSavingApptId(null);
    },
    [activeId]
  );

  const persistReferralProgress = useCallback(
    async (row: { progressDocId: string; patientId: string; referralRefId: number }, patch: Partial<ReferralProgressTrackingDoc>) => {
      setSavingRefDocId(row.progressDocId);
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
      setSavingRefDocId(null);
    },
    []
  );

  const reasonDisabled = (rebooked: boolean | undefined) => activeId === 'no_shows_past_week' && rebooked === true;

  const showMainLoader = isNoApptBookedQueue ? false : isReferralQueue ? !referralsReady : loading;

  if (!activeDef) {
    return null;
  }

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-3rem)] bg-slate-50/80 font-sans">
      <aside className="w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 bg-white p-3 overflow-y-auto max-h-[36vh] md:max-h-none">
        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-2 mb-2">No future appointments</p>
        <nav className="space-y-0.5">
          <button
            type="button"
            onClick={() => setActiveId(NO_APPT_BOOKED_QUEUE_ID)}
            className={cn(
              'w-full text-left px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-colors',
              activeId === NO_APPT_BOOKED_QUEUE_ID
                ? 'bg-teal-50 text-teal-800 border border-teal-100'
                : 'text-slate-600 hover:bg-slate-50 border border-transparent'
            )}
          >
            {NO_APPT_BOOKED_QUEUE_DEF.label}
          </button>
          {FRONT_DESK_QUEUE_DEFS.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setActiveId(q.id)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-colors',
                activeId === q.id ? 'bg-teal-50 text-teal-800 border border-teal-100' : 'text-slate-600 hover:bg-slate-50 border border-transparent'
              )}
            >
              {q.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        {isNoApptBookedQueue ? (
          <FollowUpsPage embedded />
        ) : (
        <>
        <div className="mb-4 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">{activeDef.label}</h1>
            <p className="text-[11px] text-slate-500 mt-1 max-w-3xl">{activeDef.description}</p>
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
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm overflow-x-auto">
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
                {filteredReferralRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-12 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">
                      {referralRows.length === 0
                        ? 'No rows: sync patient↔referrer links (e.g. sp_getpatientreferrals) into Firestore as patient_referrals with patient_id + referral_id, and/or set referred_by_ref_id on patients. Doctor sources must have ref_type = 1 in referrals.'
                        : 'No rows for this filter'}
                    </td>
                  </tr>
                ) : (
                  filteredReferralRows.map((row) => {
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
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[1100px]">
              <thead>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queueRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={activeId === 'no_shows_past_week' ? 6 : 7}
                      className="p-12 text-center text-xs text-slate-400 font-bold uppercase tracking-widest"
                    >
                      No rows for this queue / filter
                    </td>
                  </tr>
                ) : (
                  queueRows.map((row) => {
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
                            </td>
                            <td className="p-3 text-xs text-slate-500">{row.provider ?? '—'}</td>
                          </>
                        )}
                        <td className="p-3">
                          <select
                            className="w-full max-w-[160px] h-9 rounded-md border border-slate-200 text-[10px] font-bold uppercase bg-white disabled:opacity-40"
                            disabled={reasonDisabled(row.rebooked) || savingApptId === row.appointmentFirestoreId}
                            value={tr?.notRebookedReason ?? ''}
                            onChange={(e) =>
                              persistTracking(row.appointmentFirestoreId, row.patientId, {
                                notRebookedReason: e.target.value || undefined,
                              })
                            }
                          >
                            {NOT_REBOOKED_REASON_OPTIONS.map((o) => (
                              <option key={o.value || 'empty'} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
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
                          <button
                            type="button"
                            className="mt-1 text-[9px] font-black uppercase text-teal-700 hover:underline disabled:opacity-40"
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
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
        </>
        )}
      </main>
    </div>
  );
};

export default FrontDeskQueuesPage;
