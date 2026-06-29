import type { DentrixAppointmentDoc, DentrixPatientDoc, DentrixPatientAppointmentInfoDoc } from '../lib/dentrix';
import { cleanDentrixText, formatDentrixDateKey, parseDentrixDate, isActiveDentrixPatient } from '../lib/dentrix';
import {
  appointmentLabelText,
  isAppointmentCancelledOrBroken,
  isAppointmentOnOrAfterToday,
  isActiveScheduledAppointment,
  isHygieneProductionType,
  isRecallOverdue,
  matchesNewPatientAppointmentText,
  parseHygieneRecallIntervalMonths,
  parseRecallIntervalMonths,
  isScalingPrimaryHygieneVisit,
  isHygieneContinuingCareProductionType,
  isRecallOverdueForHygiene,
} from '../lib/appointmentHeuristics';
import {
  anyCodeMatchesQueue,
  buildAdaByProccodeId,
  getAppointmentProcedureCodes,
  getCompletedLedgerCodesOnAppointment,
  getQueueProcedureConfig,
  type ProcedureCodeLookupCache,
} from '../lib/queueProcedureCodes';
import { buildProcedureCodeByAdaMap } from '../lib/procedureCodeTypes';
import type { DentrixProcedureCodeDoc } from '../lib/procedureCodeTypes';
import type { DentrixLedgerTransactionDoc } from '../lib/ledgerTransactions';
import { ledgerRowIndicatesNoShow } from '../lib/noShowLedger';
import type { QueueRowTrackingDoc } from '../lib/queueRowTracking';
import { queueReasonRemovesFromList } from '../lib/notRebookedReasons';
import { NEW_PATIENT_MAX_MONTHS } from '../lib/appointmentsQuery';
import { addDays, addMonths, differenceInCalendarDays, differenceInCalendarMonths, isAfter, isBefore, isSameDay, startOfDay, subDays } from 'date-fns';

/** Mutually exclusive aging buckets (months since last qualifying visit). */
export type AgeBucketFilter = 'all' | '0-1' | '1-3' | '3-6' | '6-9' | '9-12' | '12+';

/** Recency of last qualifying visit (emerg / new patient queues). */
export type VisitWeekBucketFilter = 'all' | 'w1' | 'w2' | 'w3' | 'w4plus';

/** GA appointments — past visits, upcoming within 4 months, or both. */
export type GaAppointmentTimeFilter = 'past' | 'upcoming_4mo' | 'all';

export const GA_TIME_FILTER_OPTIONS: { id: GaAppointmentTimeFilter; label: string }[] = [
  { id: 'past', label: 'Past' },
  { id: 'upcoming_4mo', label: 'Upcoming 4 mo' },
  { id: 'all', label: 'All' },
];

export const GA_APPOINTMENTS_LOOKAHEAD_MONTHS = 4;

export const GA_ALL_APPOINTMENTS_QUEUE_ID = 'ga_all_appointments' as const;

export interface QueueBuildContext {
  procedureCodes?: DentrixProcedureCodeDoc[];
  ledgerByPatientId?: Map<number, DentrixLedgerTransactionDoc[]>;
  trackingByApptId?: Record<string, QueueRowTrackingDoc>;
  patientInfoById?: Record<string, DentrixPatientAppointmentInfoDoc>;
  gaTimeFilter?: GaAppointmentTimeFilter;
}

/** Built once per queue pass — avoids O(n²) scans and repeated code-map builds. */
export interface QueueBuildIndexes {
  apptsByPatientId: Map<string, DentrixAppointmentDoc[]>;
  procedureCodeCache?: ProcedureCodeLookupCache;
}

export function buildQueueIndexes(
  appointments: DentrixAppointmentDoc[],
  ctx: QueueBuildContext,
  patientsById: Record<string, DentrixPatientDoc> = {}
): QueueBuildIndexes {
  const apptsByPatientId = new Map<string, DentrixAppointmentDoc[]>();
  const addAppt = (key: string, a: DentrixAppointmentDoc) => {
    if (!key) return;
    const list = apptsByPatientId.get(key);
    if (list) list.push(a);
    else apptsByPatientId.set(key, [a]);
  };

  const guidToPatientId = new Map<string, string>();
  for (const p of Object.values(patientsById)) {
    const pid = String(p.patient_id ?? p.id);
    const guid = cleanDentrixText(p.patient_guid);
    if (pid && guid) guidToPatientId.set(guid, pid);
  }

  for (const a of appointments) {
    const keys = new Set<string>();
    const pid = a.patient_id;
    if (pid != null && String(pid) !== '') keys.add(String(pid));
    const guid = cleanDentrixText(a.patient_guid);
    if (guid) {
      keys.add(guid);
      const resolved = guidToPatientId.get(guid);
      if (resolved) keys.add(resolved);
    }
    for (const key of keys) addAppt(key, a);
  }

  const procedureCodes = ctx.procedureCodes ?? [];
  const procedureCodeCache =
    procedureCodes.length > 0
      ? {
          adaIndex: buildProcedureCodeByAdaMap(procedureCodes),
          adaByProccodeId: buildAdaByProccodeId(procedureCodes),
        }
      : undefined;

  return { apptsByPatientId, procedureCodeCache };
}

export interface QueueRow {
  id: string;
  appointmentFirestoreId: string;
  patientId: string;
  patientName: string;
  detail: string;
  dateLabel: string | null;
  provider?: string;
  monthsSince?: number | null;
  recallIntervalMonths?: number | null;
  isOverdue?: boolean;
  rebooked?: boolean;
}

export interface FrontDeskQueueDef {
  id: string;
  label: string;
  description: string;
}

export const NO_APPT_BOOKED_QUEUE_ID = 'no_appt_booked' as const;

export const NO_APPT_BOOKED_QUEUE_DEF: FrontDeskQueueDef = {
  id: NO_APPT_BOOKED_QUEUE_ID,
  label: 'No appt booked',
  description: 'Patients with missed appointment(s) and no next appointment on file — call to rebook.',
};

