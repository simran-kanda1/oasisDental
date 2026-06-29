import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  doc,
  setDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import {
  FRONT_DESK_QUEUE_DEFS,
  GA_ALL_APPOINTMENTS_QUEUE_ID,
  GA_TIME_FILTER_OPTIONS,
  NO_APPT_BOOKED_QUEUE_DEF,
  NO_APPT_BOOKED_QUEUE_ID,
  buildQueueIndexes,
  buildQueueRowCount,
  buildQueueRows,
  getFrontDeskQueueDef,
  isStandaloneFrontDeskQueue,
  queueRequiresLedgerForDisplay,
  type AgeBucketFilter,
  type GaAppointmentTimeFilter,
  type QueueBuildContext,
  type QueueRow,
  type VisitWeekBucketFilter,
} from '../data/queueRules';
import { getQueueCodeRulesLabel } from '../lib/queueProcedureCodes';
import FollowUpsPage from './FollowUpsPage';
import { PatientProfileTrigger } from '../components/PatientProfileTrigger';
import { QUEUE_ROW_TRACKING_COLLECTION, queueTrackingDocId } from '../lib/queueRowTracking';
import type { QueueRowTrackingDoc } from '../lib/queueRowTracking';
import { getNotRebookedReasonOptionsForQueue, queueReasonRemovalPatch } from '../lib/notRebookedReasons';
import { Search } from 'lucide-react';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { useNavBadges } from '../contexts/NavBadgeContext';
import { useFrontDeskData } from '../contexts/FrontDeskDataContext';
import { DEFAULT_AGE_BUCKET, DEFAULT_WEEK_BUCKET } from '../lib/navBadgeCounts';
import { format } from 'date-fns';

const AGE_OPTIONS: { id: AgeBucketFilter; label: string }[] = [
  { id: 'all', label: 'All dates' },
  { id: '0-1', label: '0–1 mo' },
  { id: '1-3', label: '1–3 mo' },
  { id: '3-6', label: '3–6 mo' },
  { id: '6-9', label: '6–9 mo' },
  { id: '9-12', label: '9–12 mo' },
  { id: '12+', label: '1+ yr' },
];

const WEEK_OPTIONS: { id: VisitWeekBucketFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'w1', label: '1 week' },
  { id: 'w2', label: '2 weeks' },
  { id: 'w3', label: '3 weeks' },
  { id: 'w4plus', label: '4+ weeks' },
];

const USE_WEEK_FILTER = new Set(['emerg_follow_up', 'new_patient_follow_up']);

const HIDE_MONTHS_AGO_QUEUES = new Set(['extraction']);

function trackingYesNoValue(value: boolean | undefined): '' | 'yes' | 'no' {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return '';
}

