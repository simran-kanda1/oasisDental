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
import { cleanDentrixText, formatDentrixDateKey, formatPatientFullName, parseDentrixDate, type DentrixPatientDoc } from './dentrix';
import { extractLedgerIdCandidates } from './ledgerTransactions';
import type { DocumentProcedureContext } from './procedureCodeTypes';

/** Firestore hard cap per query. */
export const FIRESTORE_QUERY_LIMIT_MAX = 10000;

/** Default documents to load on the estimates page (single query when possible). */
export const ESTIMATE_DOCUMENTS_QUERY_LIMIT = 5000;

/** Lighter fetch for sidebar badge counts — deferred off the critical path. */
export const ESTIMATE_DOCUMENTS_BADGE_LIMIT = 4000;

import {
  DEFAULT_ESTIMATE_AGE_BUCKET,
  ESTIMATE_AGE_BUCKET_OPTIONS,
  ESTIMATE_DOCUMENT_FETCH_MONTHS,
  type EstimateAgeBucket,
} from './estimateTreatment';

export type { EstimateAgeBucket };
export { ESTIMATE_AGE_BUCKET_OPTIONS, DEFAULT_ESTIMATE_AGE_BUCKET };

/** @deprecated use EstimateAgeBucket — kept for imports during migration */
export type EstimateDocumentLookback = EstimateAgeBucket;

export const ESTIMATE_DOCUMENT_LOOKBACK_OPTIONS = ESTIMATE_AGE_BUCKET_OPTIONS;
export const DEFAULT_ESTIMATE_DOCUMENT_LOOKBACK = DEFAULT_ESTIMATE_AGE_BUCKET;

export function estimateDocumentsFirestoreQuery(
  db: Firestore,
  _ageBucket: EstimateAgeBucket = 'all',
  pageSize = FIRESTORE_QUERY_LIMIT_MAX
) {
  const coll = collection(db, 'documents');
  // No server-side date filter — createdate is string or Timestamp depending on sync row.
  // Fetch the newest batch, then apply the 15-month window in isDocumentWithinLookback.
  return query(coll, orderBy('createdate', 'desc'), limit(Math.min(pageSize, FIRESTORE_QUERY_LIMIT_MAX)));
}

/** Page through newest documents — stops once the 15-month window is exhausted. */
export async function fetchEstimateDocuments(
  db: Firestore,
  maxDocs = ESTIMATE_DOCUMENTS_QUERY_LIMIT,
  options?: { stopAtLookback?: boolean }
): Promise<DentrixDocumentDoc[]> {
  const coll = collection(db, 'documents');
  const rows: DentrixDocumentDoc[] = [];
  let lastDoc: DocumentSnapshot | null = null;
  const since = options?.stopAtLookback !== false ? estimateDocumentFetchSince() : null;

  type DocumentSnapshot = QueryDocumentSnapshot<DocumentData>;

  const isBeforeLookback = (row: DentrixDocumentDoc): boolean => {
    if (!since) return false;
    const docDate =
      parseDentrixDate(row.createdate) ?? parseDentrixDate(row.modifiedtimestamp);
    return !!docDate && docDate < since;
  };

  while (rows.length < maxDocs) {
    const batchSize = Math.min(FIRESTORE_QUERY_LIMIT_MAX, maxDocs - rows.length);
    let snap;
    if (lastDoc) {
      snap = await getDocs(
        query(coll, orderBy('createdate', 'desc'), startAfter(lastDoc), limit(batchSize))
      );
    } else {
      snap = await getDocs(query(coll, orderBy('createdate', 'desc'), limit(batchSize)));
    }
    if (snap.empty) break;

    for (const d of snap.docs) {
      const row = { id: d.id, ...d.data() } as DentrixDocumentDoc;
      if (isBeforeLookback(row)) return rows;
      rows.push(row);
    }
    lastDoc = snap.docs[snap.docs.length - 1] ?? null;
    if (snap.size < batchSize) break;
  }

  return rows;
}

/** Firestore window — exclusive aging buckets are applied client-side on treatment date. */
export function estimateDocumentFetchSince(): Date | null {
  const since = new Date();
  since.setMonth(since.getMonth() - ESTIMATE_DOCUMENT_FETCH_MONTHS);
  since.setHours(0, 0, 0, 0);
  return since;
}

export function estimateDocumentSince(_lookback: EstimateAgeBucket): Date | null {
  return estimateDocumentFetchSince();
}

/** Prefer Document Center create date; fall back to Dentrix modified time when sync omits createdate. */
export function documentEffectiveDate(
  doc: Pick<DentrixDocumentDoc, 'createdate' | 'modifiedtimestamp'>
): unknown {
  return doc.createdate ?? doc.modifiedtimestamp;
}

