import type { DentrixAppointmentDoc, DentrixPatientDoc } from '../lib/dentrix';
import { cleanDentrixText, formatDentrixDateKey, parseDentrixDate, isActiveDentrixPatient } from '../lib/dentrix';
import {
  appointmentLabelText,
  isAppointmentNoShow,
  isEstimateAppointment,
  isEstimateSent,
  patientHasFutureAppointmentAfter,
} from '../lib/appointmentHeuristics';
import { differenceInCalendarMonths, isAfter, isBefore, startOfDay, subDays } from 'date-fns';

export type AgeBucketFilter = 'all' | '0-3' | '3-6' | '6-9' | '9-12' | '12+';

export interface QueueRow {
  id: string;
  patientId: string;
  patientName: string;
  detail: string;
  dateLabel: string | null;
  provider?: string;
  monthsSince?: number | null;
  rebooked?: boolean;
}

export interface FrontDeskQueueDef {
  id: string;
  label: string;
  description: string;
}

export const FRONT_DESK_QUEUE_DEFS: FrontDeskQueueDef[] = [
  {
    id: 'no_shows_past_week',
    label: 'No shows (past week)',
    description: 'No-shows in the last 7 days and whether a future appointment exists.',
  },
  { id: 'hygiene_cc', label: 'Hygiene CC', description: 'Had a hygiene-type visit; no future hygiene appointment booked.' },
  {
    id: 'estimate_follow_ups',
    label: 'Estimate follow ups',
    description: 'Treatment plan rows where estimate was sent (estimate sent = true) but no future estimate-type visit booked.',
  },
  { id: 'cleanings', label: 'Cleanings', description: 'Had a cleaning-type visit; no future cleaning-type appointment booked.' },
  { id: 'fillings', label: 'Fillings', description: 'Had restorative visit; no future restorative visit booked.' },
  { id: 'implants', label: 'Implants', description: 'Had implant-related visit; no future implant visit booked.' },
  { id: 'bone_grafting', label: 'Bone grafting', description: 'Had bone graft context; no future matching appointment booked.' },
  { id: 'gum_grafting', label: 'Gum grafting', description: 'Had gum graft context; no future matching appointment booked.' },
  { id: 'extraction', label: 'Extraction', description: 'Had extraction-related visit; no future extraction visit booked.' },
  { id: 'general_anesthesia', label: 'General anesthesia', description: 'Had GA/sedation visit; no future matching visit booked.' },
  {
    id: 'estimates_to_send',
    label: 'Estimates to send',
    description: 'Treatment plan rows with production — estimate not yet sent (estimate sent = false).',
  },
  { id: 'ortho_follow_ups', label: 'Ortho follow ups', description: 'Had ortho visit; no future ortho appointment booked.' },
  { id: 'tmj_mri', label: 'TMJ / MRI', description: 'Had TMJ/MRI-related visit; no future matching appointment booked.' },
  { id: 'emerg_follow_up', label: 'Emerg patient follow up', description: 'Had emergency visit; no future emergency-type visit booked.' },
  { id: 'new_patient_follow_up', label: 'New patient follow up', description: 'Had new-patient/consult visit; no future NP-style visit booked.' },
];

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

export function matchesAgeBucket(monthsSince: number | null, bucket: AgeBucketFilter): boolean {
  if (bucket === 'all') return true;
  if (monthsSince === null) return false;
  if (bucket === '0-3') return monthsSince >= 0 && monthsSince < 3;
  if (bucket === '3-6') return monthsSince >= 3 && monthsSince < 6;
  if (bucket === '6-9') return monthsSince >= 6 && monthsSince < 9;
  if (bucket === '9-12') return monthsSince >= 9 && monthsSince < 12;
  if (bucket === '12+') return monthsSince >= 12;
  return true;
}

function apptRow(a: DentrixAppointmentDoc, patientsById: Record<string, DentrixPatientDoc>, now: Date, extra?: Partial<QueueRow>): QueueRow | null {
  const pid = String(a.patient_id ?? '');
  if (!pid || !patientActive(patientsById, pid)) return null;
  const name = cleanDentrixText(a.patient_name) || `Patient #${pid}`;
  return {
    id: `${a.id}-${pid}`,
    patientId: pid,
    patientName: name,
    detail: cleanDentrixText(a.reason) || cleanDentrixText(a.appointment_type) || 'Appointment',
    dateLabel: formatDentrixDateKey(a.appointment_date),
    provider: cleanDentrixText(a.provider_id) || undefined,
    monthsSince: monthsSinceAppt(a, now),
    ...extra,
  };
}

function hasFutureMatchingAppointment(
  patientId: string,
  matcher: (label: string) => boolean,
  appointments: DentrixAppointmentDoc[],
  today: Date
): boolean {
  const t0 = startOfDay(today);
  return appointments.some((x) => {
    if (String(x.patient_id ?? '') !== patientId) return false;
    if (!matcher(appointmentLabelText(x))) return false;
    const d = parseDentrixDate(x.appointment_date);
    return d && isAfter(d, t0);
  });
}

