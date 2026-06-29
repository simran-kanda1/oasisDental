import type { DentrixAppointmentDoc } from './dentrix';
import { parseDentrixDate } from './dentrix';
import { isBefore, startOfDay, subMonths } from 'date-fns';

export const LEDGER_PATIENT_CAP = 2500;
const LEDGER_LOOKBACK_MONTHS = 18;

/** Prioritize patients with visits in the last 18 months, then future appointments, then the rest. */
export function collectLedgerPatientIds(
  appointments: DentrixAppointmentDoc[],
  cap = LEDGER_PATIENT_CAP,
  now = new Date()
): string[] {
  const today = startOfDay(now);
  const lookback = subMonths(today, LEDGER_LOOKBACK_MONTHS);
  const recentPast = new Set<string>();
  const future = new Set<string>();

  for (const a of appointments) {
    const pid = String(a.patient_id ?? '');
    if (!pid) continue;
    const d = parseDentrixDate(a.appointment_date);
    if (!d) continue;
    const day = startOfDay(d);
    if (isBefore(day, today)) {
      if (!isBefore(day, lookback)) recentPast.add(pid);
    } else {
      future.add(pid);
    }
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (pid: string) => {
    if (!pid || seen.has(pid)) return;
    seen.add(pid);
    ids.push(pid);
  };

  for (const pid of recentPast) {
    add(pid);
    if (ids.length >= cap) return ids;
  }
  for (const pid of future) {
    add(pid);
    if (ids.length >= cap) return ids;
  }
  for (const a of appointments) {
    add(String(a.patient_id ?? ''));
    if (ids.length >= cap) return ids;
  }
  return ids;
}
