import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { cleanDentrixText, parseDentrixDate } from './dentrix';

/** Dentrix ledger / procedure log (synced from v_proclog or ledger). */
export interface DentrixLedgerTransactionDoc {
  id: string;
  patid?: number;
  proccodeid?: number;
  procid?: number;
  procdate?: string;
  entrydate?: string;
  chartstatus?: number;
  preauthid?: number;
  claimid?: number;
  amt?: number;
  amtpriminspaid?: number;
  amtsecinspaid?: number;
}

const CHART_TREATMENT_PLANNED = 105;
const CHART_COMPLETED = 102;
const DOCUMENT_LINK_DAYS = 540;

export interface LedgerProcedureLine {
  proccodeid: number;
  procid?: number;
  chartstatus?: number;
  procdate?: string | null;
  preauthid?: number;
  claimid?: number;
  amt?: number;
  primaryInsurancePaid?: number;
}

export interface LedgerPreauthGroup {
  preauthid: number;
  claimid: number;
  lines: LedgerProcedureLine[];
  nearestProcDate: string | null;
}

const ledgerCache = new Map<number, DentrixLedgerTransactionDoc[]>();
const inflightLedger = new Map<number, Promise<DentrixLedgerTransactionDoc[]>>();

export async function fetchLedgerForPatients(patientIds: string[]): Promise<Map<number, DentrixLedgerTransactionDoc[]>> {
  const unique = [...new Set(patientIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0))];
  const out = new Map<number, DentrixLedgerTransactionDoc[]>();

  await Promise.all(
    unique.map(async (patid) => {
      if (ledgerCache.has(patid)) {
        out.set(patid, ledgerCache.get(patid)!);
        return;
      }
      let pending = inflightLedger.get(patid);
      if (!pending) {
        pending = getDocs(query(collection(db, 'ledger_transactions'), where('patid', '==', patid))).then((snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixLedgerTransactionDoc));
          ledgerCache.set(patid, rows);
          inflightLedger.delete(patid);
          return rows;
        });
        inflightLedger.set(patid, pending);
      }
      out.set(patid, await pending);
    })
  );

  return out;
}

export function buildLedgerRowsByPatientId(
  rows: DentrixLedgerTransactionDoc[]
): Map<number, DentrixLedgerTransactionDoc[]> {
  const map = new Map<number, DentrixLedgerTransactionDoc[]>();
  for (const row of rows) {
    const patid = Number(row.patid);
    if (!Number.isFinite(patid)) continue;
    const list = map.get(patid) ?? [];
    list.push(row);
    map.set(patid, list);
  }
  return map;
}

function toLedgerLine(row: DentrixLedgerTransactionDoc): LedgerProcedureLine | null {
  const proccodeid = Number(row.proccodeid);
  if (!Number.isFinite(proccodeid) || proccodeid <= 0) return null;
  return {
    proccodeid,
    procid: Number(row.procid) || undefined,
    chartstatus: Number(row.chartstatus) || undefined,
    procdate: row.procdate ?? row.entrydate ?? null,
    preauthid: Number(row.preauthid) || 0,
    claimid: Number(row.claimid) || 0,
    amt: typeof row.amt === 'number' ? row.amt : undefined,
    primaryInsurancePaid:
      typeof row.amtpriminspaid === 'number' ? row.amtpriminspaid : undefined,
  };
}

function groupByPreauth(lines: LedgerProcedureLine[]): LedgerPreauthGroup[] {
  const map = new Map<number, LedgerPreauthGroup>();
  for (const line of lines) {
    const preauthid = Number(line.preauthid);
    if (!preauthid) continue;
    const existing = map.get(preauthid) ?? {
      preauthid,
      claimid: 0,
      lines: [],
      nearestProcDate: null,
    };
    if (line.claimid && !existing.claimid) existing.claimid = line.claimid;
    existing.lines.push(line);
    map.set(preauthid, existing);
  }
  return [...map.values()];
}

function daysBetween(a: Date | null, b: Date | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

function scorePreauthGroup(group: LedgerPreauthGroup, docDate: Date | null): number {
  let best = Number.POSITIVE_INFINITY;
  for (const line of group.lines) {
    const procDate = parseDentrixDate(line.procdate);
    const diff = daysBetween(docDate, procDate);
    if (diff < best) best = diff;
    if (line.procdate && (!group.nearestProcDate || line.procdate < group.nearestProcDate)) {
      group.nearestProcDate = line.procdate;
    }
  }
  return best;
}

/** Parse numeric tokens that may be preauth or claim ids (not procedure codes). */
export function extractLedgerIdCandidates(descript: string): number[] {
  const raw = cleanDentrixText(descript);
  if (!raw) return [];
  const ids = new Set<number>();
  for (const match of raw.matchAll(/\b(\d{4,7})\b/g)) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n >= 1000) ids.add(n);
  }
  return [...ids];
}

