import {
  cleanDentrixText,
  formatPatientFullName,
  isActiveDentrixPatient,
  type DentrixPatientDoc,
} from './dentrix';

/** Dentrix `referrals` / `v_referral` — ref_type 1 = referred by doctor / other professional source */
export const REFERRAL_TYPE_DOCTOR_OR_SOURCE = 1;

/**
 * Firestore collections fed by `sp_getpatientreferrals` (patient ↔ referral_id).
 * Sync can write either name; both are merged in the UI.
 */
export const PATIENT_REFERRAL_LINK_COLLECTIONS = [
  'patient_referrals',
  'patientReferrals',
  'getpatientreferrals',
] as const;

export interface DentrixReferralDoc {
  id: string;
  ref_id?: number;
  ref_type?: number;
  first_name?: string;
  last_name?: string;
  title?: string;
  phone?: string;
  city?: string;
  state?: string;
  non_person_flag?: boolean;
}

/** One row from Dentrix `sp_getpatientreferrals` (field names may match your sync export). */
export interface DentrixPatientReferralLinkDoc {
  id: string;
  referral_act_id?: number;
  patient_id?: number;
  patient_guid?: string;
  /** Join key to `referrals.ref_id` / `v_referral.ref_id` */
  referral_id?: number;
  /** Dentrix SP: Referred By vs Referred To (optional). If your sync populates this, we can filter later. */
  referral_type?: number;
  first_name?: string;
  last_name?: string;
  ref_first_name?: string;
  ref_last_name?: string;
  title?: string;
  phone?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  ref_date?: string;
}

export const REFERRAL_PROGRESS_TRACKING_COLLECTION = 'referralProgressTracking';

export interface ReferralProgressTrackingDoc {
  patientId: string;
  referralRefId: number;
  /** Confirmed the referring doctor was told how the patient is progressing */
  referrerUpdatedOnProgress?: boolean;
  notes?: string;
  updatedAt?: string;
}

export function referralProgressDocId(patientId: string, referralRefId: number): string {
  return `pt_${patientId}_ref_${referralRefId}`;
}

function patientIdFromLink(link: DentrixPatientReferralLinkDoc): string {
  const r = link as unknown as Record<string, unknown>;
  const v = r.patient_id ?? r.PatientId ?? r.patientId;
  return String(v ?? '').trim();
}

function referralIdFromLink(link: DentrixPatientReferralLinkDoc): number {
  const r = link as unknown as Record<string, unknown>;
  const v = r.referral_id ?? r.ReferralId ?? r.referralId;
  return Number(v ?? 0);
}

function patientFirstFromLink(link: DentrixPatientReferralLinkDoc): unknown {
  const r = link as unknown as Record<string, unknown>;
  return r.first_name ?? r.FirstName ?? r.firstName;
}

function patientLastFromLink(link: DentrixPatientReferralLinkDoc): unknown {
  const r = link as unknown as Record<string, unknown>;
  return r.last_name ?? r.LastName ?? r.lastName;
}

function refFirstFromLink(link: DentrixPatientReferralLinkDoc): unknown {
  const r = link as unknown as Record<string, unknown>;
  return r.ref_first_name ?? r.RefFirstName ?? r.refFirstName;
}

function refLastFromLink(link: DentrixPatientReferralLinkDoc): unknown {
  const r = link as unknown as Record<string, unknown>;
  return r.ref_last_name ?? r.RefLastName ?? r.refLastName;
}

function linkTitle(link: DentrixPatientReferralLinkDoc): string {
  const r = link as unknown as Record<string, unknown>;
  return cleanDentrixText(String(r.title ?? r.Title ?? link.title ?? ''));
}

function linkPhone(link: DentrixPatientReferralLinkDoc): string {
  const r = link as unknown as Record<string, unknown>;
  return cleanDentrixText(String(r.phone ?? r.Phone ?? link.phone ?? ''));
}

function linkCity(link: DentrixPatientReferralLinkDoc): string {
  const r = link as unknown as Record<string, unknown>;
  return cleanDentrixText(String(r.city ?? r.City ?? link.city ?? ''));
}

export function formatReferrerDisplayName(ref: DentrixReferralDoc): string {
  const parts = [
    cleanDentrixText(ref.title),
    cleanDentrixText(ref.first_name),
    cleanDentrixText(ref.last_name),
  ].filter(Boolean);
  if (parts.length) return parts.join(' ').trim();
  return ref.non_person_flag ? 'Organization' : 'Referrer';
}

