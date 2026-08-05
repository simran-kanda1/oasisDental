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

/** Only use ledger rows from the last N months when filling estimate procedure detail. */
export const ESTIMATE_LEDGER_LOOKBACK_MONTHS = 12;

export type EstimateFollowUpAction =
  | 'left_voicemail'
  | 'text'
  | 'email'
  | 'treatment_booked'
  | 'treatment_finished'
  | 'removed_from_list'
  | 'no_answer'
  | 'patient_declined'
  | 'watch'
  | 'estimate_received'
  | 'estimate_not_received';

export const ESTIMATE_ACTION_LABELS: Record<EstimateFollowUpAction, string> = {
  left_voicemail: 'Left msg on machine',
  text: 'Text',
  email: 'Email',
  treatment_booked: 'Treatment booked',
  treatment_finished: 'Treatment finished',
  removed_from_list: 'Remove from list',
  no_answer: 'No answer',
  patient_declined: 'Patient/parent declined',
  watch: 'Watch',
  estimate_received: 'Estimate received',
  estimate_not_received: 'Estimate not received',
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

function coveragePercent(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Insurance paid ÷ fee on a ledger line. Null when fee or payment has not posted. */
export function coveragePercentFromLedgerAmounts(
  charge: unknown,
  primaryPaid: unknown,
  secondaryPaid: unknown = 0
): number | null {
  const amt = Number(charge);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  const paid = (Number(primaryPaid) || 0) + (Number(secondaryPaid) || 0);
  if (paid <= 0) return null;
  return (paid / amt) * 100;
}

function ledgerCoveragePercentsForCode(
  code: ResolvedProcedureCode,
  ctx: DocumentProcedureContext,
  ledgerRows: DentrixLedgerTransactionDoc[],
  adaByProccodeId: Map<number, string>
): number[] {
  const linked: number[] = [];
  const matching: number[] = [];

  for (const row of ledgerRows) {
    if (adaByProccodeId.get(Number(row.proccodeid)) !== code.code) continue;
    const pct = coveragePercentFromLedgerAmounts(row.amt, row.amtpriminspaid, row.amtsecinspaid);
    if (pct == null) continue;
    matching.push(pct);
    if (ctx.preauthId && Number(row.preauthid) === ctx.preauthId) linked.push(pct);
    else if (ctx.claimId && Number(row.claimid) === ctx.claimId) linked.push(pct);
  }

  if (linked.length) return linked;
  if (matching.length) return matching;

  const fromCode = coveragePercentFromLedgerAmounts(
    code.chargeAmount,
    code.primaryInsurancePortion,
    code.secondaryInsurancePortion
  );
  return fromCode == null ? [] : [fromCode];
}

export function applyLedgerCoverageToContext(
  ctx: DocumentProcedureContext,
  ledgerRows: DentrixLedgerTransactionDoc[],
  adaByProccodeId: Map<number, string>
): DocumentProcedureContext {
  const procedureCodes = ctx.procedureCodes.map((code) => {
    const matchingRows = ledgerRows.filter((row) => adaByProccodeId.get(Number(row.proccodeid)) === code.code);
    const preferred =
      matchingRows.find((row) => ctx.preauthId && Number(row.preauthid) === ctx.preauthId) ??
      matchingRows.find((row) => ctx.claimId && Number(row.claimid) === ctx.claimId) ??
      matchingRows.find((row) => (Number(row.amtpriminspaid) || 0) + (Number(row.amtsecinspaid) || 0) > 0) ??
      null;
    if (!preferred) return code;
    return {
      ...code,
      chargeAmount: Number(preferred.amt) || code.chargeAmount,
      primaryInsurancePortion: Number(preferred.amtpriminspaid) || 0,
      secondaryInsurancePortion: Number(preferred.amtsecinspaid) || 0,
    };
  });

  const coveredCtx = { ...ctx, procedureCodes };
  const codeTypes = ctx.codeTypes.map((type) => {
    const typeCodes = procedureCodes.filter((code) => {
      const group = matchEstimateCodeTypeGroup(code.code);
      if (group) return group.id === type.groupId;
      return type.groupId === 'other' || type.groupId.startsWith('cov-');
    });
    const pool = typeCodes.length ? typeCodes : procedureCodes;
    const pcts = pool.flatMap((code) =>
      ledgerCoveragePercentsForCode(code, coveredCtx, ledgerRows, adaByProccodeId)
    );
    return {
      ...type,
      percentCov: pcts.length ? Math.round(Math.min(...pcts)) : undefined,
    };
  });

  const primaryCodeType = ctx.primaryCodeType
    ? (codeTypes.find((t) => t.groupId === ctx.primaryCodeType!.groupId) ?? null)
    : (codeTypes[0] ?? null);

  return { ...coveredCtx, codeTypes, primaryCodeType };
}

/** Hide only when every tracked ledger procedure is fully covered (100%). Unknown stays visible. */
export function isEstimateFullyCovered(
  ctx: DocumentProcedureContext,
  ledgerRows: DentrixLedgerTransactionDoc[] = [],
  adaByProccodeId: Map<number, string> = new Map()
): boolean {
  if (ctx.procedureCodes.length) {
    return ctx.procedureCodes.every((code) => {
      const pcts = ledgerCoveragePercentsForCode(code, ctx, ledgerRows, adaByProccodeId);
      return pcts.length > 0 && pcts.every((pct) => pct >= 99.5);
    });
  }

  const types = ctx.codeTypes.length
    ? ctx.codeTypes
    : ctx.primaryCodeType
      ? [ctx.primaryCodeType]
      : [];
  if (!types.length) return false;
  return types.every((t) => {
    const pct = coveragePercent(t.percentCov);
    return pct !== null && pct >= 100;
  });
}

/**
 * @deprecated Ledger completion alone should not hide estimates — only 100% coverage does.
 * Kept for callers/tests during the transition.
 */
export function shouldHideEstimateOnLedgerComplete(
  ctx: DocumentProcedureContext,
  _treatmentDateSource: 'ledger' | 'document',
  _options?: { documentStatus?: 'book_right_away' | 'covered_eob' | 'needs_follow_up' | 'unclassified' }
): boolean {
  return isEstimateFullyCovered(ctx);
}

/** Whether an estimate row should be removed based on 100% ledger coverage. */
export function isEstimateCompleteOnLedger(
  ctx: DocumentProcedureContext,
  groupId: string,
  ledgerRows: DentrixLedgerTransactionDoc[],
  adaByProccodeId: Map<number, string>,
  _documentDate: Date | null,
  _treatmentDateSource: 'ledger' | 'document',
  _options?: { documentStatus?: 'book_right_away' | 'covered_eob' | 'needs_follow_up' | 'unclassified' }
): boolean {
  return isEstimateFullyCovered(
    filterProcedureContextByGroup(ctx, groupId),
    ledgerRows,
    adaByProccodeId
  );
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
