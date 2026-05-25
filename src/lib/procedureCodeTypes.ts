import { cleanDentrixText } from './dentrix';
import {
  claimPatientId,
  findClaimForDocument,
  resolveClaimProcedureLines,
  type DentrixInsuranceClaimDoc,
} from './insuranceClaimEstimates';
import {
  extractLedgerIdCandidates,
  resolveLedgerProceduresForDocument,
  type DentrixLedgerTransactionDoc,
  type LedgerProcedureLine,
} from './ledgerTransactions';

/** Dentrix procedure_codes collection (v_proccodes). */
export interface DentrixProcedureCodeDoc {
  id: string;
  proccodeid?: number;
  adacode?: string;
  descript?: string;
  abbrevdescript?: string;
}

/** Dentrix coverage_tables (v_coverage_table). */
export interface DentrixCoverageTableDoc {
  id: string;
  table_id?: number;
  begining_proc?: string;
  ending_proc?: string;
  name?: string;
  percent_cov?: number;
  requires_preauth?: number;
  copayment?: number;
}

/** Dentrix insured (v_insuredtable). */
export interface DentrixInsuredDoc {
  id: string;
  ins_plan_id?: number;
  ins_party_guid?: string;
  ins_type?: number;
}

/** Optional procedure_log when synced (v_proclog). */
export interface DentrixProcedureLogDoc {
  id: string;
  patient_id?: number;
  patid?: number;
  proccodeid?: number;
  adacode?: string;
  procdate?: string;
  createdate?: string;
  chartstatus?: number;
}

/** Office custom list ranges (Letter / Custom List Setup screenshots). */
export interface EstimateCodeTypeGroup {
  id: string;
  label: string;
  begin: string;
  end: string;
}

export const ESTIMATE_CODE_TYPE_GROUPS: EstimateCodeTypeGroup[] = [
  { id: 'cbct', label: 'CBCT', begin: '07000', end: '07043' },
  { id: 'resto', label: 'Resto', begin: '23111', end: '23515' },
  { id: 'crown', label: 'Crown', begin: '27000', end: '27999' },
  { id: 'root_canal', label: 'Root canal tx', begin: '30000', end: '39999' },
  { id: 'perio', label: 'Perio / GG / BB / M', begin: '40000', end: '49999' },
  { id: 'extraction', label: 'Extraction', begin: '71101', end: '72331' },
  { id: 'implant', label: 'Implant', begin: '79000', end: 'AOX-SXG' },
  { id: 'ortho', label: 'Ortho', begin: '80000', end: '89999' },
  { id: 'mri_req', label: 'MRI req given', begin: 'M0000020', end: 'M0000026' },
];

export const ESTIMATE_CODE_TYPE_FILTER_ALL = 'all';
export const ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED = 'uncategorized';

export interface ResolvedProcedureCode {
  code: string;
  description: string | null;
  primaryInsurancePortion?: number | null;
  writeOff?: number | null;
  chargeAmount?: number | null;
}

export interface CodeTypeMatch {
  groupId: string;
  label: string;
  coverageName?: string;
  percentCov?: number;
  requiresPreauth?: boolean;
}

export type ProcedureLinkSource =
  | 'document_text'
  | 'insurance_claim'
  | 'ledger_preauth'
  | 'ledger_claim'
  | 'ledger_date'
  | 'ledger_treatment_planned';

export interface DocumentProcedureContext {
  procedureCodes: ResolvedProcedureCode[];
  codeTypes: CodeTypeMatch[];
  primaryCodeType: CodeTypeMatch | null;
  insurancePlanId: number | null;
  linkSource?: ProcedureLinkSource | null;
  preauthId?: number | null;
  claimId?: number | null;
}

const CODE_TOKEN_RE = /\b(\d{4,5}|M\d{7,8})\b/gi;

/** Normalize Dentrix CHAR fields (often padded with spaces). */
export function normalizeProcedureCode(value: unknown): string {
  return cleanDentrixText(value).toUpperCase();
}

function isNumericCode(code: string): boolean {
  return /^\d+$/.test(code);
}

/** Inclusive range check; supports numeric padding and alphanumeric implant ranges. */
export function isProcedureCodeInRange(code: string, begin: string, end: string): boolean {
  const c = normalizeProcedureCode(code);
  const b = normalizeProcedureCode(begin);
  const e = normalizeProcedureCode(end);
  if (!c || !b || !e) return false;

  if (isNumericCode(c) && isNumericCode(b) && isNumericCode(e)) {
    const width = Math.max(c.length, b.length, e.length);
    const pad = (n: string) => n.padStart(width, '0');
    return pad(c) >= pad(b) && pad(c) <= pad(e);
  }
  return c >= b && c <= e;
}

