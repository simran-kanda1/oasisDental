import type { DentrixAppointmentDoc, DentrixPatientDoc } from '../lib/dentrix';
import { cleanDentrixText, formatDentrixDateKey, parseDentrixDate, isActiveDentrixPatient } from '../lib/dentrix';
import {
  appointmentLabelText,
  isAppointmentNoShow,
  isRecallOverdue,
  parseRecallIntervalMonths,
  patientHasFutureAppointmentAfter,
} from '../lib/appointmentHeuristics';
import {
  anyCodeMatchesQueue,
  buildAdaByProccodeId,
  getAppointmentProcedureCodes,
  getQueueProcedureConfig,
  type ProcedureCodeLookupCache,
} from '../lib/queueProcedureCodes';
import { buildProcedureCodeByAdaMap } from '../lib/procedureCodeTypes';
import type { DentrixProcedureCodeDoc } from '../lib/procedureCodeTypes';
import type { DentrixLedgerTransactionDoc } from '../lib/ledgerTransactions';
import { addDays, differenceInCalendarDays, differenceInCalendarMonths, isAfter, isBefore, startOfDay, subDays } from 'date-fns';

/** Mutually exclusive aging buckets (months since last qualifying visit). */
export type AgeBucketFilter = 'all' | '0-1' | '1-3' | '3-6' | '6-9' | '9-12' | '12+';

/** Recency of last qualifying visit (emerg / new patient queues). */
export type VisitWeekBucketFilter = 'all' | 'w1' | 'w2' | 'w3' | 'w4plus';

export interface QueueBuildContext {
  procedureCodes?: DentrixProcedureCodeDoc[];
  ledgerByPatientId?: Map<number, DentrixLedgerTransactionDoc[]>;
}

/** Built once per queue pass — avoids O(n²) scans and repeated code-map builds. */
export interface QueueBuildIndexes {
  apptsByPatientId: Map<string, DentrixAppointmentDoc[]>;
  procedureCodeCache?: ProcedureCodeLookupCache;
}