export function isDocumentWithinLookback(
  createdate: unknown,
  _lookback: EstimateAgeBucket = 'all',
  modifiedtimestamp?: unknown
): boolean {
  const since = estimateDocumentFetchSince();
  const docDate = parseDentrixDate(createdate) ?? parseDentrixDate(modifiedtimestamp);
  if (!docDate) {
    const hasDateField =
      (createdate != null && createdate !== '') || (modifiedtimestamp != null && modifiedtimestamp !== '');
    return hasDateField;
  }
  if (!since) return true;
  return docDate >= since;
}

/** Dentrix v_docattach — attachtotype 1 = patient */
export const DOCUMENT_ATTACH_TO_PATIENT = 1;

export type DocumentEstimateWorkflowStatus =
  | 'book_right_away'
  | 'covered_eob'
  | 'needs_follow_up'
  | 'unclassified';

export interface DentrixDocumentDoc {
  id: string;
  docid?: number;
  descript?: string;
  createdate?: string;
  modifiedtimestamp?: string;
  doctypeid?: number;
  pages?: number;
}

export interface DentrixDocumentAttachmentDoc {
  id: string;
  attachid?: number;
  docid?: number;
  attachtotype?: number;
  attachtoentityid?: number;
  modifiedtimestamp?: string;
}

export interface DocumentEstimateWorkItem {
  docFirestoreId: string;
  docId: number;
  patientId: string;
  patientGuid: string | null;
  patientName: string;
  descript: string;
  createdate?: string;
  createdLabel: string | null;
  workflowStatus: DocumentEstimateWorkflowStatus;
  followUpDocId: string;
}

/**
 * Classify Document Center description for estimate / predet workflow.
 * Order matters: acknowledgements and predetermination EOB before generic EOB / explanation.
 */
export function isPredeterminationAcknowledgement(descript: string): boolean {
  const d = descript.trim().toLowerCase();
  if (d.includes('explanation')) return false;
  return (
    d.includes('pre-determination acknowledgment') ||
    d.includes('pre-determination acknowledgement') ||
    d.includes('predetermination acknowledgment') ||
    d.includes('predetermination acknowledgement')
  );
}

export function isPredeterminationExplanationOfBenefits(descript: string): boolean {
  const d = descript.trim().toLowerCase();
  return (
    d.includes('predetermination') &&
    (d.includes('explanation of benefits') || d.includes('explanation of benefit'))
  );
}

/** Claim acknowledgment documents are excluded from estimate tabs but can close pred-ack codes. */
export function isClaimAcknowledgement(descript: string): boolean {
  const d = descript.trim().toLowerCase();
  if (d.includes('explanation')) return false;
  if (d.includes('pre-determination') || d.includes('predetermination')) return false;
  return d.includes('claim acknowledgment') || d.includes('claim acknowledgement');
}

/** EOB or claim acknowledgment tied to a predetermination request. */
export function isPredeterminationResponseDocument(descript: string): boolean {
  const status = classifyDocumentEstimateStatus(descript);
  return status === 'covered_eob' || isClaimAcknowledgement(descript);
}

/** Whether a response document (EOB / claim ack) references the same predetermination as the ack row. */
export function documentsSharePredeterminationAssociation(
  predAckContext: DocumentProcedureContext,
  responseContext: DocumentProcedureContext,
  predAckDescript: string,
  responseDescript: string
): boolean {
  const predPreauth = Number(predAckContext.preauthId) || 0;
  const respPreauth = Number(responseContext.preauthId) || 0;
  if (predPreauth > 0 && predPreauth === respPreauth) return true;

  const predClaim = Number(predAckContext.claimId) || 0;
  const respClaim = Number(responseContext.claimId) || 0;
  if (predClaim > 0 && predClaim === respClaim) return true;

  const predIds = new Set(extractLedgerIdCandidates(predAckDescript));
  const responseIds = extractLedgerIdCandidates(responseDescript);
  if (!predIds.size && !responseIds.length) return false;

  for (const id of responseIds) {
    if (predIds.has(id)) return true;
    if (predPreauth === id || predClaim === id) return true;
  }
  for (const id of predIds) {
    if (respPreauth === id || respClaim === id) return true;
  }
  return false;
}

/** Procedure codes on associated EOB / claim-ack documents for this predetermination ack. */
export function collectCodesCoveredByPredeterminationResponses(options: {
  predAckDescript: string;
  predAckContext: DocumentProcedureContext;
  patientDocuments: Pick<DentrixDocumentDoc, 'descript'>[];
  resolveResponseContext: (descript: string) => DocumentProcedureContext;
}): Set<string> {
  const covered = new Set<string>();
  for (const doc of options.patientDocuments) {
    const descript = cleanDentrixText(doc.descript) || '';
    if (!isPredeterminationResponseDocument(descript)) continue;

    const responseContext = options.resolveResponseContext(descript);
    if (
      !documentsSharePredeterminationAssociation(
        options.predAckContext,
        responseContext,
        options.predAckDescript,
        descript
      )
    ) {
      continue;
    }

    for (const row of responseContext.procedureCodes) {
      covered.add(row.code);
    }
  }
  return covered;
}