export function buildProcedureCodeByAdaMap(codes: DentrixProcedureCodeDoc[]): Map<string, DentrixProcedureCodeDoc> {
  const map = new Map<string, DentrixProcedureCodeDoc>();
  for (const row of codes) {
    const ada = normalizeProcedureCode(row.adacode);
    if (ada) map.set(ada, row);
  }
  return map;
}

export function buildInsuredByPatientGuidMap(rows: DentrixInsuredDoc[]): Map<string, DentrixInsuredDoc> {
  const map = new Map<string, DentrixInsuredDoc>();
  for (const row of rows) {
    if (Number(row.ins_type) !== 0) continue;
    const guid = cleanDentrixText(row.ins_party_guid).toLowerCase();
    if (!guid) continue;
    map.set(guid, row);
  }
  return map;
}

export function buildCoverageRangesByPlanId(rows: DentrixCoverageTableDoc[]): Map<number, DentrixCoverageTableDoc[]> {
  const map = new Map<number, DentrixCoverageTableDoc[]>();
  for (const row of rows) {
    const planId = Number(row.table_id);
    if (!Number.isFinite(planId)) continue;
    const list = map.get(planId) ?? [];
    list.push(row);
    map.set(planId, list);
  }
  return map;
}

export function matchEstimateCodeTypeGroup(code: string): EstimateCodeTypeGroup | null {
  for (const group of ESTIMATE_CODE_TYPE_GROUPS) {
    if (isProcedureCodeInRange(code, group.begin, group.end)) return group;
  }
  return null;
}

export function matchCoverageCategory(
  code: string,
  planId: number | null,
  coverageByPlanId: Map<number, DentrixCoverageTableDoc[]>
): DentrixCoverageTableDoc | null {
  if (!planId || !coverageByPlanId.has(planId)) return null;
  for (const row of coverageByPlanId.get(planId) ?? []) {
    const begin = row.begining_proc ?? '';
    const end = row.ending_proc ?? '';
    if (isProcedureCodeInRange(code, begin, end)) return row;
  }
  return null;
}

export function extractProcedureCodesFromText(
  text: string,
  adaIndex?: Map<string, DentrixProcedureCodeDoc>
): string[] {
  const raw = cleanDentrixText(text);
  if (!raw) return [];

  const found = new Set<string>();
  for (const match of raw.matchAll(CODE_TOKEN_RE)) {
    let token = normalizeProcedureCode(match[1]);
    if (!token) continue;
    if (isNumericCode(token) && token.length === 4) {
      const asFive = token.padStart(5, '0');
      if (adaIndex?.has(asFive)) token = asFive;
    }
    if (adaIndex && !adaIndex.has(token)) {
      const inRange = ESTIMATE_CODE_TYPE_GROUPS.some((g) => isProcedureCodeInRange(token, g.begin, g.end));
      if (!inRange) continue;
    }
    found.add(token);
  }
  return [...found].sort();
}

export function resolveProcedureCodes(
  tokens: string[],
  adaIndex: Map<string, DentrixProcedureCodeDoc>
): ResolvedProcedureCode[] {
  return tokens.map((code) => {
    const row = adaIndex.get(code);
    const description = row ? cleanDentrixText(row.descript) || cleanDentrixText(row.abbrevdescript) : null;
    return { code, description };
  });
}