function formatReferrerFromLinkFallback(link: DentrixPatientReferralLinkDoc): string {
  const parts = [linkTitle(link), cleanDentrixText(refFirstFromLink(link)), cleanDentrixText(refLastFromLink(link))].filter(
    Boolean
  );
  return parts.length ? parts.join(' ').trim() : 'Referrer';
}

export interface ReferralDoctorQueueRow {
  progressDocId: string;
  patientId: string;
  patientName: string;
  referralRefId: number;
  referrerDisplay: string;
  referrerPhone: string;
  referrerCity: string;
}

/**
 * Doctor-referral queue rows: join doctor sources (`referrals` ref_type=1) to patients via
 * `patient_referrals` / `patientReferrals` (from `sp_getpatientreferrals`) and/or `referred_by_ref_id` / `referral_id` on `patients`.
 */
export function buildReferralDoctorQueueRows(
  patientsById: Record<string, DentrixPatientDoc>,
  doctorReferrals: DentrixReferralDoc[],
  patientReferralLinks: DentrixPatientReferralLinkDoc[] = []
): ReferralDoctorQueueRow[] {
  const doctorRefIds = new Set(
    doctorReferrals
      .filter((r) => Number(r.ref_type) === REFERRAL_TYPE_DOCTOR_OR_SOURCE)
      .map((r) => Number(r.ref_id))
      .filter((n) => Number.isFinite(n) && n > 0)
  );
  const refById = new Map<number, DentrixReferralDoc>();
  for (const r of doctorReferrals) {
    const id = Number(r.ref_id);
    if (Number.isFinite(id) && id > 0) refById.set(id, r);
  }

  const byKey = new Map<string, ReferralDoctorQueueRow>();

  const pushRow = (row: ReferralDoctorQueueRow) => {
    byKey.set(row.progressDocId, row);
  };

  for (const link of patientReferralLinks) {
    const pid = patientIdFromLink(link);
    const refId = referralIdFromLink(link);
    if (!pid || !Number.isFinite(refId) || refId <= 0 || !doctorRefIds.has(refId)) continue;

    const p = patientsById[pid];
    if (p && !isActiveDentrixPatient(p)) continue;

    const ref = refById.get(refId);
    const patientName =
      (p && formatPatientFullName(p.first_name, p.last_name).trim()) ||
      formatPatientFullName(patientFirstFromLink(link), patientLastFromLink(link)).trim() ||
      `Patient #${pid}`;

    const referrerDisplay = ref ? formatReferrerDisplayName(ref) : formatReferrerFromLinkFallback(link);
    const referrerPhone = ref ? cleanDentrixText(ref.phone) : linkPhone(link);
    const referrerCity = ref ? cleanDentrixText(ref.city) : linkCity(link);

    pushRow({
      progressDocId: referralProgressDocId(pid, refId),
      patientId: pid,
      patientName,
      referralRefId: refId,
      referrerDisplay,
      referrerPhone,
      referrerCity,
    });
  }

  for (const p of Object.values(patientsById)) {
    const pid = String(p.patient_id ?? p.id ?? '');
    if (!pid) continue;
    if (!isActiveDentrixPatient(p)) continue;
    const refId = Number(p.referred_by_ref_id ?? p.referral_id ?? 0);
    if (!Number.isFinite(refId) || refId <= 0 || !doctorRefIds.has(refId)) continue;
    const key = referralProgressDocId(pid, refId);
    if (byKey.has(key)) continue;

    const ref = refById.get(refId);
    if (!ref) continue;
    const patientName =
      formatPatientFullName(p.first_name, p.last_name).trim() || `Patient #${pid}`;
    pushRow({
      progressDocId: key,
      patientId: pid,
      patientName,
      referralRefId: refId,
      referrerDisplay: formatReferrerDisplayName(ref),
      referrerPhone: cleanDentrixText(ref.phone),
      referrerCity: cleanDentrixText(ref.city),
    });
  }

  const rows = Array.from(byKey.values());
  rows.sort((a, b) => {
    const byRef = a.referrerDisplay.localeCompare(b.referrerDisplay);
    if (byRef !== 0) return byRef;
    return a.patientName.localeCompare(b.patientName);
  });
  return rows;
}
