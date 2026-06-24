import { differenceInCalendarMonths, startOfDay } from 'date-fns';
import { parseDentrixDate, formatDentrixDateKey } from './dentrix';
import {
  ESTIMATE_CODE_TYPE_FILTER_ALL,
  ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED,
  matchEstimateCodeTypeGroup,
  type CodeTypeMatch,
  type DocumentProcedureContext,
  type ResolvedProcedureCode,
} from './procedureCodeTypes';
import type { DentrixLedgerTransactionDoc } from './ledgerTransactions';
import { buildAdaByProccodeId } from './queueProcedureCodes';

const CHART_COMPLETED = 102;

export type EstimateAgeBucket = 'all' | '0-1' | '1-3' | '3-6' | '6-9' | '9-12' | '12+';

export const ESTIMATE_AGE_BUCKET_OPTIONS: { id: EstimateAgeBucket; label: string }[] = [
  { id: 'all', label: 'All dates' },
  { id: '0-1', label: '0–1 month' },
  { id: '1-3', label: '1–3 months' },
  { id: '3-6', label: '3–6 months' },
  { id: '6-9', label: '6–9 months' },
  { id: '9-12', label: '9–12 months' },
  { id: '12+', label: '1+ year' },
];

export const DEFAULT_ESTIMATE_AGE_BUCKET: EstimateAgeBucket = 'all';

/** Months of documents to load from Firestore before client-side aging filter. */
export const ESTIMATE_DOCUMENT_FETCH_MONTHS = 15;

export type EstimateFollowUpAction =
  | 'left_voicemail'
  | 'text'
  | 'email'
  | 'treatment_booked'
  | 'treatment_finished'
  | 'removed_from_list'
  | 'no_answer'
  | 'patient_declined';

export const ESTIMATE_ACTION_LABELS: Record<EstimateFollowUpAction, string> = {
  left_voicemail: 'Left msg on machine',
  text: 'Text',
  email: 'Email',
  treatment_booked: 'Treatment booked',
  treatment_finished: 'Treatment finished',
  removed_from_list: 'Remove from list',
  no_answer: 'No answer',
  patient_declined: 'Patient/parent declined',
};

export interface EstimateActionHistoryEntry {
  action: EstimateFollowUpAction;
  at: string;
  by: string;
  detail?: string;
}

export function monthsSinceDate(date: Date | null, now = new Date()): number | null {
  if (!date) return null;
  return differenceInCalendarMonths(startOfDay(now), startOfDay(date));
}

