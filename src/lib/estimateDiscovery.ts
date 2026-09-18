import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  cleanDentrixText,
  formatDentrixDateKey,
  formatPatientFullName,
  parseDentrixDate,
  type DentrixPatientDoc,
} from './dentrix';
import {
  classifyDocumentEstimateStatus,
  documentFollowUpDocId,
  isPredApprovedDocumentStatus,
  isPredFollowUpDocumentStatus,
  type DentrixDocumentDoc,
  type DocumentEstimateWorkItem,
  type DocumentEstimateWorkflowStatus,
} from './documentEstimates';
import { ESTIMATE_DOCUMENT_FETCH_MONTHS } from './estimateTreatment';
import type { DentrixLedgerTransactionDoc } from './ledgerTransactions';
import {
  matchEstimateCodeTypeGroup,
  type EstimateCodeTypeGroup,
} from './procedureCodeTypes';

/** Dentrix chart status: treatment planned. */
export const CHART_TREATMENT_PLANNED = 105;

const FIRESTORE_PAGE = 2000;
const DEFAULT_MAX_LEDGER_ROWS = 12000;

export interface LedgerEstimateSeed {
  patientId: string;
  codeTypeGroupId: string;
  codeTypeLabel: string;
  procedureCodes: string[];
  preauthId: number | null;
  latestProcDate: string | null;
  lineCount: number;
}

function lookbackSince(months = ESTIMATE_DOCUMENT_FETCH_MONTHS): Date {
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  since.setHours(0, 0, 0, 0);
  return since;
}

/** Newest ledger rows by procdate, stopping once outside the lookback window. */
export async function fetchRecentLedgerRows(
  db: Firestore,
  maxRows = DEFAULT_MAX_LEDGER_ROWS,
  months = ESTIMATE_DOCUMENT_FETCH_MONTHS
): Promise<DentrixLedgerTransactionDoc[]> {
  const coll = collection(db, 'ledger_transactions');
  const since = lookbackSince(months);
  const rows: DentrixLedgerTransactionDoc[] = [];
  let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

  while (rows.length < maxRows) {
    const batchSize = Math.min(FIRESTORE_PAGE, maxRows - rows.length);
    let snap;
    if (lastDoc) {
      snap = await getDocs(
        query(coll, orderBy('procdate', 'desc'), startAfter(lastDoc), limit(batchSize))
      );
    } else {
      snap = await getDocs(query(coll, orderBy('procdate', 'desc'), limit(batchSize)));
    }
    if (snap.empty) break;

    let hitLookback = false;
    for (const d of snap.docs) {
      const row = { id: d.id, ...d.data() } as DentrixLedgerTransactionDoc;
      const procDate = parseDentrixDate(row.procdate ?? row.entrydate);
      if (procDate && procDate < since) {
        hitLookback = true;
        break;
      }
      rows.push(row);
    }
    lastDoc = snap.docs[snap.docs.length - 1] ?? null;
    if (hitLookback || snap.size < batchSize) break;
  }

  return rows;
}

function seedKey(patientId: string, groupId: string, preauthId: number | null): string {
  return `${patientId}::${groupId}::${preauthId && preauthId > 0 ? preauthId : 'none'}`;
}

/**
 * Build estimate seeds from treatment-planned ledger lines in office estimate ranges.
 * Prefers lines with preauthid > 0 (estimate/preauth sent); also keeps range TP without
 * preauth when we later find a matching patient document.
 */
