import type { DentrixAppointmentDoc, DentrixPatientAppointmentInfoDoc } from './dentrix';
import { cleanDentrixText, formatDentrixDateKey, parseDentrixDate } from './dentrix';
import { addMonths, isAfter, isBefore, isSameDay, startOfDay } from 'date-fns';

/** Today or any later calendar day — used for “has a future appointment booked”. */
export function isAppointmentOnOrAfterToday(apptDate: Date, today: Date): boolean {
  return !isBefore(startOfDay(apptDate), startOfDay(today));
}

/**
 * Parse recall interval from appointment label.
 * 4M / 4m / 4 mo / 2 months → 4 or 2 (months until next visit is expected).
 */
export function parseRecallIntervalMonths(label: string): number | null {
  const s = label.toLowerCase();
  const patterns = [
    /\b(\d{1,2})\s*m(?:o(?:nth)?s?)?\b/,
    /(?:^|\s)(\d{1,2})m(?:\s|$)/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 24) return n;
    }
  }
  return null;
}

/** Last visit + interval months (e.g. Apr 10 + 2M → Jun 10). */
export function getRecallDueDate(
  appt: DentrixAppointmentDoc,
  intervalMonths?: number | null
): Date | null {
  const visitDate = parseDentrixDate(appt.appointment_date);
  if (!visitDate) return null;
  const interval =
    intervalMonths ?? parseRecallIntervalMonths(appointmentLabelText(appt));
  if (interval === null) return null;
  return addMonths(startOfDay(visitDate), interval);
}

/** Overdue when today is on or after the recall due date. */
export function isRecallOverdue(appt: DentrixAppointmentDoc, now: Date): boolean {
  const interval = parseRecallIntervalMonths(appointmentLabelText(appt));
  if (interval === null) return true;
  const dueDate = getRecallDueDate(appt, interval);
  if (!dueDate) return false;
  return !isBefore(startOfDay(now), dueDate);
}

export function appointmentLabelText(a: DentrixAppointmentDoc): string {
  const extra = a as DentrixAppointmentDoc & {
    description?: string;
    note?: string;
    notes?: string;
    production_type_desc?: string;
    procedure_description?: string;
  };
  const parts = [
    cleanDentrixText(a.reason),
    cleanDentrixText(a.appointment_type),
    cleanDentrixText(a.appt_type),
    cleanDentrixText(a.appointmentType),
    cleanDentrixText(extra.description),
    cleanDentrixText(extra.note),
    cleanDentrixText(extra.notes),
    cleanDentrixText(extra.production_type_desc),
    cleanDentrixText(extra.procedure_description),
  ].filter(Boolean);
  return parts.join(' ').toLowerCase();
}

/** Oasis hygiene appointment production types (Dentrix appointment category). */
export const HYGIENE_PRODUCTION_TYPES = ['HYG1', 'HYG2', 'HYRA', 'HYCP'] as const;

const HYGIENE_PRODUCTION_TYPE_RE = /\b(HYG1|HYG2|HYRA|HYCP)\b/i;

/** True when the appointment category is a hygiene production type. */
export function isHygieneProductionType(a: DentrixAppointmentDoc): boolean {
  const extra = a as DentrixAppointmentDoc & {
    production_type_desc?: string;
    production_type_abbr?: string;
    production_type_code?: string;
  };
  const text = [
    cleanDentrixText(a.appointment_type),
    cleanDentrixText(a.appt_type),
    cleanDentrixText(a.appointmentType),
    cleanDentrixText(extra.production_type_desc),
    cleanDentrixText(extra.production_type_abbr),
    cleanDentrixText(extra.production_type_code),
  ]
    .filter(Boolean)
    .join(' ');
  return HYGIENE_PRODUCTION_TYPE_RE.test(text);
}

/** Dentrix / practice varies — broaden matchers and tune status_id if needed */
export function isAppointmentNoShow(a: DentrixAppointmentDoc): boolean {
  const s = appointmentLabelText(a);
  if (/\b(no[\s-]?show|n\/s|n\.s\.|broken|cancelled short|dns|d\.n\.s)\b/i.test(s)) return true;
  const sid = Number(a.status_id ?? 0);
  if ([3, 5, 21, 22].includes(sid)) return true;
  return false;
}

