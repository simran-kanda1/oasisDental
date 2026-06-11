import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { DentrixPatientAppointmentInfoDoc } from './dentrix';
import type { DentrixInsuranceClaimDoc } from './insuranceClaimEstimates';
import { formatDentrixDateKey } from './dentrix';
import type { DentrixInsuredDoc } from './procedureCodeTypes';

const IN_BATCH = 30;

export async function fetchFollowUpsForDocIds(
  db: Firestore,
  followUpDocIds: string[]
): Promise<Record<string, Record<string, unknown>>> {
  const ids = [...new Set(followUpDocIds.filter(Boolean))];
  const map: Record<string, Record<string, unknown>> = {};

  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const chunk = ids.slice(i, i + IN_BATCH);
    await Promise.all(
      chunk.map(async (id) => {
        const snap = await getDoc(doc(db, 'followUps', id));
        if (snap.exists()) map[id] = snap.data() as Record<string, unknown>;
      })
    );
  }
  return map;
}

export async function fetchClaimsForPatientIds(
  db: Firestore,
  patientIds: number[]
): Promise<DentrixInsuranceClaimDoc[]> {
  const ids = [...new Set(patientIds.filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];

  const out: DentrixInsuranceClaimDoc[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const chunk = ids.slice(i, i + IN_BATCH);
    for (const field of ['patient_id', 'patientId', 'patid'] as const) {
      const snap = await getDocs(query(collection(db, 'insurance_claims'), where(field, 'in', chunk)));
      snap.docs.forEach((d) => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        out.push({ id: d.id, ...d.data() } as DentrixInsuranceClaimDoc);
      });
    }
  }
  return out;
}

export async function fetchPatientInfoByPatientIds(
  db: Firestore,
  patientIds: string[]
): Promise<Record<string, DentrixPatientAppointmentInfoDoc>> {
  const numericIds = [
    ...new Set(patientIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0)),
  ];
  if (!numericIds.length) return {};

  const map: Record<string, DentrixPatientAppointmentInfoDoc> = {};
  for (let i = 0; i < numericIds.length; i += IN_BATCH) {
    const chunk = numericIds.slice(i, i + IN_BATCH);
    const snap = await getDocs(
      query(collection(db, 'patient_appointment_info'), where('patient_id', 'in', chunk))
    );
    snap.docs.forEach((d) => {
      const row = { id: d.id, ...d.data() } as DentrixPatientAppointmentInfoDoc;
      map[String(row.patient_id ?? row.id)] = row;
    });
  }
  return map;
}

export async function fetchInsuredForPatientGuids(
  db: Firestore,
  patientGuids: string[]
): Promise<DentrixInsuredDoc[]> {
  const guids = [...new Set(patientGuids.map((g) => g.trim()).filter(Boolean))];
  if (!guids.length) return [];

  const out: DentrixInsuredDoc[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < guids.length; i += IN_BATCH) {
    const chunk = guids.slice(i, i + IN_BATCH);
    const snap = await getDocs(
      query(collection(db, 'insured'), where('ins_party_guid', 'in', chunk))
    );
    snap.docs.forEach((d) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      out.push({ id: d.id, ...d.data() } as DentrixInsuredDoc);
    });
  }
  return out;
}

/** Next appointment label from patient_appointment_info only (no full appointments scan). */
export function buildNextApptLabelFromPatientInfo(
  patientInfoById: Record<string, DentrixPatientAppointmentInfoDoc>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [pid, info] of Object.entries(patientInfoById)) {
    const dateLabel = formatDentrixDateKey(info.next_appointment_date);
    out[pid] = dateLabel ?? '—';
  }
  return out;
}