export function resolveCodeTypesForCodes(
  codes: string[],
  options?: {
    planId?: number | null;
    coverageByPlanId?: Map<number, DentrixCoverageTableDoc[]>;
  }
): CodeTypeMatch[] {
  const { planId = null, coverageByPlanId = new Map() } = options ?? {};
  const seen = new Set<string>();
  const out: CodeTypeMatch[] = [];

  for (const code of codes) {
    const group = matchEstimateCodeTypeGroup(code);
    const coverage = matchCoverageCategory(code, planId, coverageByPlanId);
    const groupId = group?.id ?? (coverage ? `cov-${normalizeProcedureCode(coverage.name)}` : 'other');
    if (seen.has(groupId)) continue;
    seen.add(groupId);

    const coverageName = coverage ? cleanDentrixText(coverage.name) : undefined;
    out.push({
      groupId,
      label: group?.label ?? coverageName ?? 'Other',
      coverageName,
      percentCov: coverage?.percent_cov,
      requiresPreauth: Number(coverage?.requires_preauth) === 1,
    });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function formatCodeTypeLabel(match: CodeTypeMatch): string {
  const parts = [match.label];
  if (typeof match.percentCov === 'number' && match.percentCov > 0) {
    parts.push(`${match.percentCov}% cov`);
  }
  if (match.requiresPreauth) parts.push('preauth');
  return parts.join(' · ');
}

export function formatProcedureCodesSummary(codes: ResolvedProcedureCode[]): string {
  if (!codes.length) return '';
  return codes
    .map((c) => {
      const base = c.description ? `${c.code} — ${c.description}` : c.code;
      const fin: string[] = [];
      if (typeof c.primaryInsurancePortion === 'number' && c.primaryInsurancePortion > 0) {
        fin.push(`ins $${c.primaryInsurancePortion.toFixed(2)}`);
      }
      if (typeof c.writeOff === 'number' && c.writeOff > 0) {
        fin.push(`write-off $${c.writeOff.toFixed(2)}`);
      }
      return fin.length ? `${base} (${fin.join(', ')})` : base;
    })
    .join('; ');
}

function ledgerMatchToLinkSource(
  reason: ReturnType<typeof resolveLedgerProceduresForDocument>['matchReason']
): ProcedureLinkSource | null {
  switch (reason) {
    case 'preauth_id':
      return 'ledger_preauth';
    case 'claim_id':
      return 'ledger_claim';
    case 'date_window':
    case 'hint_code':
      return 'ledger_date';
    case 'treatment_planned':
      return 'ledger_treatment_planned';
    default:
      return null;
  }
}

function resolveCodesFromLedgerLines(
  lines: LedgerProcedureLine[],
  adaByProccodeId: Map<number, string>,
  adaIndex: Map<string, DentrixProcedureCodeDoc>
): ResolvedProcedureCode[] {
  const tokens: string[] = [];
  const financial = new Map<string, Partial<ResolvedProcedureCode>>();

  for (const line of lines) {
    const ada = adaByProccodeId.get(line.proccodeid);
    if (!ada) continue;
    tokens.push(ada);
    const prev = financial.get(ada) ?? {};
    financial.set(ada, {
      primaryInsurancePortion:
        line.primaryInsurancePaid ?? prev.primaryInsurancePortion ?? null,
      chargeAmount: line.amt ?? prev.chargeAmount ?? null,
    });
  }

  return resolveProcedureCodes(tokens, adaIndex).map((row) => ({
    ...row,
    ...financial.get(row.code),
  }));
}

function resolveCodesFromInsuranceClaim(
  claim: DentrixInsuranceClaimDoc,
  adaByProccodeId: Map<number, string>,
  adaIndex: Map<string, DentrixProcedureCodeDoc>
): ResolvedProcedureCode[] {
  const tokens: string[] = [];
  const financial = new Map<string, Partial<ResolvedProcedureCode>>();

  for (const line of resolveClaimProcedureLines(claim)) {
    let ada = line.adacode;
    if (!ada && line.proccodeid && adaByProccodeId.has(line.proccodeid)) {
      ada = adaByProccodeId.get(line.proccodeid)!;
    }
    if (!ada) continue;
    tokens.push(ada);
    financial.set(ada, {
      primaryInsurancePortion: line.primaryInsurancePortion,
      writeOff: line.writeOff,
    });
  }

  return resolveProcedureCodes([...new Set(tokens)], adaIndex).map((row) => ({
    ...row,
    ...financial.get(row.code),
  }));
}

/** Treatment-planned procedures for a patient (chartstatus 105), when procedure_log is synced. */
export function procedureLogCodesForPatient(
  patientId: string,
  logs: DentrixProcedureLogDoc[],
  adaByProccodeId: Map<number, string>
): string[] {
  const pid = Number(patientId);
  if (!Number.isFinite(pid)) return [];

  const tokens = new Set<string>();
  for (const row of logs) {
    const rowPid = Number(row.patient_id ?? row.patid);
    if (rowPid !== pid) continue;
    if (Number(row.chartstatus) !== 105) continue;

    const fromRow = normalizeProcedureCode(row.adacode);
    if (fromRow) tokens.add(fromRow);
    const proccodeId = Number(row.proccodeid);
    if (Number.isFinite(proccodeId) && adaByProccodeId.has(proccodeId)) {
      tokens.add(adaByProccodeId.get(proccodeId)!);
    }
  }
  return [...tokens].sort();
}

export function buildDocumentProcedureContext(options: {
  descript: string;
  patientId: string;
  patientGuid?: string | null;
  documentDate?: string | null;
  procedureLogs?: DentrixProcedureLogDoc[];
  ledgerRows?: DentrixLedgerTransactionDoc[];
  insuranceClaims?: DentrixInsuranceClaimDoc[];
  procedureCodes: DentrixProcedureCodeDoc[];
  insuredByGuid: Map<string, DentrixInsuredDoc>;
  coverageByPlanId: Map<number, DentrixCoverageTableDoc[]>;
}): DocumentProcedureContext {
  const adaIndex = buildProcedureCodeByAdaMap(options.procedureCodes);
  const adaByProccodeId = new Map<number, string>();
  for (const row of options.procedureCodes) {
    const id = Number(row.proccodeid);
    const ada = normalizeProcedureCode(row.adacode);
    if (Number.isFinite(id) && ada) adaByProccodeId.set(id, ada);
  }

  const fromText = extractProcedureCodesFromText(options.descript, adaIndex);
  const fromLog = options.procedureLogs
    ? procedureLogCodesForPatient(options.patientId, options.procedureLogs, adaByProccodeId)
    : [];

  let linkSource: ProcedureLinkSource | null = fromText.length ? 'document_text' : null;
  let preauthId: number | null = null;
  let claimId: number | null = null;
  let procedureCodes: ResolvedProcedureCode[] = [];

  const idCandidates = extractLedgerIdCandidates(options.descript);
  const pid = Number(options.patientId);
  const claimsForPatient =
    options.insuranceClaims?.filter((c) => claimPatientId(c) === pid) ?? [];

  const matchedClaim = findClaimForDocument({
    patientId: options.patientId,
    descript: options.descript,
    claimsForPatient,
    idCandidates,
  });

  if (matchedClaim) {
    const fromClaim = resolveCodesFromInsuranceClaim(matchedClaim, adaByProccodeId, adaIndex);
    if (fromClaim.length) {
      procedureCodes = fromClaim;
      linkSource = 'insurance_claim';
      claimId = Number(matchedClaim.claimId ?? matchedClaim.claim_id ?? matchedClaim.id) || null;
      preauthId = Number(matchedClaim.preauthid ?? matchedClaim.preauth_id) || null;
    }
  }

  if (!procedureCodes.length && options.ledgerRows?.length) {
    const ledgerMatch = resolveLedgerProceduresForDocument({
      patientId: options.patientId,
      documentDescript: options.descript,
      documentDate: options.documentDate,
      ledgerRows: options.ledgerRows,
      hintCodes: [...fromText, ...fromLog],
      adaByProccodeId,
    });
    if (ledgerMatch.lines.length) {
      procedureCodes = resolveCodesFromLedgerLines(ledgerMatch.lines, adaByProccodeId, adaIndex);
      linkSource = ledgerMatchToLinkSource(ledgerMatch.matchReason);
      preauthId = ledgerMatch.preauthid;
      claimId = ledgerMatch.claimid;
    }
  }

  if (!procedureCodes.length) {
    const merged = [...new Set([...fromLog, ...fromText])].sort();
    procedureCodes = resolveProcedureCodes(merged, adaIndex);
    if (merged.length) linkSource = 'document_text';
  } else if (fromText.length && linkSource !== 'document_text') {
    const extra = resolveProcedureCodes(fromText, adaIndex);
    const seen = new Set(procedureCodes.map((c) => c.code));
    for (const row of extra) {
      if (!seen.has(row.code)) procedureCodes.push(row);
    }
  }

  const mergedCodes = procedureCodes.map((c) => c.code);
  const guid = cleanDentrixText(options.patientGuid).toLowerCase();
  const insured = guid ? options.insuredByGuid.get(guid) : undefined;
  const insurancePlanId = insured?.ins_plan_id ?? null;

  const codeTypes = resolveCodeTypesForCodes(mergedCodes, {
    planId: insurancePlanId,
    coverageByPlanId: options.coverageByPlanId,
  });
  const primaryCodeType = codeTypes[0] ?? null;

  return {
    procedureCodes,
    codeTypes,
    primaryCodeType,
    insurancePlanId,
    linkSource,
    preauthId,
    claimId,
  };
}

export function primaryCodeTypeFilterId(ctx: DocumentProcedureContext): string {
  if (!ctx.codeTypes.length) return ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED;
  return ctx.primaryCodeType?.groupId ?? ESTIMATE_CODE_TYPE_FILTER_UNCATEGORIZED;
}