export function matchesEstimateAgeBucket(monthsSince: number | null, bucket: EstimateAgeBucket): boolean {
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

export function codesForGroup(ctx: DocumentProcedureContext, groupId: string): ResolvedProcedureCode[] {
  if (groupId === ESTIMATE_CODE_TYPE_FILTER_ALL) return ctx.procedureCodes;
  if (groupId === ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED) {
    return ctx.procedureCodes.filter((c) => !matchEstimateCodeTypeGroup(c.code));
  }
  return ctx.procedureCodes.filter((c) => matchEstimateCodeTypeGroup(c.code)?.id === groupId);
}

export function filterProcedureContextByGroup(
  ctx: DocumentProcedureContext,
  groupId: string
): DocumentProcedureContext {
  const filteredCodes = codesForGroup(ctx, groupId);
  const codeTypes = ctx.codeTypes.filter((t) => {
    if (groupId === ESTIMATE_CODE_TYPE_FILTER_ALL) return true;
    if (groupId === ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED) return t.groupId === 'other' || !ESTIMATE_CODE_TYPE_GROUPS_IDS.has(t.groupId);
    return t.groupId === groupId;
  });
  const primaryCodeType =
    groupId === ESTIMATE_CODE_TYPE_FILTER_ALL || groupId === ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED
      ? (codeTypes[0] ?? null)
      : (codeTypes.find((t) => t.groupId === groupId) ?? codeTypes[0] ?? null);

  return {
    ...ctx,
    procedureCodes: filteredCodes.length ? filteredCodes : ctx.procedureCodes,
    codeTypes: codeTypes.length ? codeTypes : ctx.codeTypes,
    primaryCodeType,
  };
}

const ESTIMATE_CODE_TYPE_GROUPS_IDS = new Set([
  'cbct',
  'resto',
  'crown',
  'root_canal',
  'perio',
  'extraction',
  'implant',
  'ortho',
  'mri_req',
]);

export function primaryCodeTypeForFilter(ctx: DocumentProcedureContext, filterGroupId: string): CodeTypeMatch | null {
  if (filterGroupId === ESTIMATE_CODE_TYPE_FILTER_ALL || filterGroupId === ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED) {
    return ctx.primaryCodeType;
  }
  return ctx.codeTypes.find((t) => t.groupId === filterGroupId) ?? ctx.primaryCodeType;
}

const STRONG_LEDGER_LINK_SOURCES = new Set<DocumentProcedureContext['linkSource']>([
  'ledger_preauth',
  'ledger_claim',
  'ledger_hint_code',
  'insurance_claim',
  'ledger_treatment_planned',
]);

export function resolveTreatmentDate(
  ctx: DocumentProcedureContext,
  documentDate: unknown,
  groupId: string,
  ledgerRows: DentrixLedgerTransactionDoc[],
  adaByProccodeId: Map<number, string>
): { date: Date | null; label: string | null; source: 'ledger' | 'document' } {
  const docDate = parseDentrixDate(documentDate);
  const docLabel = formatDentrixDateKey(documentDate);

  if (!STRONG_LEDGER_LINK_SOURCES.has(ctx.linkSource)) {
    return { date: docDate, label: docLabel, source: 'document' };
  }

  const relevantCodes = new Set(codesForGroup(ctx, groupId).map((c) => c.code));
  if (!relevantCodes.size) {
    relevantCodes.clear();
    ctx.procedureCodes.forEach((c) => relevantCodes.add(c.code));
  }

  const docFloor = docDate ? startOfDay(docDate) : null;
  const linkedCodes = new Set(ctx.procedureCodes.map((c) => c.code));
  const preauthId = Number(ctx.preauthId) || 0;
  const claimId = Number(ctx.claimId) || 0;
  let earliest: Date | null = null;

  for (const row of ledgerRows) {
    if (preauthId && Number(row.preauthid) !== preauthId) continue;
    if (claimId && Number(row.claimid) !== claimId) continue;

    const ada = adaByProccodeId.get(Number(row.proccodeid));
    if (!ada) continue;
    const matchesGroup = relevantCodes.has(ada);
    const matchesLinked = linkedCodes.has(ada);
    if (!matchesGroup && !matchesLinked) continue;

    const procDate = parseDentrixDate(row.procdate ?? row.entrydate);
    if (!procDate) continue;
    if (docFloor && procDate < docFloor) continue;
    if (Number(row.chartstatus) === CHART_COMPLETED || Number(row.chartstatus) === 105) {
      if (!earliest || procDate < earliest) earliest = procDate;
    }
  }

  if (earliest) {
    return { date: earliest, label: formatDentrixDateKey(earliest.toISOString()), source: 'ledger' };
  }

  return { date: docDate, label: docLabel, source: 'document' };
}

/**
 * Preauth code types with a ledger-sourced treatment date mean insurance responded
 * and the amount was posted — no further estimate follow-up needed.
 */
export function isPreauthInsurancePostedOnLedger(
  ctx: DocumentProcedureContext,
  treatmentDateSource: 'ledger' | 'document'
): boolean {
  if (treatmentDateSource !== 'ledger') return false;
  if (ctx.primaryCodeType?.requiresPreauth) return true;
  return ctx.codeTypes.some((t) => t.requiresPreauth);
}

/**
 * Hide / auto-close when ledger shows treatment complete or preauth insurance posted.
 */
export function shouldHideEstimateOnLedgerComplete(
  ctx: DocumentProcedureContext,
  treatmentDateSource: 'ledger' | 'document',
  options?: { documentStatus?: 'book_right_away' | 'covered_eob' | 'needs_follow_up' | 'unclassified' }
): boolean {
  if (isPreauthInsurancePostedOnLedger(ctx, treatmentDateSource)) return true;
  if (ctx.linkSource === 'ledger_preauth') return false;
  if (options?.documentStatus === 'needs_follow_up') return false;
  if (ctx.linkSource === 'insurance_claim') return false;
  if (treatmentDateSource === 'ledger') return true;
  return true;
}

/** Whether an estimate row should be removed / auto-closed based on ledger state. */
export function isEstimateCompleteOnLedger(
  ctx: DocumentProcedureContext,
  groupId: string,
  ledgerRows: DentrixLedgerTransactionDoc[],
  adaByProccodeId: Map<number, string>,
  documentDate: Date | null,
  treatmentDateSource: 'ledger' | 'document',
  options?: { documentStatus?: 'book_right_away' | 'covered_eob' | 'needs_follow_up' | 'unclassified' }
): boolean {
  const procedureContext = filterProcedureContextByGroup(ctx, groupId);
  if (isPreauthInsurancePostedOnLedger(procedureContext, treatmentDateSource)) return true;
  if (
    !isTrackedTreatmentCompleted(procedureContext, groupId, ledgerRows, adaByProccodeId, documentDate)
  ) {
    return false;
  }
  return shouldHideEstimateOnLedgerComplete(ctx, treatmentDateSource, options);
}

/** True when tracked codes are completed in the ledger on or after the document date. */
export function isTrackedTreatmentCompleted(
  ctx: DocumentProcedureContext,
  groupId: string,
  ledgerRows: DentrixLedgerTransactionDoc[],
  adaByProccodeId: Map<number, string>,
  documentDate: Date | null
): boolean {
  const relevantCodes = new Set(codesForGroup(ctx, groupId).map((c) => c.code));
  if (!relevantCodes.size) {
    ctx.procedureCodes.forEach((c) => relevantCodes.add(c.code));
  }
  if (!relevantCodes.size || !documentDate) return false;

  const since = startOfDay(documentDate);

  for (const row of ledgerRows) {
    if (Number(row.chartstatus) !== CHART_COMPLETED) continue;
    const ada = adaByProccodeId.get(Number(row.proccodeid));
    if (!ada || !relevantCodes.has(ada)) continue;
    const procDate = parseDentrixDate(row.procdate ?? row.entrydate);
    if (!procDate || procDate < since) continue;
    return true;
  }
  return false;
}

export function buildAdaByProccodeIdFromProcedureCodes(
  procedureCodes: { proccodeid?: number; adacode?: string }[]
): Map<number, string> {
  return buildAdaByProccodeId(procedureCodes as Parameters<typeof buildAdaByProccodeId>[0]);
}

export function isSnoozed(snoozeUntil: unknown, now = new Date()): boolean {
  const d = parseDentrixDate(snoozeUntil);
  if (!d) return false;
  return startOfDay(d) > startOfDay(now);
}

/** Firestore patch when ledger shows tracked treatment is completed/billed. */
export function autoCloseCompletedEstimatePatch(by: string): Record<string, unknown> {
  return {
    treatmentFinished: true,
    autoClosedLedger: true,
    status: 'closed',
    nextAppointmentBooked: true,
    outcome: 'Treatment completed in ledger',
    lastChanged: new Date().toISOString(),
    contactedBy: by,
  };
}

/** Dedupe estimate rows — one open row per patient + code type group (newest document wins). */
export function dedupeEstimateRows<T extends { patientId: string; codeTypeFilterId: string; docId: number }>(
  rows: T[]
): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.patientId}::${row.codeTypeFilterId}`;
    const prev = byKey.get(key);
    if (!prev || row.docId > prev.docId) byKey.set(key, row);
  }
  return Array.from(byKey.values()).sort((a, b) => b.docId - a.docId);
}

export function parseActionHistory(raw: unknown): EstimateActionHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is EstimateActionHistoryEntry => {
      if (!e || typeof e !== 'object') return false;
      const row = e as EstimateActionHistoryEntry;
      return typeof row.action === 'string' && typeof row.at === 'string';
    })
    .slice(-25);
}