export const STANDALONE_FRONT_DESK_QUEUE_IDS = [
  'emerg_follow_up',
  'new_patient_follow_up',
  GA_ALL_APPOINTMENTS_QUEUE_ID,
] as const;

export type StandaloneFrontDeskQueueId = (typeof STANDALONE_FRONT_DESK_QUEUE_IDS)[number];

export const STANDALONE_FRONT_DESK_QUEUE_DEFS: FrontDeskQueueDef[] = [
  { id: 'emerg_follow_up', label: 'Emerg patient follow up', description: 'Had emergency visit; removed when any future appointment is booked.' },
  { id: 'new_patient_follow_up', label: 'New patient follow up', description: 'True new-patient or initial consult visit in the last 12 months with no prior visit history and no future NP visit booked.' },
  {
    id: GA_ALL_APPOINTMENTS_QUEUE_ID,
    label: 'GA appointments',
    description:
      'General anesthesia appointments — past visits and upcoming GA within 4 months. Removed when GA is posted in the ledger or marked treatment complete.',
  },
];

export function isStandaloneFrontDeskQueue(queueId: string | undefined): boolean {
  return !!queueId && (STANDALONE_FRONT_DESK_QUEUE_IDS as readonly string[]).includes(queueId);
}

export function getFrontDeskQueueDef(queueId: string): FrontDeskQueueDef | undefined {
  if (queueId === NO_APPT_BOOKED_QUEUE_ID) return NO_APPT_BOOKED_QUEUE_DEF;
  return [...FRONT_DESK_QUEUE_DEFS, ...STANDALONE_FRONT_DESK_QUEUE_DEFS].find((d) => d.id === queueId);
}

export const FRONT_DESK_QUEUE_DEFS: FrontDeskQueueDef[] = [
  {
    id: 'no_shows_past_week',
    label: 'No shows (past week)',
    description: 'Ledger no-show codes (NC000020–NC000022) in the last 7 days; rebooked when an active future appointment exists.',
  },
  { id: 'hygiene_cc', label: 'Hygiene CC', description: 'Had a hygiene-type visit; overdue per recall interval (e.g. 4M) with no future hygiene appointment booked.' },
  { id: 'ortho_follow_ups', label: 'Ortho follow ups', description: 'Had ortho visit; no future ortho appointment booked.' },
  { id: 'cbct', label: 'CBCT', description: 'Had CBCT imaging; no future CBCT-type appointment booked. Removed when CBCT is posted in the ledger.' },
  { id: 'fillings', label: 'Restorative', description: 'Had restorative visit; no future restorative appointment booked. Removed when restorative treatment is posted in the ledger.' },
  { id: 'root_canal', label: 'Root canal', description: 'Had root canal treatment; no future endo appointment booked. Removed when endo treatment is posted in the ledger.' },
  { id: 'perio', label: 'Perio / GG / BB / M', description: 'Had perio-related visit; no future matching appointment booked.' },
  { id: 'implants', label: 'Implants', description: 'Had implant-related visit; no future implant visit booked.' },
  { id: 'bone_grafting', label: 'Bone grafting', description: 'Had bone graft visit; no future matching appointment booked.' },
  { id: 'gum_grafting', label: 'Gum grafting', description: 'Had gum graft visit; no future matching appointment booked.' },
  { id: 'extraction', label: 'Extraction', description: 'Had extraction-related visit; no future extraction visit booked. Removed when extraction is posted in the ledger.' },
  { id: 'night_guard', label: 'Night guard', description: 'Had night guard visit; no future matching appointment booked. Removed when night guard is posted in the ledger.' },
  { id: 'tmj_mri', label: 'TMJ / MRI', description: 'Had TMJ or MRI-referral visit; no future matching appointment booked.' },
];

const TREATMENT_KEYWORD_RE = /\b(crown|cap|extract|implant|root canal|endo|rct|wisdom)\b/i;

function matchesCleaningAppointmentText(label: string): boolean {
  return /\b(prophy|cleaning|adult prophy|child prophy)\b/i.test(label) && !/\bscaling\b/i.test(label);
}

/** 3M–12M recall intervals and continuing-care style labels → hygiene appointment. */
export function isHygieneRecallLabel(label: string): boolean {
  if (
    /\b(hyg|hygiene|prophy|recall|cleaning|perio maint|periodontal maint|comprehensive periodic|re.?care|periodic exam|periodic|polish|continuing care|cc hyg)\b/i.test(
      label
    )
  ) {
    return true;
  }
  if (/\bscaling\b/i.test(label) && /\b(recall|re.?care|continuing care|\d{1,2}\s*m)\b/i.test(label)) {
    return true;
  }
  if (matchesCleaningAppointmentText(label)) return true;
  const interval = parseRecallIntervalMonths(label);
  if (interval !== null && [3, 4, 6, 9, 12].includes(interval) && !TREATMENT_KEYWORD_RE.test(label)) {
    return true;
  }
  return false;
}

