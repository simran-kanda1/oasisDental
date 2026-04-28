import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

/**
 * Resolves the Firestore document id for a Dentrix patient (by numeric patient_id or by doc id).
 */
export async function resolvePatientFirestoreDocId(db: Firestore, patientId: string): Promise<string | null> {
    const trimmed = patientId.trim();
    if (!trimmed) return null;

    const n = Number(trimmed);
    if (Number.isFinite(n) && !Number.isNaN(n)) {
        const qs = query(collection(db, 'patients'), where('patient_id', '==', n), limit(1));
        const snap = await getDocs(qs);
        if (!snap.empty) return snap.docs[0].id;
    }

    const byId = await getDoc(doc(db, 'patients', trimmed));
    if (byId.exists()) return trimmed;

    return null;
}
