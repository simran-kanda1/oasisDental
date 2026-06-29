import type { DentrixAppointmentDoc } from './dentrix';
import { parseDentrixDate } from './dentrix';
import { appointmentLabelText, isEstimateAppointment, matchesNewPatientAppointmentText } from './appointmentHeuristics';
import { addDays, isBefore, startOfDay, subDays, subMonths } from 'date-fns';

export type PostVisitWindow = 'week' | 'month' | '3mo';
export type PostVisitCategory = 'emerg' | 'np' | 'ortho' | 'estimate';

export function postVisitCategoryMatch(cat: PostVisitCategory, a: DentrixAppointmentDoc): boolean {
  const s = appointmentLabelText(a);
  switch (cat) {
    case 'emerg':
      return /\b(emerg|emergency|pain|swelling|walk[\s-]?in)\b/i.test(s);
    case 'np':
      return matchesNewPatientAppointmentText(s);
    case 'ortho':
      return /\b(ortho|orthodont|braces|invisalign|aligner)\b/i.test(s);
    case 'estimate':
      return isEstimateAppointment(a) || /\b(estimate|treatment plan|tx plan|financial)\b/i.test(s);
    default:
      return false;
  }
}

export function appointmentInPastWindow(a: DentrixAppointmentDoc, now: Date, window: PostVisitWindow): boolean {
  const d = parseDentrixDate(a.appointment_date);
  if (!d) return false;
  const t0 = startOfDay(now);
  const end = addDays(t0, 1);
  if (!isBefore(d, end)) return false;
  const start = startOfDay(
    window === 'week' ? subDays(t0, 7) : window === 'month' ? subMonths(t0, 1) : subMonths(t0, 3)
  );
  return !isBefore(d, start);
}