function lastPastAppointmentPerPatient(
  matcher: (label: string) => boolean,
  appointments: DentrixAppointmentDoc[],
  today: Date
): Map<string, DentrixAppointmentDoc> {
  const day = startOfDay(today);
  const map = new Map<string, DentrixAppointmentDoc>();
  for (const a of appointments) {
    if (!matcher(appointmentLabelText(a))) continue;
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
  matcher: (label: string) => boolean,
  appointments: DentrixAppointmentDoc[],
  patientsById: Record<string, DentrixPatientDoc>,
  now: Date,
  ageBucket: AgeBucketFilter
): QueueRow[] {
  const lastByPatient = lastPastAppointmentPerPatient(matcher, appointments, now);
  return Array.from(lastByPatient.values())
    .filter((a) => {
      const pid = String(a.patient_id ?? '');
      if (hasFutureMatchingAppointment(pid, matcher, appointments, now)) return false;
      return matchesAgeBucket(monthsSinceAppt(a, now), ageBucket);
    })
    .sort((a, b) => (b.appointment_date ?? '').localeCompare(a.appointment_date ?? ''))
    .slice(0, 400)
    .map((a) => apptRow(a, patientsById, now))
    .filter((r): r is QueueRow => !!r);
}

function matchesHygieneCc(s: string): boolean {
  return /\b(hyg|hygiene|prophy|recall|cleaning|perio maint|periodontal maint|scaling|comprehensive periodic|4\s*mo|4m|3\s*mo|6\s*mo|re.?care)\b/i.test(s);
}

const KEYWORD_MATCHERS: Record<string, (s: string) => boolean> = {
  cleanings: (s) => /\b(prophy|cleaning|adult prophy|child prophy)\b/i.test(s) && !/\bscaling\b/i.test(s),
  fillings: (s) => /\b(fill|composite|amalgam|restoration|filling|onlay|inlay)\b/i.test(s),
  implants: (s) => /\b(implant|impl\s|osseointegration|abutment|all[\s-]?on[\s-]?4|ao4)\b/i.test(s),
  bone_grafting: (s) => /\b(bone graft|graft|ridge|socket preservation|sinus lift|augmentation)\b/i.test(s),
  gum_grafting: (s) => /\b(gum graft|gingival graft|soft tissue graft|fgg|connective tissue)\b/i.test(s),
  extraction: (s) => /\b(extract|ext\s|extraction|oral surgery|third molar|wisdom)\b/i.test(s),
  general_anesthesia: (s) => /\b(general anesthesia|ga\b|iv sedation|asleep|deep sedation|anesthesia)\b/i.test(s),
  ortho_follow_ups: (s) => /\b(ortho|orthodont|braces|invisalign|aligner|retainer)\b/i.test(s),
  tmj_mri: (s) => /\b(tmj|mri|magnetic resonance|joint disorder)\b/i.test(s),
  emerg_follow_up: (s) => /\b(emerg|emergency|pain|swelling|walk[\s-]?in)\b/i.test(s),
  new_patient_follow_up: (s) => /\b(new patient|np\b|new pt|consult|consultation|exam)\b/i.test(s),
};

const ESTIMATE_LABEL_MATCHER = (s: string) =>
  /\b(estimate|treatment plan|tx plan|financial|pre-?det|predet|presentation)\b/i.test(s);

export function buildQueueRows(
  queueId: string,
  appointments: DentrixAppointmentDoc[],
  patientsById: Record<string, DentrixPatientDoc>,
  _openOutreachLegacy: number,
  now = new Date(),
  ageBucket: AgeBucketFilter = 'all'
): QueueRow[] {
  const today = startOfDay(now);
  const weekAgo = subDays(today, 7);

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
        const row = apptRow(a, patientsById, now, { rebooked });
        return row;
      })
      .filter((r): r is QueueRow => !!r);
  }

  if (queueId === 'estimates_to_send') {
    return apptsForActivePatients
      .filter((a) => isEstimateAppointment(a) && !isEstimateSent(a))
      .filter((a) => matchesAgeBucket(monthsSinceAppt(a, now), ageBucket))
      .filter((a) => {
        const pid = String(a.patient_id ?? '');
        return !hasFutureMatchingAppointment(pid, ESTIMATE_LABEL_MATCHER, appointments, now);
      })
      .sort((a, b) => (b.appointment_date ?? '').localeCompare(a.appointment_date ?? ''))
      .slice(0, 300)
      .map((a) => apptRow(a, patientsById, now))
      .filter((r): r is QueueRow => !!r);
  }

  if (queueId === 'estimate_follow_ups') {
    return apptsForActivePatients
      .filter((a) => isEstimateAppointment(a) && isEstimateSent(a))
      .filter((a) => matchesAgeBucket(monthsSinceAppt(a, now), ageBucket))
      .filter((a) => {
        const pid = String(a.patient_id ?? '');
        return !hasFutureMatchingAppointment(pid, ESTIMATE_LABEL_MATCHER, appointments, now);
      })
      .sort((a, b) => (b.appointment_date ?? '').localeCompare(a.appointment_date ?? ''))
      .slice(0, 300)
      .map((a) => apptRow(a, patientsById, now))
      .filter((r): r is QueueRow => !!r);
  }

  if (queueId === 'hygiene_cc') {
    const lastByPatient = lastPastAppointmentPerPatient((s) => matchesHygieneCc(s), appointments, now);
    return Array.from(lastByPatient.values())
      .filter((a) => {
        const pid = String(a.patient_id ?? '');
        if (hasFutureMatchingAppointment(pid, matchesHygieneCc, appointments, now)) return false;
        const m = monthsSinceAppt(a, now);
        return matchesAgeBucket(m, ageBucket) && m !== null && m >= 0;
      })
      .sort((a, b) => (b.appointment_date ?? '').localeCompare(a.appointment_date ?? ''))
      .slice(0, 400)
      .map((a) => apptRow(a, patientsById, now))
      .filter((r): r is QueueRow => !!r);
  }

  const km = KEYWORD_MATCHERS[queueId];
  if (km) {
    return buildCategoryQueue(km, appointments, patientsById, now, ageBucket);
  }

  return [];
}