export interface ResolveLedgerProceduresInput {
  patientId: string;
  documentDescript: string;
  documentDate?: string | null;
  ledgerRows: DentrixLedgerTransactionDoc[];
  /** Procedure codes already parsed from document text — used to pick the best preauth group. */
  hintCodes?: string[];
  adaByProccodeId?: Map<number, string>;
}

export interface ResolvedLedgerProcedures {
  lines: LedgerProcedureLine[];
  preauthid: number | null;
  claimid: number | null;
  matchReason: 'preauth_id' | 'claim_id' | 'date_window' | 'hint_code' | 'treatment_planned' | null;
}

export function resolveLedgerProceduresForDocument(input: ResolveLedgerProceduresInput): ResolvedLedgerProcedures {
  const patid = Number(input.patientId);
  if (!Number.isFinite(patid)) {
    return { lines: [], preauthid: null, claimid: null, matchReason: null };
  }

  const docDate = parseDentrixDate(input.documentDate);
  const allLines = input.ledgerRows
    .filter((r) => Number(r.patid) === patid)
    .map(toLedgerLine)
    .filter((l): l is LedgerProcedureLine => !!l);

  if (!allLines.length) {
    return { lines: [], preauthid: null, claimid: null, matchReason: null };
  }

  const idCandidates = extractLedgerIdCandidates(input.documentDescript);
  const preauthGroups = groupByPreauth(allLines);

  for (const id of idCandidates) {
    const byPreauth = preauthGroups.find((g) => g.preauthid === id);
    if (byPreauth) {
      return {
        lines: preferLinesForDocument(byPreauth.lines, docDate),
        preauthid: byPreauth.preauthid,
        claimid: byPreauth.claimid || null,
        matchReason: 'preauth_id',
      };
    }
    const byClaim = allLines.filter((l) => l.claimid === id);
    if (byClaim.length) {
      const preauthid = byClaim.find((l) => l.preauthid)?.preauthid ?? null;
      return {
        lines: preferLinesForDocument(byClaim, docDate),
        preauthid,
        claimid: id,
        matchReason: 'claim_id',
      };
    }
  }

  if (input.hintCodes?.length && input.adaByProccodeId) {
    const hintProccodeIds = new Set<number>();
    for (const [proccodeid, ada] of input.adaByProccodeId) {
      if (input.hintCodes.includes(ada)) hintProccodeIds.add(proccodeid);
    }
    const matchingGroups = preauthGroups
      .filter((g) => g.lines.some((l) => hintProccodeIds.has(l.proccodeid)))
      .sort((a, b) => scorePreauthGroup(a, docDate) - scorePreauthGroup(b, docDate));
    if (matchingGroups[0]) {
      const g = matchingGroups[0];
      return {
        lines: preferLinesForDocument(g.lines, docDate),
        preauthid: g.preauthid,
        claimid: g.claimid || null,
        matchReason: 'hint_code',
      };
    }
  }

  if (preauthGroups.length && docDate) {
    const ranked = [...preauthGroups].sort((a, b) => scorePreauthGroup(a, docDate) - scorePreauthGroup(b, docDate));
    const best = ranked[0];
    const bestDays = scorePreauthGroup(best, docDate);
    if (bestDays <= DOCUMENT_LINK_DAYS) {
      return {
        lines: preferLinesForDocument(best.lines, docDate),
        preauthid: best.preauthid,
        claimid: best.claimid || null,
        matchReason: 'date_window',
      };
    }
  }

  const treatmentPlanned = allLines.filter((l) => l.chartstatus === CHART_TREATMENT_PLANNED);
  if (treatmentPlanned.length) {
    return {
      lines: preferLinesForDocument(treatmentPlanned, docDate),
      preauthid: treatmentPlanned.find((l) => l.preauthid)?.preauthid ?? null,
      claimid: treatmentPlanned.find((l) => l.claimid)?.claimid ?? null,
      matchReason: 'treatment_planned',
    };
  }

  return { lines: [], preauthid: null, claimid: null, matchReason: null };
}

function preferLinesForDocument(lines: LedgerProcedureLine[], docDate: Date | null): LedgerProcedureLine[] {
  const planned = lines.filter((l) => l.chartstatus === CHART_TREATMENT_PLANNED);
  const pool = planned.length ? planned : lines;
  if (!docDate) return dedupeLines(pool);

  const completedNear = lines.filter((l) => {
    if (l.chartstatus !== CHART_COMPLETED) return false;
    return daysBetween(docDate, parseDentrixDate(l.procdate)) <= DOCUMENT_LINK_DAYS;
  });
  return dedupeLines([...pool, ...completedNear]);
}

function dedupeLines(lines: LedgerProcedureLine[]): LedgerProcedureLine[] {
  const seen = new Set<number>();
  const out: LedgerProcedureLine[] = [];
  for (const line of lines) {
    if (seen.has(line.proccodeid)) continue;
    seen.add(line.proccodeid);
    out.push(line);
  }
  return out;
}
