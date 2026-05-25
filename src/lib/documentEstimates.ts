import { cleanDentrixText, formatDentrixDateKey, formatPatientFullName, parseDentrixDate, type DentrixPatientDoc } from './dentrix';

/** How far back to load Document Center rows for the estimates page. */
export type EstimateDocumentLookback = '1' | '3' | '6' | '9' | 'all';

export const ESTIMATE_DOCUMENT_LOOKBACK_OPTIONS: { id: EstimateDocumentLookback; label: string }[] = [
  { id: '1', label: 'Up to 1 month' },
  { id: '3', label: 'Up to 3 months' },
  { id: '6', label: 'Up to 6 months' },
  { id: '9', label: 'Up to 9 months' },
  { id: 'all', label: 'All' },
];

export const DEFAULT_ESTIMATE_DOCUMENT_LOOKBACK: EstimateDocumentLookback = '1';

export function estimateDocumentSince(lookback: EstimateDocumentLookback): Date | null {
  if (lookback === 'all') return null;
  const months = Number(lookback);
  if (!Number.isFinite(months) || months <= 0) return null;
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  since.setHours(0, 0, 0, 0);
  return since;
}

export function isDocumentWithinLookback(createdate: unknown, lookback: EstimateDocumentLookback): boolean {
  const since = estimateDocumentSince(lookback);
  if (!since) return true;
  const docDate = parseDentrixDate(createdate);
  if (!docDate) return false;
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
 * Order matters: "explanation of benefits" before bare "explanation".
 */
export function classifyDocumentEstimateStatus(descript: string): DocumentEstimateWorkflowStatus {
  const d = descript.trim().toLowerCase();
  if (!d) return 'unclassified';
  if (d.includes('explanation of benefits') || d.includes('explanation of benefit')) return 'covered_eob';
  if (d.includes('acknowledgment') || d.includes('acknowledgement')) return 'needs_follow_up';
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
  options?: { includeUnclassified?: boolean; lookback?: EstimateDocumentLookback }
): DocumentEstimateWorkItem[] {
  const includeUnclassified = options?.includeUnclassified ?? false;
  const lookback = options?.lookback ?? DEFAULT_ESTIMATE_DOCUMENT_LOOKBACK;
  const rows: DocumentEstimateWorkItem[] = [];

  for (const doc of documents) {
    const docId = Number(doc.docid ?? doc.id);
    if (!Number.isFinite(docId) || docId <= 0) continue;
    if (!isDocumentWithinLookback(doc.createdate, lookback)) continue;

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

    rows.push({
      docFirestoreId: doc.id,
      docId,
      patientId,
      patientGuid: patientGuid || null,
      patientName: cleanDentrixText(patientName) || `Patient #${patientId}`,
      descript: descript || '—',
      createdate: typeof doc.createdate === 'string' ? doc.createdate : undefined,
      createdLabel: formatDentrixDateKey(doc.createdate),
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
