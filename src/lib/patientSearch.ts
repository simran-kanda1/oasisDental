import {
  collection,
  getDocs,
  limit,
  query,
  startAfter,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  formatPatientFullName,
  getPatientBestPhone,
  type DentrixPatientDoc,
} from './dentrix';

export interface PatientSearchResult {
  firestoreId: string;
  patientId: string;
  name: string;
  phone: string;
  email: string;
}

const PAGE_SIZE = 1000;
let cachedPatients: DentrixPatientDoc[] | null = null;
let cachePromise: Promise<DentrixPatientDoc[]> | null = null;

async function loadAllPatients(): Promise<DentrixPatientDoc[]> {
  if (cachedPatients) return cachedPatients;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
    const all: DentrixPatientDoc[] = [];
    let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

    while (true) {
      const patientQuery: Query<DocumentData> = cursor
        ? query(collection(db, 'patients'), startAfter(cursor), limit(PAGE_SIZE))
        : query(collection(db, 'patients'), limit(PAGE_SIZE));
      const snap: QuerySnapshot<DocumentData> = await getDocs(patientQuery);
      if (snap.empty) break;

      snap.docs.forEach((docSnap: QueryDocumentSnapshot<DocumentData>) => {
        all.push({ id: docSnap.id, ...docSnap.data() } as DentrixPatientDoc);
      });

      cursor = snap.docs[snap.docs.length - 1];
      if (snap.size < PAGE_SIZE) break;
    }

    cachedPatients = all;
    return all;
  })();

  return cachePromise;
}

/** Clear cache after large Dentrix sync (optional hook). */
export function invalidatePatientSearchCache() {
  cachedPatients = null;
  cachePromise = null;
}

export async function searchPatients(term: string, maxResults = 20): Promise<PatientSearchResult[]> {
  const raw = term.trim();
  if (raw.length < 2) return [];

  const normalized = raw.toLowerCase();
  const digits = raw.replace(/\D/g, '');
  const patients = await loadAllPatients();
  const results: PatientSearchResult[] = [];

  for (const p of patients) {
    const name = formatPatientFullName(p.first_name, p.last_name).toLowerCase();
    const phone = getPatientBestPhone(p).replace(/\D/g, '');
    const email = String(p.email ?? '').toLowerCase();
    const pid = String(p.patient_id ?? p.id ?? '');
    const firestoreId = p.id ?? '';

    const match =
      name.includes(normalized) ||
      pid.includes(normalized) ||
      email.includes(normalized) ||
      (digits.length >= 3 && phone.includes(digits));

    if (!match) continue;

    results.push({
      firestoreId,
      patientId: pid,
      name: formatPatientFullName(p.first_name, p.last_name) || 'Unknown patient',
      phone: getPatientBestPhone(p),
      email: String(p.email ?? ''),
    });
    if (results.length >= maxResults) break;
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}