function parseTrackingYesNo(value: string): boolean | undefined {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return undefined;
}

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
  const {
    allAppointments,
    patientsById,
    patientInfoById,
    procedureCodes,
    trackingByApptId,
    ledgerByPatientId,
    appointmentsLoading,
    ledgerLoading,
  } = useFrontDeskData();
  const resolvedInitialQueueId =
    initialQueueId && getFrontDeskQueueDef(initialQueueId) ? initialQueueId : FRONT_DESK_QUEUE_DEFS[0].id;
  const [activeId, setActiveId] = useState(resolvedInitialQueueId);

  useEffect(() => {
    if (initialQueueId && getFrontDeskQueueDef(initialQueueId)) setActiveId(initialQueueId);
  }, [initialQueueId]);
  const [ageBucket, setAgeBucket] = useState<AgeBucketFilter>(DEFAULT_AGE_BUCKET);
  const [visitWeekBucket, setVisitWeekBucket] = useState<VisitWeekBucketFilter>(DEFAULT_WEEK_BUCKET);
  const [gaTimeFilter, setGaTimeFilter] = useState<GaAppointmentTimeFilter>('past');
  const [noteDraftByApptId, setNoteDraftByApptId] = useState<Record<string, string>>({});
  const [savingApptId, setSavingApptId] = useState<string | null>(null);
  const [saveNoticeApptId, setSaveNoticeApptId] = useState<string | null>(null);
  const [sectionSearch, setSectionSearch] = useState('');

  const queueBuildCtx = useMemo<QueueBuildContext>(
    () => ({
      procedureCodes,
      ledgerByPatientId,
      trackingByApptId,
      patientInfoById,
      gaTimeFilter: activeId === GA_ALL_APPOINTMENTS_QUEUE_ID ? gaTimeFilter : undefined,
    }),
    [procedureCodes, ledgerByPatientId, trackingByApptId, patientInfoById, activeId, gaTimeFilter]
  );

  const sharedIndexes = useMemo(
    () => buildQueueIndexes(allAppointments, queueBuildCtx, patientsById),
    [allAppointments, queueBuildCtx, patientsById]
  );

  const queueRows = useMemo(() => {
    if (activeId === NO_APPT_BOOKED_QUEUE_ID) return [];
    return buildQueueRows(
      activeId,
      allAppointments,
      patientsById,
      0,
      new Date(),
      ageBucket,
      USE_WEEK_FILTER.has(activeId) ? visitWeekBucket : 'all',
      queueBuildCtx,
      sharedIndexes
    );
  }, [activeId, allAppointments, patientsById, ageBucket, visitWeekBucket, queueBuildCtx, sharedIndexes]);

  const sectionSearchTrimmed = sectionSearch.trim();
  const displayedQueueRows = useMemo(
    () => queueRows.filter((row) => queueRowMatchesSearch(row, sectionSearch)),
    [queueRows, sectionSearch]
  );

  useEffect(() => {
    setSectionSearch('');
  }, [activeId]);

  const useBadgeHubCounts =
    ageBucket === DEFAULT_AGE_BUCKET &&
    visitWeekBucket === DEFAULT_WEEK_BUCKET &&
    !appointmentsLoading;

  const localQueueCounts = useMemo(() => {
    const counts: Record<string, number> = {
      [NO_APPT_BOOKED_QUEUE_ID]: frontDeskByQueue[NO_APPT_BOOKED_QUEUE_ID] ?? 0,
    };
    if (useBadgeHubCounts) {
      for (const q of FRONT_DESK_QUEUE_DEFS) {
        counts[q.id] = frontDeskByQueue[q.id] ?? 0;
      }
      return counts;
    }

    const now = new Date();
    for (const q of FRONT_DESK_QUEUE_DEFS) {
      counts[q.id] = buildQueueRowCount(
        q.id,
        allAppointments,
        patientsById,
        now,
        'all',
        'all',
        queueBuildCtx,
        sharedIndexes
      );
    }
    return counts;
  }, [
    allAppointments,
    patientsById,
    queueBuildCtx,
    sharedIndexes,
    frontDeskByQueue,
    useBadgeHubCounts,
  ]);

  const queueNavCount = (queueId: string) => {
    if (queueId === NO_APPT_BOOKED_QUEUE_ID || FRONT_DESK_QUEUE_DEFS.some((q) => q.id === queueId)) {
      return localQueueCounts[queueId] ?? 0;
    }
    return frontDeskByQueue[queueId] ?? 0;
  };

  const activeDef = getFrontDeskQueueDef(activeId);
  const isNoApptBookedQueue = activeId === NO_APPT_BOOKED_QUEUE_ID;
  const isStandaloneQueue = isStandaloneFrontDeskQueue(activeId);
  const isGaQueue = activeId === GA_ALL_APPOINTMENTS_QUEUE_ID;
  const showGaTimeFilter = isGaQueue;
  const showAgeFilter =
    !isNoApptBookedQueue &&
    activeId !== 'no_shows_past_week' &&
    !USE_WEEK_FILTER.has(activeId) &&
    (!isGaQueue || gaTimeFilter !== 'upcoming_4mo');
  const showWeekFilter = USE_WEEK_FILTER.has(activeId);

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

  const reasonOptions = getNotRebookedReasonOptionsForQueue(activeId);
  const reasonDisabled = (rebooked: boolean | undefined) => activeId === 'no_shows_past_week' && rebooked === true;
  const showRootCanalTracking = activeId === 'root_canal';
  const showOrthoTracking = activeId === 'ortho_follow_ups';
  const showGaDepositTaken = isGaQueue;
  const showMonthsAgo =
    activeId !== 'no_shows_past_week' &&
    !showRootCanalTracking &&
    !showOrthoTracking &&
    !HIDE_MONTHS_AGO_QUEUES.has(activeId);
  const showProvider = activeId !== 'no_shows_past_week' && !showRootCanalTracking;
  const statusColumnLabel =
    isGaQueue || showOrthoTracking ? 'Status' : 'Why not rebooked';
  const apptDateColumnLabel = isGaQueue && gaTimeFilter === 'upcoming_4mo' ? 'Appt date' : 'Last appt';

  const showMainLoader = isNoApptBookedQueue ? false : appointmentsLoading;
  const showLedgerPendingBanner = !isNoApptBookedQueue && ledgerLoading;
  const showLedgerSectionLoader =
    !isNoApptBookedQueue && ledgerLoading && queueRequiresLedgerForDisplay(activeId);

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
                {activeId === 'new_patient_follow_up'
                  ? ' (comprehensive/initial consult codes; excludes established patients)'
                  : ''}
              </p>
            ) : null}
          </div>
          {showGaTimeFilter && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Show</span>
              {GA_TIME_FILTER_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setGaTimeFilter(o.id)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[9px] font-bold uppercase border',
                    gaTimeFilter === o.id
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
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
            {showLedgerPendingBanner ? (
              <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wide px-1">
                Updating procedure-linked queues…
              </p>
            ) : null}
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

            {showLedgerSectionLoader ? (
              <div className="p-12 text-center border border-dashed border-slate-200 rounded-md text-xs text-slate-400 font-bold uppercase tracking-widest">
                Loading ledger data for this queue…
              </div>
            ) : displayedQueueRows.length === 0 ? (
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
                  <th className="p-3">{apptDateColumnLabel}</th>
                  {activeId === 'no_shows_past_week' ? (
                    <th className="p-3">Rebooked?</th>
                  ) : showRootCanalTracking ? (
                    <>
                      <th className="p-3">Referred to specialist</th>
                      <th className="p-3">Follow-up appt booked</th>
                    </>
                  ) : showOrthoTracking ? (
                    <th className="p-3">Start treatment</th>
                  ) : showGaDepositTaken ? (
                    <th className="p-3">Deposit taken</th>
                  ) : (
                    <>
                      {showMonthsAgo ? <th className="p-3">Mo ago</th> : null}
                      {showProvider ? <th className="p-3">Provider</th> : null}
                    </>
                  )}
                  <th className="p-3 min-w-[140px]">{statusColumnLabel}</th>
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
                        ) : showRootCanalTracking ? (
                          <>
                            <td className="p-3">
                              <select
                                className="w-full max-w-[88px] h-9 rounded-md border border-slate-200 text-[10px] font-bold uppercase bg-white disabled:opacity-40"
                                disabled={savingApptId === row.appointmentFirestoreId}
                                value={trackingYesNoValue(tr?.referredToSpecialist)}
                                onChange={(e) => {
                                  const next = parseTrackingYesNo(e.target.value);
                                  persistTracking(row.appointmentFirestoreId, row.patientId, {
                                    referredToSpecialist: next,
                                  });
                                }}
                              >
                                <option value="">—</option>
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                              </select>
                            </td>
                            <td className="p-3">
                              <select
                                className="w-full max-w-[88px] h-9 rounded-md border border-slate-200 text-[10px] font-bold uppercase bg-white disabled:opacity-40"
                                disabled={savingApptId === row.appointmentFirestoreId}
                                value={trackingYesNoValue(tr?.followUpAppointmentBooked)}
                                onChange={(e) => {
                                  const next = parseTrackingYesNo(e.target.value);
                                  persistTracking(row.appointmentFirestoreId, row.patientId, {
                                    followUpAppointmentBooked: next,
                                  });
                                }}
                              >
                                <option value="">—</option>
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                              </select>
                            </td>
                          </>
                        ) : showOrthoTracking ? (
                          <td className="p-3">
                            <select
                              className="w-full max-w-[88px] h-9 rounded-md border border-slate-200 text-[10px] font-bold uppercase bg-white disabled:opacity-40"
                              disabled={savingApptId === row.appointmentFirestoreId}
                              value={trackingYesNoValue(tr?.startTreatment)}
                              onChange={(e) => {
                                const next = parseTrackingYesNo(e.target.value);
                                persistTracking(row.appointmentFirestoreId, row.patientId, {
                                  startTreatment: next,
                                });
                              }}
                            >
                              <option value="">—</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </td>
                        ) : showGaDepositTaken ? (
                          <td className="p-3">
                            <select
                              className="w-full max-w-[88px] h-9 rounded-md border border-slate-200 text-[10px] font-bold uppercase bg-white disabled:opacity-40"
                              disabled={savingApptId === row.appointmentFirestoreId}
                              value={trackingYesNoValue(tr?.depositTaken)}
                              onChange={(e) => {
                                const next = parseTrackingYesNo(e.target.value);
                                persistTracking(row.appointmentFirestoreId, row.patientId, {
                                  depositTaken: next,
                                });
                              }}
                            >
                              <option value="">—</option>
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </td>
                        ) : (
                          <>
                            {showMonthsAgo ? (
                              <td className="p-3 text-xs text-slate-600 tabular-nums">
                                {row.monthsSince != null ? `${row.monthsSince} mo` : '—'}
                                {row.recallIntervalMonths != null && (
                                  <p className="text-[9px] text-slate-400 font-bold mt-0.5">
                                    {row.recallIntervalMonths} mo recall
                                    {row.isOverdue ? ' · overdue' : ''}
                                  </p>
                                )}
                              </td>
                            ) : null}
                            {showProvider ? (
                              <td className="p-3 text-xs text-slate-500">{row.provider ?? '—'}</td>
                            ) : null}
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
                                ...queueReasonRemovalPatch(activeId, value),
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
                              {!isGaQueue ? (
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
                              ) : null}
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
