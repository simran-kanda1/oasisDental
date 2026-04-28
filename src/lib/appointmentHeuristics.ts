import type { DentrixAppointmentDoc } from './dentrix';
import { cleanDentrixText, parseDentrixDate } from './dentrix';
import { isAfter, startOfDay } from 'date-fns';

export function appointmentLabelText(a: DentrixAppointmentDoc): string {
  const parts = [
    cleanDentrixText(a.reason),
    cleanDentrixText(a.appointment_type),
    cleanDentrixText(a.appt_type),
    cleanDentrixText(a.appointmentType),
  ].filter(Boolean);
  return parts.join(' ').toLowerCase();
}

/** Dentrix / practice varies — broaden matchers and tune status_id if needed */
export function isAppointmentNoShow(a: DentrixAppointmentDoc): boolean {
  const s = appointmentLabelText(a);
  if (/\b(no[\s-]?show|n\/s|n\.s\.|broken|cancelled short|dns|d\.n\.s)\b/i.test(s)) return true;
  const sid = Number(a.status_id ?? 0);
  if ([3, 5, 21, 22].includes(sid)) return true;
  return false;
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