const KEYWORD_MATCHERS: Record<string, (s: string) => boolean> = {
  cbct: (s) => /\b(cbct|cone beam|3d imaging|cat scan)\b/i.test(s),
  fillings: (s) => /\b(fill|composite|amalgam|restoration|filling|onlay|inlay)\b/i.test(s),
  root_canal: (s) => /\b(root canal|endodont|rct|pulpectomy|endo tx|endo treatment)\b/i.test(s),
  perio: (s) => /\b(perio|periodont|scaling|root plan|srp|gingiv)\b/i.test(s),
  implants: (s) => /\b(implant|impl\s|osseointegration|abutment|all[\s-]?on[\s-]?4|ao4)\b/i.test(s),
  bone_grafting: (s) => /\b(bone graft|graft|ridge|socket preservation|sinus lift|augmentation)\b/i.test(s),
  gum_grafting: (s) => /\b(gum graft|gingival graft|soft tissue graft|fgg|connective tissue)\b/i.test(s),
  extraction: (s) => /\b(extract|ext\s|extraction|oral surgery|third molar|wisdom)\b/i.test(s),
  ga_all_appointments: (s) => /\b(general anesthesia|ga\b|iv sedation|asleep|deep sedation|anesthesia)\b/i.test(s),
  night_guard: (s) => /\b(night guard|occlusal guard|splint|brux)/i.test(s),
  ortho_follow_ups: (s) =>
    /\b(ortho|orthodont|braces|invisalign|aligner|retainer|clearcorrect|debond|wire change)\b/i.test(s),
  tmj_mri: (s) => /\b(tmj|mri|temporomandibular|magnetic resonance)\b/i.test(s),
  emerg_follow_up: (s) => /\b(emerg|emergency|pain|swelling|walk[\s-]?in)\b/i.test(s),
};

function patientActive(patientsById: Record<string, DentrixPatientDoc>, patientId: string): boolean {
  const p = patientsById[patientId];
  if (!p) return false;
  return isActiveDentrixPatient(p);
}

function monthsSinceAppt(a: DentrixAppointmentDoc, now: Date): number | null {
  const d = parseDentrixDate(a.appointment_date);
  if (!d) return null;
  return differenceInCalendarMonths(startOfDay(now), startOfDay(d));
}

export function daysSincePastAppointment(a: DentrixAppointmentDoc, now: Date): number | null {
  const d = parseDentrixDate(a.appointment_date);
  if (!d) return null;
  const today = startOfDay(now);
  const ap = startOfDay(d);
  if (!isBefore(ap, addDays(today, 1))) return null;
  return differenceInCalendarDays(today, ap);
}

export function matchesVisitWeekBucket(daysSince: number | null, bucket: VisitWeekBucketFilter): boolean {
  if (bucket === 'all') return true;
  if (daysSince === null || daysSince < 0) return false;
  if (bucket === 'w1') return daysSince <= 6;
  if (bucket === 'w2') return daysSince >= 7 && daysSince <= 13;
  if (bucket === 'w3') return daysSince >= 14 && daysSince <= 20;
  if (bucket === 'w4plus') return daysSince >= 21;
  return true;
}

export function matchesAgeBucket(monthsSince: number | null, bucket: AgeBucketFilter): boolean {
  if (bucket === 'all') return true;
  if (monthsSince === null) return false;
  if (bucket === '0-1') return monthsSince >= 0 && monthsSince < 1;
  if (bucket === '1-3') return monthsSince >= 1 && monthsSince < 3;
  if (bucket === '3-6') return monthsSince >= 3 && monthsSince < 6;
  if (bucket === '6-9') return monthsSince >= 6 && monthsSince < 9;
  if (bucket === '9-12') return monthsSince >= 9 && monthsSince < 12;
  if (bucket === '12+') return monthsSince >= 12;
  return true;
}

function apptRow(
  a: DentrixAppointmentDoc,
  patientsById: Record<string, DentrixPatientDoc>,
  now: Date,
  extra?: Partial<QueueRow>
): QueueRow | null {
  const pid = String(a.patient_id ?? '');
  if (!pid || !patientActive(patientsById, pid)) return null;
  const name = cleanDentrixText(a.patient_name) || `Patient #${pid}`;
  const label = appointmentLabelText(a);
  const recallInterval = parseRecallIntervalMonths(label);
  const months = monthsSinceAppt(a, now);
  return {
    id: `${a.id}-${pid}`,
    appointmentFirestoreId: a.id,
    patientId: pid,
    patientName: name,
    detail: cleanDentrixText(a.reason) || cleanDentrixText(a.appointment_type) || 'Appointment',
    dateLabel: formatDentrixDateKey(a.appointment_date),
    provider: cleanDentrixText(a.provider_id) || undefined,
    monthsSince: months,
    recallIntervalMonths: recallInterval,
    isOverdue: recallInterval !== null ? isRecallOverdue(a, now) : undefined,
    ...extra,
  };
}

function getLedgerForPatient(
  patientId: string,
  ctx: QueueBuildContext
): DentrixLedgerTransactionDoc[] {
  const patid = Number(patientId);
  if (!ctx.ledgerByPatientId || !Number.isFinite(patid)) return [];
  return ctx.ledgerByPatientId.get(patid) ?? [];
}

function isTrackingExcluded(
  apptId: string,
  queueId: string,
  ctx: QueueBuildContext
): boolean {
  const tr = ctx.trackingByApptId?.[apptId];
  if (!tr) return false;
  if (tr.removedFromList === true || tr.treatmentComplete === true) return true;
  if (tr.notRebookedReason && queueReasonRemovesFromList(queueId, tr.notRebookedReason)) return true;
  return false;
}

function patientHasAnyFutureAppointmentBooked(
  patientId: string,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes,
  patientsById: Record<string, DentrixPatientDoc>,
  today: Date
): boolean {
  const patientAppts = getPatientAppointments(patientId, indexes, patientsById);
  if (patientAppts.some((x) => isActiveFutureQueueAppointment(x, today))) return true;

  const info = ctx.patientInfoById?.[patientId];
  const nextD = parseDentrixDate(info?.next_appointment_date);
  return !!nextD && isAppointmentOnOrAfterToday(nextD, today);
}

