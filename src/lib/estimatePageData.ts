import { collection, documentId, getDocs, limit, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { DentrixPatientAppointmentInfoDoc, DentrixAppointmentDoc } from './dentrix';
import type { DentrixInsuranceClaimDoc } from './insuranceClaimEstimates';
import { formatDentrixDateKey } from './dentrix';
import type { DentrixInsuredDoc } from './procedureCodeTypes';
import type { EstimateActionHistoryEntry } from './estimateTreatment';

const IN_BATCH = 30;
const PARALLEL_BATCHES = 6;

export async function fetchFollowUpsForDocIds(
  db: Firestore,
  followUpDocIds: string[]
): Promise<Record<string, Record<string, unknown>>> {
  const ids = [...new Set(followUpDocIds.filter(Boolean))];
  const map: Record<string, Record<string, unknown>> = {};

  for (let i = 0; i < ids.length; i += IN_BATCH * PARALLEL_BATCHES) {
    const rounds = [];
    for (let j = 0; j < PARALLEL_BATCHES; j += 1) {
      const chunk = ids.slice(i + j * IN_BATCH, i + (j + 1) * IN_BATCH);
      if (chunk.length) rounds.push(chunk);
    }
    await Promise.all(
      rounds.map(async (chunk) => {
        const snap = await getDocs(
          query(collection(db, 'followUps'), where(documentId(), 'in', chunk))
        );
        snap.docs.forEach((d) => {
          map[d.id] = d.data() as Record<string, unknown>;
        });
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
    const snaps = await Promise.all(
      (['patient_id', 'patientId', 'patid'] as const).map((field) =>
        getDocs(query(collection(db, 'insurance_claims'), where(field, 'in', chunk)))
      )
    );
    for (const snap of snaps) {
      snap.docs.forEach((d) => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        out.push({ id: d.id, ...d.data() } as DentrixInsuranceClaimDoc);
      });
    }
  }
  return out;
}

const ESTIMATE_SENT_APPOINTMENTS_LIMIT = 2000;

/** Appointments flagged estimate_sent in Dentrix — avoids scanning the full appointments collection. */
export async function fetchEstimateSentAppointments(db: Firestore): Promise<DentrixAppointmentDoc[]> {
  const snap = await getDocs(
    query(
      collection(db, 'appointments'),
      where('estimate_sent', '==', true),
      limit(ESTIMATE_SENT_APPOINTMENTS_LIMIT)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixAppointmentDoc));
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

/** Most recent estimate-sent appointment date per patient (from synced appointments). */
export function buildEstimateSentLabelFromAppointments(
  appointments: DentrixAppointmentDoc[]
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const a of appointments) {
    if (a.estimate_sent !== true) continue;
    const pid = String(a.patient_id ?? '');
    if (!pid) continue;
    const label = formatDentrixDateKey(a.appointment_date);
    if (!label) continue;
    const prev = out[pid];
    if (!prev || label > prev) out[pid] = label;
  }
  return out;
}

/** Prefer Dentrix estimate-sent date; fall back to staff "estimate received" action. */
export function resolveEstimateSentDisplayLabel(options: {
  dentrixSentLabel?: string | null;
  estimateReceivedAt?: unknown;
  actionFlags?: Partial<Record<string, boolean>> | null;
  actionHistory?: EstimateActionHistoryEntry[];
}): string | null {
  if (options.dentrixSentLabel) return options.dentrixSentLabel;
  const receivedAt = formatDentrixDateKey(options.estimateReceivedAt);
  if (receivedAt) return receivedAt;
  if (!options.actionFlags?.estimate_received) return null;
  const fromHistory = [...(options.actionHistory ?? [])]
    .reverse()
    .find((entry) => entry.action === 'estimate_received');
  return fromHistory ? formatDentrixDateKey(fromHistory.at) ?? fromHistory.at.slice(0, 10) : new Date().toISOString().slice(0, 10);
}