export function buildLedgerEstimateSeeds(
  ledgerRows: DentrixLedgerTransactionDoc[],
  adaByProccodeId: Map<number, string>,
  options?: { months?: number; requirePreauth?: boolean }
): LedgerEstimateSeed[] {
  const months = options?.months ?? ESTIMATE_DOCUMENT_FETCH_MONTHS;
  const requirePreauth = options?.requirePreauth ?? false;
  const since = lookbackSince(months);
  const groups = new Map<
    string,
    {
      patientId: string;
      group: EstimateCodeTypeGroup;
      codes: Set<string>;
      preauthId: number | null;
      latest: Date | null;
      latestLabel: string | null;
      lineCount: number;
    }
  >();

  for (const row of ledgerRows) {
    if (Number(row.chartstatus) !== CHART_TREATMENT_PLANNED) continue;
    const patid = Number(row.patid);
    if (!Number.isFinite(patid) || patid <= 0) continue;

    const procDate = parseDentrixDate(row.procdate ?? row.entrydate);
    if (procDate && procDate < since) continue;

    const ada = adaByProccodeId.get(Number(row.proccodeid));
    if (!ada) continue;
    const group = matchEstimateCodeTypeGroup(ada);
    if (!group) continue;

    const preauthId = Number(row.preauthid) || 0;
    if (requirePreauth && preauthId <= 0) continue;

    const patientId = String(patid);
    const key = seedKey(patientId, group.id, preauthId > 0 ? preauthId : null);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        patientId,
        group,
        codes: new Set([ada]),
        preauthId: preauthId > 0 ? preauthId : null,
        latest: procDate,
        latestLabel: formatDentrixDateKey(row.procdate ?? row.entrydate),
        lineCount: 1,
      });
      continue;
    }
    existing.codes.add(ada);
    existing.lineCount += 1;
    if (procDate && (!existing.latest || procDate > existing.latest)) {
      existing.latest = procDate;
      existing.latestLabel = formatDentrixDateKey(row.procdate ?? row.entrydate);
    }
    if (preauthId > 0 && !existing.preauthId) existing.preauthId = preauthId;
  }

  return [...groups.values()]
    .map((g) => ({
      patientId: g.patientId,
      codeTypeGroupId: g.group.id,
      codeTypeLabel: g.group.label,
      procedureCodes: [...g.codes].sort(),
      preauthId: g.preauthId,
      latestProcDate: g.latestLabel,
      lineCount: g.lineCount,
    }))
    .sort((a, b) => (b.latestProcDate ?? '').localeCompare(a.latestProcDate ?? ''));
}

function pickStatusDocument(
  docs: DentrixDocumentDoc[],
  preferApproved: boolean
): { doc: DentrixDocumentDoc; status: DocumentEstimateWorkflowStatus } | null {
  let bestAck: { doc: DentrixDocumentDoc; status: DocumentEstimateWorkflowStatus } | null = null;
  let bestApproved: { doc: DentrixDocumentDoc; status: DocumentEstimateWorkflowStatus } | null = null;

  for (const doc of docs) {
    const descript = cleanDentrixText(doc.descript) || '';
    const status = classifyDocumentEstimateStatus(descript);
    if (status === 'unclassified') continue;
    if (isPredApprovedDocumentStatus(status)) {
      if (!bestApproved) bestApproved = { doc, status };
    } else if (isPredFollowUpDocumentStatus(status)) {
      if (!bestAck) bestAck = { doc, status };
    }
  }

  if (preferApproved && bestApproved) return bestApproved;
  if (bestApproved) return bestApproved;
  return bestAck;
}

export function ledgerFollowUpDocId(
  patientId: string,
  codeTypeGroupId: string,
  preauthId: number | null
): string {
  return `ledger-${patientId}-${codeTypeGroupId}-${preauthId && preauthId > 0 ? preauthId : 'none'}`;
}

/**
 * Merge ledger treatment-plan seeds with Document Center work items.
 * Ledger is primary; docs assign workflow status. Doc-only pred rows are kept
 * when no ledger seed matches that patient.
 */