function getPatientAppointments(
  patientId: string,
  indexes: QueueBuildIndexes,
  patientsById: Record<string, DentrixPatientDoc>
): DentrixAppointmentDoc[] {
  const seen = new Set<string>();
  const out: DentrixAppointmentDoc[] = [];
  const keys = new Set<string>([patientId]);
  const patient = patientsById[patientId];
  const guid = cleanDentrixText(patient?.patient_guid);
  if (guid) keys.add(guid);

  for (const key of keys) {
    for (const a of indexes.apptsByPatientId.get(key) ?? []) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}

/** Match queue when ADA codes on the appointment (parsed fields + ledger on visit day) fit the queue range. */
function appointmentMatchesQueueByProcedureCodes(
  appt: DentrixAppointmentDoc,
  queueId: string,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes
): boolean {
  const config = getQueueProcedureConfig(queueId);
  const procedureCodes = ctx.procedureCodes ?? [];
  if (!config || !procedureCodes.length) return false;

  const patid = Number(appt.patient_id);
  const ledger =
    ctx.ledgerByPatientId && Number.isFinite(patid) && ctx.ledgerByPatientId.has(patid)
      ? ctx.ledgerByPatientId.get(patid) ?? []
      : [];

  const codes = getAppointmentProcedureCodes(appt, ledger, procedureCodes, indexes.procedureCodeCache);
  return anyCodeMatchesQueue(codes, queueId);
}

/** Past hygiene CC visit: hygiene production type, or recall-style label plus hygiene ADA codes. */
function appointmentMatchesHygienePast(
  appt: DentrixAppointmentDoc,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes
): boolean {
  if (isHygieneProductionType(appt)) return true;
  if (!isHygieneRecallLabel(appointmentLabelText(appt))) return false;
  return appointmentMatchesQueueByProcedureCodes(appt, 'hygiene_cc', ctx, indexes);
}

/** Qualifying past visit used as the CC anchor (excludes scaling-only rows). */
function appointmentQualifiesAsHygieneCcAnchor(
  appt: DentrixAppointmentDoc,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes
): boolean {
  if (!appointmentMatchesHygienePast(appt, ctx, indexes)) return false;
  if (isScalingPrimaryHygieneVisit(appt)) return false;
  return true;
}

/** Future hygiene booked: production type, continuing care type, recall text, or hygiene codes on the visit. */
function appointmentMatchesHygieneFuture(
  appt: DentrixAppointmentDoc,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes
): boolean {
  if (isHygieneProductionType(appt)) return true;
  if (isHygieneContinuingCareProductionType(appt)) return true;
  if (isHygieneRecallLabel(appointmentLabelText(appt))) return true;
  return appointmentMatchesQueueByProcedureCodes(appt, 'hygiene_cc', ctx, indexes);
}

function appointmentMatchesNewPatient(
  appt: DentrixAppointmentDoc,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes
): boolean {
  const codeMatch = appointmentMatchesQueueByProcedureCodes(appt, 'new_patient_follow_up', ctx, indexes);
  if (codeMatch) return true;
  return matchesNewPatientAppointmentText(appointmentLabelText(appt));
}

function isUpcomingOrTodayAppointment(appt: DentrixAppointmentDoc, today: Date): boolean {
  const d = parseDentrixDate(appt.appointment_date);
  if (!d) return false;
  return !isBefore(startOfDay(d), startOfDay(today));
}

/** GA: posted visits need ADA codes; upcoming scheduled visits also match GA keywords in appointment text. */
function appointmentMatchesGa(
  appt: DentrixAppointmentDoc,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes,
  today = new Date()
): boolean {
  const procedureCodes = ctx.procedureCodes ?? [];
  if (procedureCodes.length > 0) {
    if (appointmentMatchesQueueByProcedureCodes(appt, GA_ALL_APPOINTMENTS_QUEUE_ID, ctx, indexes)) {
      return true;
    }
  }

  if (isUpcomingOrTodayAppointment(appt, today)) {
    const label = appointmentLabelText(appt);
    if (KEYWORD_MATCHERS.ga_all_appointments?.(label)) return true;
  }

  return false;
}

/** Established patients had any visit before the qualifying appointment day. */
function patientHadPriorAppointmentBeforeVisit(
  patientId: string,
  qualifyingAppt: DentrixAppointmentDoc,
  indexes: QueueBuildIndexes,
  patientsById: Record<string, DentrixPatientDoc>
): boolean {
  const visitDate = parseDentrixDate(qualifyingAppt.appointment_date);
  if (!visitDate) return true;

  const visitDay = startOfDay(visitDate);
  return getPatientAppointments(patientId, indexes, patientsById).some((a) => {
    if (a.id === qualifyingAppt.id) return false;
    const d = parseDentrixDate(a.appointment_date);
    if (!d) return false;
    return isBefore(startOfDay(d), visitDay);
  });
}

function appointmentMatchesQueue(
  appt: DentrixAppointmentDoc,
  queueId: string,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes,
  options?: { mode?: AppointmentQueueMatchMode }
): boolean {
  const label = appointmentLabelText(appt);
  const mode = options?.mode ?? 'past_qualifying';

  if (
    queueId !== 'hygiene_cc' &&
    queueId !== GA_ALL_APPOINTMENTS_QUEUE_ID &&
    (isHygieneRecallLabel(label) || isHygieneProductionType(appt))
  ) {
    return false;
  }

  if (queueId === 'hygiene_cc') {
    return mode === 'future_booked'
      ? appointmentMatchesHygieneFuture(appt, ctx, indexes)
      : appointmentMatchesHygienePast(appt, ctx, indexes);
  }

  if (queueId === 'new_patient_follow_up') {
    return appointmentMatchesNewPatient(appt, ctx, indexes);
  }

  if (queueId === GA_ALL_APPOINTMENTS_QUEUE_ID) {
    return appointmentMatchesGa(appt, ctx, indexes);
  }

  const config = getQueueProcedureConfig(queueId);
  const procedureCodes = ctx.procedureCodes ?? [];

  if (config) {
    if (!procedureCodes.length) return false;
    return appointmentMatchesQueueByProcedureCodes(appt, queueId, ctx, indexes);
  }

  if (queueId === 'emerg_follow_up') {
    return KEYWORD_MATCHERS.emerg_follow_up?.(label) ?? false;
  }

  return KEYWORD_MATCHERS[queueId]?.(label) ?? false;
}

function isActiveFutureQueueAppointment(
  appt: DentrixAppointmentDoc,
  today: Date
): boolean {
  const d = parseDentrixDate(appt.appointment_date);
  if (!d || !isAppointmentOnOrAfterToday(d, today)) return false;
  return !isAppointmentCancelledOrBroken(appt);
}

function patientHasFutureQueueAppointment(
  patientId: string,
  queueId: string,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes,
  patientsById: Record<string, DentrixPatientDoc>,
  today: Date
): boolean {
  const patientAppts = getPatientAppointments(patientId, indexes, patientsById);
  const hasMatchingFuture = patientAppts.some((x) => {
    if (!isActiveFutureQueueAppointment(x, today)) return false;
    return appointmentMatchesQueue(x, queueId, ctx, indexes, { mode: 'future_booked' });
  });
  if (hasMatchingFuture) return true;

  const info = ctx.patientInfoById?.[patientId];
  const nextD = parseDentrixDate(info?.next_appointment_date);
  if (!nextD || !isAppointmentOnOrAfterToday(nextD, today)) return false;

  return patientAppts.some((x) => {
    const d = parseDentrixDate(x.appointment_date);
    if (!d || !isSameDay(d, nextD)) return false;
    if (isAppointmentCancelledOrBroken(x)) return false;
    return appointmentMatchesQueue(x, queueId, ctx, indexes, { mode: 'future_booked' });
  });
}

function hasFutureMatchingAppointment(
  patientId: string,
  queueId: string,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes,
  patientsById: Record<string, DentrixPatientDoc>,
  today: Date
): boolean {
  return patientHasFutureQueueAppointment(patientId, queueId, ctx, indexes, patientsById, today);
}

function lastPastAppointmentPerPatient(
  queueId: string,
  ctx: QueueBuildContext,
  appointments: DentrixAppointmentDoc[],
  indexes: QueueBuildIndexes,
  today: Date
): Map<string, DentrixAppointmentDoc> {
  const day = startOfDay(today);
  const map = new Map<string, DentrixAppointmentDoc>();
  for (const a of appointments) {
    if (!appointmentMatchesQueue(a, queueId, ctx, indexes)) continue;
    const d = parseDentrixDate(a.appointment_date);
    if (!d || !isBefore(d, day)) continue;
    const pid = String(a.patient_id ?? '');
    const prev = map.get(pid);
    if (!prev || (parseDentrixDate(prev.appointment_date)?.getTime() ?? 0) < d.getTime()) {
      map.set(pid, a);
    }
  }
  return map;
}

const CHART_COMPLETED = 102;

const LEDGER_POSTED_REMOVE_QUEUE_IDS = new Set<string>([
  GA_ALL_APPOINTMENTS_QUEUE_ID,
  'cbct',
  'night_guard',
  'extraction',
  'fillings',
  'root_canal',
  'ortho_follow_ups',
  'bone_grafting',
]);

type AppointmentQueueMatchMode = 'past_qualifying' | 'future_booked';

function isTreatmentPostedInLedger(
  appt: DentrixAppointmentDoc,
  queueId: string,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes
): boolean {
  if (!LEDGER_POSTED_REMOVE_QUEUE_IDS.has(queueId)) return false;

  const apptDate = parseDentrixDate(appt.appointment_date);
  if (!apptDate) return false;
  const since = startOfDay(apptDate);
  const ledger = getLedgerForPatient(String(appt.patient_id ?? ''), ctx);
  const adaByProccodeId = indexes.procedureCodeCache?.adaByProccodeId ?? new Map<number, string>();

  for (const row of ledger) {
    if (Number(row.chartstatus) !== CHART_COMPLETED) continue;
    const procDate = parseDentrixDate(row.procdate ?? row.entrydate);
    if (!procDate || procDate < since) continue;
    const ada = adaByProccodeId.get(Number(row.proccodeid));
    if (ada && anyCodeMatchesQueue([ada], queueId)) return true;
  }

  const codes = getCompletedLedgerCodesOnAppointment(appt, ledger, adaByProccodeId);
  return codes.some((c) => anyCodeMatchesQueue([c], queueId));
}

function buildGaAllAppointmentsQueue(
  ctx: QueueBuildContext,
  appointments: DentrixAppointmentDoc[],
  patientsById: Record<string, DentrixPatientDoc>,
  indexes: QueueBuildIndexes,
  now: Date,
  ageBucket: AgeBucketFilter,
  gaTimeFilter: GaAppointmentTimeFilter = 'past'
): QueueRow[] {
  const queueId = GA_ALL_APPOINTMENTS_QUEUE_ID;
  const day = startOfDay(now);
  const lookaheadEnd = addMonths(day, GA_APPOINTMENTS_LOOKAHEAD_MONTHS);
  const rows: QueueRow[] = [];

  for (const a of appointments) {
    if (!appointmentMatchesQueue(a, queueId, ctx, indexes)) continue;
    const d = parseDentrixDate(a.appointment_date);
    if (!d) continue;
    const apptDay = startOfDay(d);
    const isPast = isBefore(apptDay, day);
    const isUpcoming = !isBefore(apptDay, day) && !isAfter(apptDay, lookaheadEnd);

    if (gaTimeFilter === 'past' && !isPast) continue;
    if (gaTimeFilter === 'upcoming_4mo' && !isUpcoming) continue;
    if (gaTimeFilter === 'all' && !isPast && !isUpcoming) continue;

    if (isTrackingExcluded(a.id, queueId, ctx)) continue;
    if (isPast && isTreatmentPostedInLedger(a, queueId, ctx, indexes)) continue;

    if (isPast) {
      const m = monthsSinceAppt(a, now);
      if (!matchesAgeBucket(m, ageBucket)) continue;
    }

    const row = apptRow(a, patientsById, now);
    if (row) rows.push(row);
  }

  return rows
    .sort((a, b) => (b.dateLabel ?? '').localeCompare(a.dateLabel ?? ''))
    .slice(0, 400);
}

function buildCategoryQueue(
  queueId: string,
  ctx: QueueBuildContext,
  appointments: DentrixAppointmentDoc[],
  patientsById: Record<string, DentrixPatientDoc>,
  indexes: QueueBuildIndexes,
  now: Date,
  ageBucket: AgeBucketFilter
): QueueRow[] {
  const lastByPatient = lastPastAppointmentPerPatient(queueId, ctx, appointments, indexes, now);
  return Array.from(lastByPatient.values())
    .filter((a) => {
      if (isTrackingExcluded(a.id, queueId, ctx)) return false;
      if (isTreatmentPostedInLedger(a, queueId, ctx, indexes)) return false;
      const pid = String(a.patient_id ?? '');
      if (hasFutureMatchingAppointment(pid, queueId, ctx, indexes, patientsById, now)) return false;
      if (!isRecallOverdue(a, now)) return false;
      return matchesAgeBucket(monthsSinceAppt(a, now), ageBucket);
    })
    .sort((a, b) => (b.appointment_date ?? '').localeCompare(a.appointment_date ?? ''))
    .slice(0, 400)
    .map((a) => apptRow(a, patientsById, now))
    .filter((r): r is QueueRow => !!r);
}

function findAppointmentOnDate(
  patientId: string,
  day: Date,
  indexes: QueueBuildIndexes,
  patientsById: Record<string, DentrixPatientDoc>
): DentrixAppointmentDoc | undefined {
  const matches = getPatientAppointments(patientId, indexes, patientsById).filter((a) => {
    const d = parseDentrixDate(a.appointment_date);
    return !!d && isSameDay(startOfDay(d), day);
  });
  if (!matches.length) return undefined;
  matches.sort((a, b) => (b.appointment_date ?? '').localeCompare(a.appointment_date ?? ''));
  return matches[0];
}

function patientRebookedAfterNoShow(
  patientId: string,
  noShowDate: Date,
  excludeApptId: string | undefined,
  indexes: QueueBuildIndexes,
  patientsById: Record<string, DentrixPatientDoc>,
  today: Date
): boolean {
  return getPatientAppointments(patientId, indexes, patientsById).some((x) => {
    if (excludeApptId && x.id === excludeApptId) return false;
    if (!isActiveScheduledAppointment(x, today)) return false;
    const d = parseDentrixDate(x.appointment_date);
    if (!d) return false;
    return isAfter(startOfDay(d), startOfDay(noShowDate));
  });
}

interface NoShowLedgerEvent {
  patientId: string;
  noShowDate: Date;
  matchedAppt?: DentrixAppointmentDoc;
}

function buildNoShowEventsFromLedger(
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes,
  patientsById: Record<string, DentrixPatientDoc>,
  weekAgo: Date,
  today: Date
): NoShowLedgerEvent[] {
  if (!ctx.ledgerByPatientId?.size) return [];

  const adaByProccodeId = indexes.procedureCodeCache?.adaByProccodeId ?? new Map<number, string>();
  const seen = new Map<string, NoShowLedgerEvent>();

  for (const [patid, rows] of ctx.ledgerByPatientId) {
    const patientId = String(patid);
    if (!patientActive(patientsById, patientId)) continue;

    for (const row of rows) {
      if (!ledgerRowIndicatesNoShow(row, adaByProccodeId)) continue;
      if (Number(row.chartstatus) !== 102) continue;

      const procDate = parseDentrixDate(row.procdate ?? row.entrydate);
      if (!procDate) continue;
      const day = startOfDay(procDate);
      if (isBefore(day, weekAgo) || !isBefore(day, today)) continue;

      const dateKey = formatDentrixDateKey(procDate) ?? day.toISOString();
      const key = `${patientId}-${dateKey}`;
      if (seen.has(key)) continue;

      seen.set(key, {
        patientId,
        noShowDate: day,
        matchedAppt: findAppointmentOnDate(patientId, day, indexes, patientsById),
      });
    }
  }

  return [...seen.values()].sort(
    (a, b) => b.noShowDate.getTime() - a.noShowDate.getTime()
  );
}

function noShowQueueRow(
  event: NoShowLedgerEvent,
  patientsById: Record<string, DentrixPatientDoc>,
  now: Date,
  rebooked: boolean
): QueueRow | null {
  if (event.matchedAppt) {
    return apptRow(event.matchedAppt, patientsById, now, { rebooked });
  }

  const pid = event.patientId;
  if (!patientActive(patientsById, pid)) return null;
  const patient = patientsById[pid];
  const name =
    cleanDentrixText(
      patient ? `${patient.first_name ?? ''} ${patient.last_name ?? ''}` : ''
    ) || `Patient #${pid}`;
  const dateKey = formatDentrixDateKey(event.noShowDate.toISOString()) ?? '—';
  const firestoreId = `no-show-${pid}-${dateKey}`;

  return {
    id: firestoreId,
    appointmentFirestoreId: firestoreId,
    patientId: pid,
    patientName: name,
    detail: 'No-show',
    dateLabel: dateKey,
    rebooked,
  };
}

function buildCategoryQueueWeekBucket(
  queueId: string,
  ctx: QueueBuildContext,
  appointments: DentrixAppointmentDoc[],
  patientsById: Record<string, DentrixPatientDoc>,
  indexes: QueueBuildIndexes,
  now: Date,
  weekBucket: VisitWeekBucketFilter
): QueueRow[] {
  const lastByPatient = lastPastAppointmentPerPatient(queueId, ctx, appointments, indexes, now);
  return Array.from(lastByPatient.values())
    .filter((a) => {
      if (isTrackingExcluded(a.id, queueId, ctx)) return false;
      if (isTreatmentPostedInLedger(a, queueId, ctx, indexes)) return false;
      const pid = String(a.patient_id ?? '');
      if (queueId === 'emerg_follow_up') {
        if (patientHasAnyFutureAppointmentBooked(pid, ctx, indexes, patientsById, now)) return false;
      } else if (hasFutureMatchingAppointment(pid, queueId, ctx, indexes, patientsById, now)) {
        return false;
      }
      if (queueId === 'new_patient_follow_up') {
        const months = monthsSinceAppt(a, now);
        if (months === null || months > NEW_PATIENT_MAX_MONTHS) return false;
        if (patientHadPriorAppointmentBeforeVisit(pid, a, indexes, patientsById)) return false;
      }
      return matchesVisitWeekBucket(daysSincePastAppointment(a, now), weekBucket);
    })
    .sort((a, b) => (b.appointment_date ?? '').localeCompare(a.appointment_date ?? ''))
    .slice(0, 400)
    .map((a) => apptRow(a, patientsById, now))
    .filter((r): r is QueueRow => !!r);
}

export function buildQueueRows(
  queueId: string,
  appointments: DentrixAppointmentDoc[],
  patientsById: Record<string, DentrixPatientDoc>,
  _openOutreachLegacy: number,
  now = new Date(),
  ageBucket: AgeBucketFilter = 'all',
  visitWeekBucket: VisitWeekBucketFilter = 'all',
  ctx: QueueBuildContext = {},
  sharedIndexes?: QueueBuildIndexes
): QueueRow[] {
  const today = startOfDay(now);
  const weekAgo = subDays(today, 7);
  const indexes = sharedIndexes ?? buildQueueIndexes(appointments, ctx, patientsById);

  const apptsForActivePatients = appointments.filter((a) => {
    const pid = String(a.patient_id ?? '');
    return pid && patientActive(patientsById, pid);
  });

  if (queueId === GA_ALL_APPOINTMENTS_QUEUE_ID) {
    const gaTimeFilter = ctx.gaTimeFilter ?? 'all';
    return buildGaAllAppointmentsQueue(
      ctx,
      apptsForActivePatients,
      patientsById,
      indexes,
      now,
      ageBucket,
      gaTimeFilter
    );
  }

  if (queueId === 'no_shows_past_week') {
    return buildNoShowEventsFromLedger(ctx, indexes, patientsById, weekAgo, today)
      .map((event) => {
        const excludeApptId = event.matchedAppt?.id;
        const rebooked = patientRebookedAfterNoShow(
          event.patientId,
          event.noShowDate,
          excludeApptId,
          indexes,
          patientsById,
          now
        );
        return noShowQueueRow(event, patientsById, now, rebooked);
      })
      .filter((r): r is QueueRow => !!r);
  }

  if (queueId === 'hygiene_cc') {
    const day = startOfDay(now);
    const lastByPatient = new Map<string, DentrixAppointmentDoc>();
    for (const a of appointments) {
      if (!appointmentQualifiesAsHygieneCcAnchor(a, ctx, indexes)) continue;
      const d = parseDentrixDate(a.appointment_date);
      if (!d || !isBefore(d, day)) continue;
      const pid = String(a.patient_id ?? '');
      if (!pid || !patientActive(patientsById, pid)) continue;
      const prev = lastByPatient.get(pid);
      if (!prev || (parseDentrixDate(prev.appointment_date)?.getTime() ?? 0) < d.getTime()) {
        lastByPatient.set(pid, a);
      }
    }

    return Array.from(lastByPatient.values())
      .filter((a) => {
        if (isTrackingExcluded(a.id, 'hygiene_cc', ctx)) return false;
        const pid = String(a.patient_id ?? '');
        if (patientHasFutureQueueAppointment(pid, 'hygiene_cc', ctx, indexes, patientsById, now)) return false;
        if (!isRecallOverdueForHygiene(a, now)) return false;
        const m = monthsSinceAppt(a, now);
        return matchesAgeBucket(m, ageBucket) && m !== null && m >= 0;
      })
      .sort((a, b) => (b.appointment_date ?? '').localeCompare(a.appointment_date ?? ''))
      .slice(0, 400)
      .map((a) => {
        const row = apptRow(a, patientsById, now);
        if (!row) return null;
        const interval = parseHygieneRecallIntervalMonths(a);
        row.recallIntervalMonths = interval;
        row.isOverdue = interval !== null ? isRecallOverdueForHygiene(a, now) : undefined;
        return row;
      })
      .filter((r): r is QueueRow => !!r);
  }

  if (queueId === 'emerg_follow_up' || queueId === 'new_patient_follow_up') {
    if (!getQueueProcedureConfig(queueId) && !KEYWORD_MATCHERS[queueId]) return [];
    return buildCategoryQueueWeekBucket(
      queueId,
      ctx,
      apptsForActivePatients,
      patientsById,
      indexes,
      now,
      visitWeekBucket
    );
  }

  if (getQueueProcedureConfig(queueId) || KEYWORD_MATCHERS[queueId]) {
    return buildCategoryQueue(queueId, ctx, appointments, patientsById, indexes, now, ageBucket);
  }

  return [];
}

export const QUEUE_ROW_DISPLAY_LIMIT = 400;

/** Queues that need ledger data for accurate row lists (show scoped loading while ledger fetches). */
export function queueRequiresLedgerForDisplay(queueId: string): boolean {
  if (queueId === 'no_shows_past_week') return true;
  if (queueId === 'emerg_follow_up' || queueId === 'hygiene_cc') return false;
  return !!getQueueProcedureConfig(queueId) || queueId === GA_ALL_APPOINTMENTS_QUEUE_ID;
}

export function buildQueueRowCount(
  queueId: string,
  appointments: DentrixAppointmentDoc[],
  patientsById: Record<string, DentrixPatientDoc>,
  now = new Date(),
  ageBucket: AgeBucketFilter = 'all',
  visitWeekBucket: VisitWeekBucketFilter = 'all',
  ctx: QueueBuildContext = {},
  sharedIndexes?: QueueBuildIndexes
): number {
  const today = startOfDay(now);
  const weekAgo = subDays(today, 7);
  const indexes = sharedIndexes ?? buildQueueIndexes(appointments, ctx, patientsById);

  const apptsForActivePatients = appointments.filter((a) => {
    const pid = String(a.patient_id ?? '');
    return pid && patientActive(patientsById, pid);
  });

  if (queueId === GA_ALL_APPOINTMENTS_QUEUE_ID) {
    const gaTimeFilter = ctx.gaTimeFilter ?? 'all';
    const day = startOfDay(now);
    const lookaheadEnd = addMonths(day, GA_APPOINTMENTS_LOOKAHEAD_MONTHS);
    let count = 0;
    for (const a of apptsForActivePatients) {
      if (!appointmentMatchesQueue(a, queueId, ctx, indexes)) continue;
      const d = parseDentrixDate(a.appointment_date);
      if (!d) continue;
      const apptDay = startOfDay(d);
      const isPast = isBefore(apptDay, day);
      const isUpcoming = !isBefore(apptDay, day) && !isAfter(apptDay, lookaheadEnd);
      if (gaTimeFilter === 'past' && !isPast) continue;
      if (gaTimeFilter === 'upcoming_4mo' && !isUpcoming) continue;
      if (gaTimeFilter === 'all' && !isPast && !isUpcoming) continue;
      if (isTrackingExcluded(a.id, queueId, ctx)) continue;
      if (isPast && isTreatmentPostedInLedger(a, queueId, ctx, indexes)) continue;
      if (isPast) {
        const m = monthsSinceAppt(a, now);
        if (!matchesAgeBucket(m, ageBucket)) continue;
      }
      count++;
      if (count >= QUEUE_ROW_DISPLAY_LIMIT) return QUEUE_ROW_DISPLAY_LIMIT;
    }
    return count;
  }

  if (queueId === 'no_shows_past_week') {
    return buildNoShowEventsFromLedger(ctx, indexes, patientsById, weekAgo, today).length;
  }

  if (queueId === 'hygiene_cc') {
    const day = startOfDay(now);
    const lastByPatient = new Map<string, DentrixAppointmentDoc>();
    for (const a of appointments) {
      if (!appointmentQualifiesAsHygieneCcAnchor(a, ctx, indexes)) continue;
      const d = parseDentrixDate(a.appointment_date);
      if (!d || !isBefore(d, day)) continue;
      const pid = String(a.patient_id ?? '');
      if (!pid || !patientActive(patientsById, pid)) continue;
      const prev = lastByPatient.get(pid);
      if (!prev || (parseDentrixDate(prev.appointment_date)?.getTime() ?? 0) < d.getTime()) {
        lastByPatient.set(pid, a);
      }
    }
    let count = 0;
    for (const a of lastByPatient.values()) {
      if (isTrackingExcluded(a.id, 'hygiene_cc', ctx)) continue;
      const pid = String(a.patient_id ?? '');
      if (patientHasFutureQueueAppointment(pid, 'hygiene_cc', ctx, indexes, patientsById, now)) continue;
      if (!isRecallOverdueForHygiene(a, now)) continue;
      const m = monthsSinceAppt(a, now);
      if (!matchesAgeBucket(m, ageBucket) || m === null || m < 0) continue;
      count++;
      if (count >= QUEUE_ROW_DISPLAY_LIMIT) return QUEUE_ROW_DISPLAY_LIMIT;
    }
    return count;
  }

  if (queueId === 'emerg_follow_up' || queueId === 'new_patient_follow_up') {
    if (!getQueueProcedureConfig(queueId) && !KEYWORD_MATCHERS[queueId]) return 0;
    const lastByPatient = lastPastAppointmentPerPatient(queueId, ctx, apptsForActivePatients, indexes, now);
    let count = 0;
    for (const a of lastByPatient.values()) {
      if (isTrackingExcluded(a.id, queueId, ctx)) continue;
      if (isTreatmentPostedInLedger(a, queueId, ctx, indexes)) continue;
      const pid = String(a.patient_id ?? '');
      if (queueId === 'emerg_follow_up') {
        if (patientHasAnyFutureAppointmentBooked(pid, ctx, indexes, patientsById, now)) continue;
      } else if (hasFutureMatchingAppointment(pid, queueId, ctx, indexes, patientsById, now)) {
        continue;
      }
      if (queueId === 'new_patient_follow_up') {
        const months = monthsSinceAppt(a, now);
        if (months === null || months > NEW_PATIENT_MAX_MONTHS) continue;
        if (patientHadPriorAppointmentBeforeVisit(pid, a, indexes, patientsById)) continue;
      }
      if (!matchesVisitWeekBucket(daysSincePastAppointment(a, now), visitWeekBucket)) continue;
      count++;
      if (count >= QUEUE_ROW_DISPLAY_LIMIT) return QUEUE_ROW_DISPLAY_LIMIT;
    }
    return count;
  }

  if (getQueueProcedureConfig(queueId) || KEYWORD_MATCHERS[queueId]) {
    const lastByPatient = lastPastAppointmentPerPatient(queueId, ctx, appointments, indexes, now);
    let count = 0;
    for (const a of lastByPatient.values()) {
      if (isTrackingExcluded(a.id, queueId, ctx)) continue;
      if (isTreatmentPostedInLedger(a, queueId, ctx, indexes)) continue;
      const pid = String(a.patient_id ?? '');
      if (hasFutureMatchingAppointment(pid, queueId, ctx, indexes, patientsById, now)) continue;
      if (!isRecallOverdue(a, now)) continue;
      if (!matchesAgeBucket(monthsSinceAppt(a, now), ageBucket)) continue;
      count++;
      if (count >= QUEUE_ROW_DISPLAY_LIMIT) return QUEUE_ROW_DISPLAY_LIMIT;
    }
    return count;
  }

  return 0;
}