export function classifyDocumentEstimateStatus(descript: string): DocumentEstimateWorkflowStatus {
  const d = descript.trim().toLowerCase();
  if (!d) return 'unclassified';
  if (isPredeterminationAcknowledgement(descript)) return 'needs_follow_up';
  if (isPredeterminationExplanationOfBenefits(descript)) return 'covered_eob';
  if (d.includes('explanation of benefits') || d.includes('explanation of benefit')) return 'covered_eob';
  if (d.includes('explanation')) return 'book_right_away';
  return 'unclassified';
}

export function documentFollowUpDocId(docId: number): string {
  return `doc-${docId}`;
}

export function workflowStatusLabel(status: DocumentEstimateWorkflowStatus): string {
  switch (status) {
    case 'book_right_away':
      return 'Book right away';
    case 'covered_eob':
      return 'Covered (EOB)';
    case 'needs_follow_up':
      return 'Needs follow-up';
    default:
      return 'Document';
  }
}

export function workflowStatusBadgeClass(status: DocumentEstimateWorkflowStatus): string {
  switch (status) {
    case 'book_right_away':
      return 'bg-rose-50 text-rose-800 border-rose-200';
    case 'covered_eob':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'needs_follow_up':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

/** Map docid → patient_id from patient attachments only. */
/** Estimate-relevant docs in the lookback window (no attachment fetch needed to classify). */
export function filterEstimateCandidateDocuments(
  documents: DentrixDocumentDoc[],
  lookback: EstimateAgeBucket = DEFAULT_ESTIMATE_AGE_BUCKET
): DentrixDocumentDoc[] {
  return documents.filter((doc) => {
    if (!isDocumentWithinLookback(doc.createdate, lookback, doc.modifiedtimestamp)) return false;
    const descript = cleanDentrixText(doc.descript) || '';
    return classifyDocumentEstimateStatus(descript) !== 'unclassified';
  });
}

export function buildDocIdToPatientIdMap(attachments: DentrixDocumentAttachmentDoc[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const a of attachments) {
    if (Number(a.attachtotype) !== DOCUMENT_ATTACH_TO_PATIENT) continue;
    const docId = Number(a.docid);
    const patientId = String(a.attachtoentityid ?? '');
    if (!Number.isFinite(docId) || docId <= 0 || !patientId) continue;
    map.set(docId, patientId);
  }
  return map;
}

export function buildDocumentEstimateWorkItems(
  documents: DentrixDocumentDoc[],
  docIdToPatientId: Map<number, string>,
  patientsById: Record<string, DentrixPatientDoc>,
  options?: { includeUnclassified?: boolean; lookback?: EstimateAgeBucket }
): DocumentEstimateWorkItem[] {
  const includeUnclassified = options?.includeUnclassified ?? false;
  const lookback = options?.lookback ?? DEFAULT_ESTIMATE_AGE_BUCKET;
  const rows: DocumentEstimateWorkItem[] = [];

  for (const doc of documents) {
    const docId = Number(doc.docid ?? doc.id);
    if (!Number.isFinite(docId) || docId <= 0) continue;
    if (!isDocumentWithinLookback(doc.createdate, lookback, doc.modifiedtimestamp)) continue;

    const descript = cleanDentrixText(doc.descript) || '';
    const workflowStatus = classifyDocumentEstimateStatus(descript);
    if (workflowStatus === 'unclassified' && !includeUnclassified) continue;

    const patientId = docIdToPatientId.get(docId);
    if (!patientId) continue;

    const patient = patientsById[patientId];
    const patientName =
      patient
        ? formatPatientFullName(patient.first_name, patient.last_name) || `Patient #${patientId}`
        : `Patient #${patientId}`;
    const patientGuid = patient?.patient_guid ? cleanDentrixText(patient.patient_guid) : null;

    const effectiveDate = documentEffectiveDate(doc);
    const createdLabel = formatDentrixDateKey(effectiveDate);
    rows.push({
      docFirestoreId: doc.id,
      docId,
      patientId,
      patientGuid: patientGuid || null,
      patientName: cleanDentrixText(patientName) || `Patient #${patientId}`,
      descript: descript || '—',
      createdate: createdLabel ?? (typeof effectiveDate === 'string' ? effectiveDate : undefined),
      createdLabel,
      workflowStatus,
      followUpDocId: documentFollowUpDocId(docId),
    });
  }

  rows.sort((a, b) => (b.createdLabel ?? '').localeCompare(a.createdLabel ?? ''));
  return rows;
}

export function isDocumentEstimateRelevant(descript: string): boolean {
  return classifyDocumentEstimateStatus(descript) !== 'unclassified';
}

/** Pre-d approved tab: any document description containing "explanation" (incl. EOB). */
export function isPredApprovedDocumentStatus(status: DocumentEstimateWorkflowStatus): boolean {
  return status === 'book_right_away' || status === 'covered_eob';
}

export function isPredFollowUpDocumentStatus(status: DocumentEstimateWorkflowStatus): boolean {
  return status === 'needs_follow_up';
}
