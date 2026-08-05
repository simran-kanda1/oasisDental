import { format } from 'date-fns';
import {
  formatDentrixDateKey,
  formatDentrixTimeLabel,
  parseDentrixDate,
  type DentrixAppointmentDoc,
} from './dentrix';
import type { DentrixLedgerTransactionDoc } from './ledgerTransactions';

const DAY_MS = 24 * 60 * 60 * 1000;
const APPOINTMENT_LEDGER_MATCH_DAYS = 14;

export type EstimateSentSource = 'appointment' | 'ledger' | 'document';

export interface EstimateSentVisit {
  label: string;
  source: EstimateSentSource;
}

export function formatAppointmentDateTimeLabel(appt: DentrixAppointmentDoc): string | null {
  const dateLabel = formatDentrixDateKey(appt.appointment_date);
  if (!dateLabel) return null;
  if (typeof appt.start_hour === 'number' && typeof appt.start_minute === 'number') {
    const time = formatDentrixTimeLabel(appt.start_hour, appt.start_minute);
    if (time && time !== 'Unknown') return `${dateLabel} · ${time}`;
  }
  return dateLabel;
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return format(a, 'yyyy-MM-dd') === format(b, 'yyyy-MM-dd');
}

function relatedLedgerRows(options: {
  procedureCodes: string[];
  preauthId?: number | null;
  claimId?: number | null;
  ledgerRows: DentrixLedgerTransactionDoc[];
  adaByProccodeId: Map<number, string>;
}): DentrixLedgerTransactionDoc[] {
  const codes = new Set(options.procedureCodes.map((code) => code.toUpperCase()));
  return options.ledgerRows.filter((row) => {
    if (options.preauthId && Number(row.preauthid) === options.preauthId) return true;
    if (options.claimId && Number(row.claimid) === options.claimId) return true;
    const ada = options.adaByProccodeId.get(Number(row.proccodeid));
    return !!ada && codes.has(ada);
  });
}

/**
 * Document present = estimate went out.
 * Date/time comes from the appointment that matches the related ledger visit,
 * then ledger procdate, then the document date.
 */
export function resolveEstimateSentVisit(options: {
  documentDate?: string | null;
  procedureCodes: string[];
  preauthId?: number | null;
  claimId?: number | null;
  ledgerRows: DentrixLedgerTransactionDoc[];
  appointments: DentrixAppointmentDoc[];
  adaByProccodeId: Map<number, string>;
}): EstimateSentVisit | null {
  const related = relatedLedgerRows(options);
  const plannedDates = related
    .filter((row) => Number(row.chartstatus) === 105)
    .map((row) => parseDentrixDate(row.procdate ?? row.entrydate))
    .filter((d): d is Date => !!d);
  const allDates = related
    .map((row) => parseDentrixDate(row.procdate ?? row.entrydate))
    .filter((d): d is Date => !!d);
  const ledgerDates = plannedDates.length ? plannedDates : allDates;
  const docDate = parseDentrixDate(options.documentDate);

  let bestAppt: DentrixAppointmentDoc | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const appt of options.appointments) {
    const apptDate = parseDentrixDate(appt.appointment_date);
    if (!apptDate) continue;
    const sameDay = ledgerDates.some((ledgerDate) => sameCalendarDay(apptDate, ledgerDate));
    if (!sameDay) continue;
    const score = docDate ? Math.abs(apptDate.getTime() - docDate.getTime()) : 0;
    if (score < bestScore) {
      bestScore = score;
      bestAppt = appt;
    }
  }

  if (!bestAppt && docDate) {
    for (const appt of options.appointments) {
      const apptDate = parseDentrixDate(appt.appointment_date);
      if (!apptDate || apptDate.getTime() > docDate.getTime()) continue;
      if (ledgerDates.length) {
        const nearLedger = ledgerDates.some(
          (ledgerDate) => Math.abs(ledgerDate.getTime() - apptDate.getTime()) <= APPOINTMENT_LEDGER_MATCH_DAYS * DAY_MS
        );
        if (!nearLedger) continue;
      }
      const score = docDate.getTime() - apptDate.getTime();
      if (score >= 0 && score < bestScore) {
        bestScore = score;
        bestAppt = appt;
      }
    }
  }

  if (bestAppt) {
    const label = formatAppointmentDateTimeLabel(bestAppt);
    if (label) return { label, source: 'appointment' };
  }

  const earliestLedger = [...ledgerDates].sort((a, b) => a.getTime() - b.getTime())[0];
  if (earliestLedger) {
    return { label: format(earliestLedger, 'yyyy-MM-dd'), source: 'ledger' };
  }

  const docLabel = formatDentrixDateKey(options.documentDate);
  if (docLabel) return { label: docLabel, source: 'document' };
  return null;
}
