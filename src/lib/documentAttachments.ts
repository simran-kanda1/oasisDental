import { collection, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { DentrixPatientDoc } from './dentrix';
import type { DentrixDocumentAttachmentDoc } from './documentEstimates';

const IN_BATCH = 30;
const PARALLEL_BATCHES = 6;

/** Load patient attachments only for the estimate document ids already in memory. */
export async function fetchAttachmentsForDocIds(
  db: Firestore,
  docIds: number[]
): Promise<DentrixDocumentAttachmentDoc[]> {
  const ids = [...new Set(docIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) return [];

  const out: DentrixDocumentAttachmentDoc[] = [];
  for (let i = 0; i < ids.length; i += IN_BATCH * PARALLEL_BATCHES) {
    const rounds = [];
    for (let j = 0; j < PARALLEL_BATCHES; j += 1) {
      const chunk = ids.slice(i + j * IN_BATCH, i + (j + 1) * IN_BATCH);
      if (chunk.length) rounds.push(chunk);
    }
    await Promise.all(
      rounds.map(async (chunk) => {
        const snap = await getDocs(
          query(collection(db, 'document_attachments'), where('docid', 'in', chunk))
        );
        snap.docs.forEach((d) => {
          out.push({ id: d.id, ...d.data() } as DentrixDocumentAttachmentDoc);
        });
      })
    );
  }
  return out;
}

/** Load only patients referenced on the current estimate document list. */
export async function fetchPatientsByPatientIds(
  db: Firestore,
  patientIds: string[]
): Promise<Record<string, DentrixPatientDoc>> {
  const numericIds = [
    ...new Set(
      patientIds
        .map((id) => Number(id))
        .filter((n) => Number.isFinite(n) && n > 0)
    ),
  ];
  if (numericIds.length === 0) return {};

  const map: Record<string, DentrixPatientDoc> = {};
  for (let i = 0; i < numericIds.length; i += IN_BATCH) {
    const chunk = numericIds.slice(i, i + IN_BATCH);
    const snap = await getDocs(query(collection(db, 'patients'), where('patient_id', 'in', chunk)));
    snap.docs.forEach((d) => {
      const row = { id: d.id, ...d.data() } as DentrixPatientDoc;
      map[String(row.patient_id ?? row.id)] = row;
    });
  }
  return map;
}