export function buildQueueIndexes(
  appointments: DentrixAppointmentDoc[],
  ctx: QueueBuildContext
): QueueBuildIndexes {
  const apptsByPatientId = new Map<string, DentrixAppointmentDoc[]>();
  for (const a of appointments) {
    const pid = String(a.patient_id ?? '');
    if (!pid) continue;
    const list = apptsByPatientId.get(pid);
    if (list) list.push(a);
    else apptsByPatientId.set(pid, [a]);
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
  'referral_doctor_followup',
] as const;

export type StandaloneFrontDeskQueueId = (typeof STANDALONE_FRONT_DESK_QUEUE_IDS)[number];

export const STANDALONE_FRONT_DESK_QUEUE_DEFS: FrontDeskQueueDef[] = [
  { id: 'emerg_follow_up', label: 'Emerg patient follow up', description: 'Had emergency visit; no future emergency-type visit booked.' },
  { id: 'new_patient_follow_up', label: 'New patient follow up', description: 'Had new-patient/consult visit; no future NP-style visit booked.' },
  {
    id: 'referral_doctor_followup',
    label: 'Referrals',
    description:
      'Patients linked to a referring doctor or professional source (Dentrix ref_type = 1). Track when the referrer has been updated on the patient’s progress.',
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
    description: 'No-shows in the last 7 days and whether a future appointment exists.',
  },
  { id: 'hygiene_cc', label: 'Hygiene CC', description: 'Had a hygiene-type visit; overdue per recall interval (e.g. 4M) with no future hygiene appointment booked.' },
  { id: 'cbct', label: 'CBCT', description: 'Had CBCT imaging; no future CBCT-type appointment booked.' },
  { id: 'fillings', label: 'Restorative', description: 'Had restorative visit; no future restorative appointment booked.' },
  { id: 'crowns', label: 'Crown', description: 'Had crown-related visit; no future crown appointment booked.' },
  { id: 'root_canal', label: 'Root canal', description: 'Had root canal treatment; no future endo appointment booked.' },
  { id: 'perio', label: 'Perio / GG / BB / M', description: 'Had perio-related visit; no future matching appointment booked.' },
  { id: 'implants', label: 'Implants', description: 'Had implant-related visit; no future implant visit booked.' },
  { id: 'bone_grafting', label: 'Bone grafting', description: 'Had bone graft visit; no future matching appointment booked.' },
  { id: 'gum_grafting', label: 'Gum grafting', description: 'Had gum graft visit; no future matching appointment booked.' },
  { id: 'extraction', label: 'Extraction', description: 'Had extraction-related visit; no future extraction visit booked.' },
  { id: 'general_anesthesia', label: 'General anesthesia', description: 'Had GA visit; no future matching appointment booked.' },
  { id: 'ortho_follow_ups', label: 'Ortho follow ups', description: 'Had ortho visit; no future ortho appointment booked.' },
  { id: 'night_guard', label: 'Night guard', description: 'Had night guard visit; no future matching appointment booked.' },
  { id: 'periodontal_surgery', label: 'Periodontal surgery', description: 'Had periodontal surgery; no future matching appointment booked.' },
  { id: 'oral_sedation', label: 'Oral sedation', description: 'Had oral sedation visit; no future matching visit booked.' },
  { id: 'tmj_mri', label: 'TMJ / MRI', description: 'Had TMJ or MRI-referral visit; no future matching appointment booked.' },
];

function matchesCleaningAppointmentText(label: string): boolean {
  return /\b(prophy|cleaning|adult prophy|child prophy)\b/i.test(label) && !/\bscaling\b/i.test(label);
}

const KEYWORD_MATCHERS: Record<string, (s: string) => boolean> = {
  cbct: (s) => /\b(cbct|cone beam|3d imaging|cat scan)\b/i.test(s),
  fillings: (s) => /\b(fill|composite|amalgam|restoration|filling|onlay|inlay)\b/i.test(s),
  crowns: (s) => /\b(crown|cap|porcelain crown|zirconia|pfm)\b/i.test(s),
  root_canal: (s) => /\b(root canal|endo|endodont|rct|pulpectomy)\b/i.test(s),
  perio: (s) => /\b(perio|periodont|scaling|root plan|srp|gingiv)\b/i.test(s),
  implants: (s) => /\b(implant|impl\s|osseointegration|abutment|all[\s-]?on[\s-]?4|ao4)\b/i.test(s),
  bone_grafting: (s) => /\b(bone graft|graft|ridge|socket preservation|sinus lift|augmentation)\b/i.test(s),
  gum_grafting: (s) => /\b(gum graft|gingival graft|soft tissue graft|fgg|connective tissue)\b/i.test(s),
  extraction: (s) => /\b(extract|ext\s|extraction|oral surgery|third molar|wisdom)\b/i.test(s),
  general_anesthesia: (s) => /\b(general anesthesia|ga\b|iv sedation|asleep|deep sedation|anesthesia)\b/i.test(s),
  ortho_follow_ups: (s) => /\b(ortho|orthodont|braces|invisalign|aligner|retainer)\b/i.test(s),
  night_guard: (s) => /\b(night guard|occlusal guard|splint|brux)/i.test(s),
  periodontal_surgery: (s) => /\b(periodontal surg|perio surg|osseous|flap|gtr|guided tissue)\b/i.test(s),
  oral_sedation: (s) => /\b(oral sedation|conscious sedation|nitrous|n2o)\b/i.test(s),
  tmj_mri: (s) => /\b(tmj|mri|temporomandibular|magnetic resonance)\b/i.test(s),
  emerg_follow_up: (s) => /\b(emerg|emergency|pain|swelling|walk[\s-]?in)\b/i.test(s),
  new_patient_follow_up: (s) => /\b(new patient|np\b|new pt|consult|consultation|exam)\b/i.test(s),
};

function patientActive(patientsById: Record<string, DentrixPatientDoc>, patientId: string): boolean {
  const p = patientsById[patientId];
  if (!p) return true;
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

function appointmentMatchesQueue(
  appt: DentrixAppointmentDoc,
  queueId: string,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes
): boolean {
  const label = appointmentLabelText(appt);
  const textMatch = KEYWORD_MATCHERS[queueId]?.(label) ?? false;
  const config = getQueueProcedureConfig(queueId);

  const procedureCodes = ctx.procedureCodes ?? [];
  if (!config || !procedureCodes.length) return textMatch;

  const ledger = getLedgerForPatient(String(appt.patient_id ?? ''), ctx);
  const codes = getAppointmentProcedureCodes(appt, ledger, procedureCodes, indexes.procedureCodeCache);
  if (codes.length > 0) {
    const codeMatch = anyCodeMatchesQueue(codes, queueId);
    if (queueId === 'new_patient_follow_up') return codeMatch || textMatch;
    return codeMatch;
  }

  return textMatch;
}

function hasFutureMatchingAppointment(
  patientId: string,
  queueId: string,
  ctx: QueueBuildContext,
  indexes: QueueBuildIndexes,
  today: Date
): boolean {
  const t0 = startOfDay(today);
  const patientAppts = indexes.apptsByPatientId.get(patientId) ?? [];
  return patientAppts.some((x) => {
    if (!appointmentMatchesQueue(x, queueId, ctx, indexes)) return false;
    const d = parseDentrixDate(x.appointment_date);
    return d && isAfter(d, t0);
  });
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
      const pid = String(a.patient_id ?? '');
      if (hasFutureMatchingAppointment(pid, queueId, ctx, indexes, now)) return false;
      // 4M / 2M etc. on the appointment = months until next visit is due; hide until overdue.
      if (!isRecallOverdue(a, now)) return false;
      return matchesAgeBucket(monthsSinceAppt(a, now), ageBucket);
    })
    .sort((a, b) => (b.appointment_date ?? '').localeCompare(a.appointment_date ?? ''))
    .slice(0, 400)
    .map((a) => apptRow(a, patientsById, now))
    .filter((r): r is QueueRow => !!r);
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
      const pid = String(a.patient_id ?? '');
      if (hasFutureMatchingAppointment(pid, queueId, ctx, indexes, now)) return false;
      return matchesVisitWeekBucket(daysSincePastAppointment(a, now), weekBucket);
    })
    .sort((a, b) => (b.appointment_date ?? '').localeCompare(a.appointment_date ?? ''))
    .slice(0, 400)
    .map((a) => apptRow(a, patientsById, now))
    .filter((r): r is QueueRow => !!r);
}