/** Broken / cancelled — do not count as a booked future visit. */
export function isAppointmentCancelledOrBroken(a: DentrixAppointmentDoc): boolean {
  if (isAppointmentNoShow(a)) return true;
  const s = appointmentLabelText(a);
  return /\b(cancelled|canceled|broken appt|brk appt)\b/i.test(s);
}

export function isActiveScheduledAppointment(a: DentrixAppointmentDoc, today: Date): boolean {
  const d = parseDentrixDate(a.appointment_date);
  if (!d || !isAppointmentOnOrAfterToday(d, today)) return false;
  return !isAppointmentCancelledOrBroken(a);
}

export function isEstimateAppointment(a: DentrixAppointmentDoc): boolean {
  return Number(a.amount ?? 0) > 0 || Number(a.production_type ?? 0) > 0;
}

export function isEstimateSent(a: DentrixAppointmentDoc): boolean {
  return a.estimate_sent === true;
}

export function patientHasFutureAppointmentAfter(
  patientId: string,
  afterDate: Date,
  appointments: DentrixAppointmentDoc[],
  today: Date
): boolean {
  const t0 = startOfDay(today);
  const after = startOfDay(afterDate);
  return appointments.some((x) => {
    if (String(x.patient_id ?? '') !== patientId) return false;
    const d = parseDentrixDate(x.appointment_date);
    if (!d) return false;
    if (!isAfter(d, after)) return false;
    if (!isAfter(d, t0)) return false;
    return true;
  });
}

export function isEstimateTypeAppointmentLabel(label: string): boolean {
  return /\b(estimate|treatment plan|tx plan|financial|pre-?det|predet|presentation)\b/i.test(label);
}

/** Future appointment whose text matches estimate / treatment plan style visits. */
export function patientHasFutureEstimateTypeAppointment(
  patientId: string,
  appointments: DentrixAppointmentDoc[],
  today: Date
): boolean {
  const t0 = startOfDay(today);
  return appointments.some((x) => {
    if (String(x.patient_id ?? '') !== patientId) return false;
    if (!isEstimateTypeAppointmentLabel(appointmentLabelText(x))) return false;
    const d = parseDentrixDate(x.appointment_date);
    return !!d && isAfter(d, t0);
  });
}

function appointmentReasonLabel(a: DentrixAppointmentDoc): string {
  return (
    cleanDentrixText(a.reason) ||
    cleanDentrixText(a.appointment_type) ||
    cleanDentrixText(a.appt_type) ||
    cleanDentrixText(a.appointmentType) ||
    '—'
  );
}

/** Earliest future appointment per patient for estimates tables. */
export function buildNextAppointmentLabelByPatientId(
  appointments: DentrixAppointmentDoc[],
  patientInfoById: Record<string, DentrixPatientAppointmentInfoDoc> = {},
  today: Date = new Date()
): Record<string, string> {
  const t0 = startOfDay(today);
  const earliest: Record<string, { at: Date; appt: DentrixAppointmentDoc }> = {};

  for (const a of appointments) {
    const pid = String(a.patient_id ?? '');
    if (!pid) continue;
    const d = parseDentrixDate(a.appointment_date);
    if (!d || !isAfter(d, t0)) continue;
    const cur = earliest[pid];
    if (!cur || d < cur.at) earliest[pid] = { at: d, appt: a };
  }

  const out: Record<string, string> = {};
  for (const [pid, { appt }] of Object.entries(earliest)) {
    const dateLabel = formatDentrixDateKey(appt.appointment_date) ?? '—';
    out[pid] = `${dateLabel} · ${appointmentReasonLabel(appt)}`;
  }

  for (const info of Object.values(patientInfoById)) {
    const pid = String(info.patient_id ?? info.id);
    if (!pid || out[pid]) continue;
    const d = parseDentrixDate(info.next_appointment_date);
    if (!d || !isAfter(d, t0)) continue;
    const dateLabel = formatDentrixDateKey(info.next_appointment_date);
    const onDate = appointments.filter((a) => {
      if (String(a.patient_id ?? '') !== pid) return false;
      const ad = parseDentrixDate(a.appointment_date);
      return !!ad && isSameDay(ad, d);
    });
    onDate.sort((a, b) => {
      const da = parseDentrixDate(a.appointment_date)?.getTime() ?? 0;
      const db = parseDentrixDate(b.appointment_date)?.getTime() ?? 0;
      return da - db;
    });
    const reason = onDate[0] ? appointmentReasonLabel(onDate[0]) : '—';
    out[pid] = `${dateLabel} · ${reason}`;
  }

  return out;
}