export function mergeLedgerAndDocumentWorkItems(options: {
  ledgerSeeds: LedgerEstimateSeed[];
  documentItems: DocumentEstimateWorkItem[];
  documentsByPatientId: Map<string, DentrixDocumentDoc[]>;
  patientsById: Record<string, DentrixPatientDoc>;
}): DocumentEstimateWorkItem[] {
  const { ledgerSeeds, documentItems, documentsByPatientId, patientsById } = options;
  const patientsWithLedger = new Set(ledgerSeeds.map((s) => s.patientId));
  const out: DocumentEstimateWorkItem[] = [];
  const seenFollowUpIds = new Set<string>();

  for (const seed of ledgerSeeds) {
    const patientDocs = documentsByPatientId.get(seed.patientId) ?? [];
    const preferApproved = seed.preauthId != null && seed.preauthId > 0;
    const picked = pickStatusDocument(patientDocs, preferApproved);

    // Skip noisy TP without preauth and without any estimate document.
    if (!picked && !(seed.preauthId && seed.preauthId > 0)) continue;

    const patient = patientsById[seed.patientId];
    const patientName = patient
      ? formatPatientFullName(patient.first_name, patient.last_name) || `Patient #${seed.patientId}`
      : `Patient #${seed.patientId}`;
    const patientGuid = patient?.patient_guid ? cleanDentrixText(patient.patient_guid) : null;

    let workflowStatus: DocumentEstimateWorkflowStatus = 'needs_follow_up';
    let descript = `Treatment planned · ${seed.codeTypeLabel}`;
    let docId = 0;
    let docFirestoreId = '';
    let followUpDocId = ledgerFollowUpDocId(seed.patientId, seed.codeTypeGroupId, seed.preauthId);
    let createdLabel = seed.latestProcDate;
    let createdate = seed.latestProcDate ?? undefined;

    if (picked) {
      workflowStatus = picked.status;
      descript = cleanDentrixText(picked.doc.descript) || descript;
      docId = Number(picked.doc.docid ?? picked.doc.id) || 0;
      docFirestoreId = picked.doc.id;
      if (docId > 0) followUpDocId = documentFollowUpDocId(docId);
      createdLabel =
        formatDentrixDateKey(picked.doc.createdate ?? picked.doc.modifiedtimestamp) ?? createdLabel;
      createdate = createdLabel ?? createdate;
    } else if (seed.preauthId && seed.preauthId > 0) {
      descript = `Estimate / preauth #${seed.preauthId} · ${seed.codeTypeLabel} (${seed.procedureCodes.join(', ')})`;
    }

    if (seenFollowUpIds.has(followUpDocId)) continue;
    seenFollowUpIds.add(followUpDocId);

    out.push({
      docFirestoreId: docFirestoreId || followUpDocId,
      docId: docId > 0 ? docId : Math.abs(hashString(followUpDocId)) % 1_000_000_000,
      patientId: seed.patientId,
      patientGuid: patientGuid || null,
      patientName: cleanDentrixText(patientName) || `Patient #${seed.patientId}`,
      descript,
      createdate,
      createdLabel,
      workflowStatus,
      followUpDocId,
    });
  }

  for (const item of documentItems) {
    if (seenFollowUpIds.has(item.followUpDocId)) continue;
    if (patientsWithLedger.has(item.patientId)) {
      const alreadyForPatient = out.some((r) => r.patientId === item.patientId);
      if (alreadyForPatient) continue;
    }
    seenFollowUpIds.add(item.followUpDocId);
    out.push(item);
  }

  out.sort((a, b) => (b.createdLabel ?? '').localeCompare(a.createdLabel ?? ''));
  return out;
}

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return h;
}

/** Open-work counts aligned with page tabs (for nav badges). */
export function countEstimateOpenWorkByTab(items: DocumentEstimateWorkItem[]): {
  predApproved: number;
  predFollowUp: number;
} {
  let predApproved = 0;
  let predFollowUp = 0;
  for (const item of items) {
    if (isPredApprovedDocumentStatus(item.workflowStatus)) predApproved += 1;
    else if (isPredFollowUpDocumentStatus(item.workflowStatus)) predFollowUp += 1;
  }
  return { predApproved, predFollowUp };
}