function matchesHygieneCc(appt: DentrixAppointmentDoc): boolean {
  const label = appointmentLabelText(appt);
  if (/\b(hyg|hygiene|prophy|recall|cleaning|perio maint|periodontal maint|scaling|comprehensive periodic|re.?care)\b/i.test(label)) {
    return true;
  }
  return matchesCleaningAppointmentText(label);
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
  if (queueId === 'referral_doctor_followup') {
    return [];
  }

  const today = startOfDay(now);
  const weekAgo = subDays(today, 7);
  const indexes = sharedIndexes ?? buildQueueIndexes(appointments, ctx);

  const apptsForActivePatients = appointments.filter((a) => {
    const pid = String(a.patient_id ?? '');
    return pid && patientActive(patientsById, pid);
  });

  if (queueId === 'no_shows_past_week') {
    return apptsForActivePatients
      .filter((a) => {
        if (!isAppointmentNoShow(a)) return false;
        const d = parseDentrixDate(a.appointment_date);
        if (!d) return false;
        return !isBefore(d, weekAgo) && isBefore(d, today);
      })
      .sort((a, b) => (b.appointment_date ?? '').localeCompare(a.appointment_date ?? ''))
      .map((a) => {
        const d = parseDentrixDate(a.appointment_date)!;
        const pid = String(a.patient_id ?? '');
        const rebooked = patientHasFutureAppointmentAfter(pid, d, appointments, now);
        return apptRow(a, patientsById, now, { rebooked });
      })
      .filter((r): r is QueueRow => !!r);
  }

  if (queueId === 'hygiene_cc') {
    const day = startOfDay(now);
    const lastByPatient = new Map<string, DentrixAppointmentDoc>();
    for (const a of appointments) {
      if (!matchesHygieneCc(a)) continue;
      const d = parseDentrixDate(a.appointment_date);
      if (!d || !isBefore(d, day)) continue;
      const pid = String(a.patient_id ?? '');
      const prev = lastByPatient.get(pid);
      if (!prev || (parseDentrixDate(prev.appointment_date)?.getTime() ?? 0) < d.getTime()) {
        lastByPatient.set(pid, a);
      }
    }

    const hasFutureHygiene = (patientId: string) => {
      const patientAppts = indexes.apptsByPatientId.get(patientId) ?? [];
      return patientAppts.some((x) => {
        if (!matchesHygieneCc(x)) return false;
        const d = parseDentrixDate(x.appointment_date);
        return d && isAfter(d, day);
      });
    };

    return Array.from(lastByPatient.values())
      .filter((a) => {
        const pid = String(a.patient_id ?? '');
        if (hasFutureHygiene(pid)) return false;
        if (!isRecallOverdue(a, now)) return false;
        const m = monthsSinceAppt(a, now);
        return matchesAgeBucket(m, ageBucket) && m !== null && m >= 0;
      })
      .sort((a, b) => (b.appointment_date ?? '').localeCompare(a.appointment_date ?? ''))
      .slice(0, 400)
      .map((a) => apptRow(a, patientsById, now))
      .filter((r): r is QueueRow => !!r);
  }

  if (queueId === 'emerg_follow_up' || queueId === 'new_patient_follow_up') {
    if (!KEYWORD_MATCHERS[queueId] && !getQueueProcedureConfig(queueId)) return [];
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

  if (KEYWORD_MATCHERS[queueId] || getQueueProcedureConfig(queueId)) {
    return buildCategoryQueue(queueId, ctx, appointments, patientsById, indexes, now, ageBucket);
  }

  return [];
}
