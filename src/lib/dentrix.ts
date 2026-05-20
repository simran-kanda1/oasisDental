import { format, isValid, parseISO } from 'date-fns';

export const DENTRIX_EMPTY_DATE_PREFIX = '1970-01-01';

export interface DentrixAppointmentDoc {
  id: string;
  appointment_id?: number;
  appointment_date?: string;
  start_hour?: number;
  start_minute?: number;
  length?: number;
  patient_id?: number;
  patient_guid?: string;
  patient_name?: string;
  reason?: string;
  /** Dentrix / sync may send appointment category under different keys */
  appointment_type?: string;
  appt_type?: string;
  appointmentType?: string;
  provider_id?: string;
  operatory_id?: string;
  status_id?: number;
  production_type?: number;
  amount?: number;
  /** When true, estimate was sent — drives Queues vs Estimates page */
  estimate_sent?: boolean;
}

export interface DentrixPatientAppointmentInfoDoc {
  id: string;
  patient_id?: number;
  patient_guid?: string;
  first_name?: string;
  last_name?: string;
  number_of_missed_appointments?: number;
  last_missed_appointment_date?: string;
  previous_appointment_date?: string;
  next_appointment_date?: string;
}

export interface DentrixPatientDoc {
  id: string;
  patient_id?: number;
  patient_guid?: string;
  first_name?: string;
  last_name?: string;
  home_phone?: string;
  mobile_phone?: string;
  email?: string;
  num_of_missed_appointments?: number;
  status?: number;
  last_synced_at?: string;
  /** Address fields — populated when Dentrix / sync includes them */
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  zip_code?: string;
  /** Free-text notes from patient record (varies by sync) */
  patient_notes?: string;
  /** Dentrix export often uses singular `note` */
  note?: string;
  notes?: string;
  chart_notes?: string;
  /** Links to `referrals.ref_id` when sync includes referral source */
  referred_by_ref_id?: number;
  referral_id?: number;
  preferred_contact_method?: string;
  birth_date?: string;
}

export interface DentrixFollowUpWorkItem {
  patientId: string;
  patientGuid: string;
  patientName: string;
  phone: string;
  email: string;
  missedAppointments: number;
  lastMissedDate: string | null;
  lastAppointmentDate: string | null;
  nextAppointmentDate: string | null;
  latestReason: string;
  latestProvider: string;
  latestAppointmentDate: string | null;
  latestAppointmentTime: string;
  risk: 'high' | 'medium' | 'low';
}

export const cleanDentrixText = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

export const parseDentrixDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || value.startsWith(DENTRIX_EMPTY_DATE_PREFIX)) {
    return null;
  }
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
};

export const formatDentrixDateKey = (value: unknown): string | null => {
  const date = parseDentrixDate(value);
  return date ? format(date, 'yyyy-MM-dd') : null;
};

export const formatDentrixTimeLabel = (hour: number | undefined, minute: number | undefined): string => {
  if (typeof hour !== 'number' || typeof minute !== 'number') {
    return 'Unknown';
  }
  const period = hour >= 12 ? 'PM' : 'AM';
  const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalizedHour}:${String(minute).padStart(2, '0')} ${period}`;
};

export const formatPatientFullName = (firstName: unknown, lastName: unknown): string => {
  const first = cleanDentrixText(firstName);
  const last = cleanDentrixText(lastName);
  return `${first} ${last}`.trim();
};

export const getPatientBestPhone = (patient: DentrixPatientDoc): string => {
  const mobile = cleanDentrixText(patient.mobile_phone);
  const home = cleanDentrixText(patient.home_phone);
  return mobile || home || 'N/A';
};

export const formatPatientAddressBlock = (patient: DentrixPatientDoc): string | null => {
  const line1 = cleanDentrixText(patient.address_line1);
  const line2 = cleanDentrixText(patient.address_line2);
  const cityState = [cleanDentrixText(patient.city), cleanDentrixText(patient.state)].filter(Boolean).join(', ');
  const zip = cleanDentrixText(patient.zip) || cleanDentrixText(patient.zip_code);
  const lines = [line1, line2, [cityState, zip].filter(Boolean).join(' ').trim()].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
};

export const getPatientNotesBlocks = (
  patient: DentrixPatientDoc
): { label: string; text: string }[] => {
  const blocks: { label: string; text: string }[] = [];
  const pn = cleanDentrixText(patient.patient_notes);
  const singleNote = cleanDentrixText(patient.note);
  const n = cleanDentrixText(patient.notes);
  const cn = cleanDentrixText(patient.chart_notes);
  if (pn) blocks.push({ label: 'Patient notes', text: pn });
  if (singleNote && singleNote !== pn) blocks.push({ label: 'Patient note', text: singleNote });
  if (n && n !== pn && n !== singleNote) blocks.push({ label: 'Notes', text: n });
  if (cn && cn !== pn && cn !== n && cn !== singleNote) blocks.push({ label: 'Chart notes', text: cn });
  return blocks;
};

export const getPatientRiskLevel = (missedAppointments: number): DentrixFollowUpWorkItem['risk'] => {
  if (missedAppointments >= 3) return 'high';
  if (missedAppointments >= 1) return 'medium';
  return 'low';
};

export const getRiskBadgeClass = (risk: DentrixFollowUpWorkItem['risk']): string => {
  if (risk === 'high') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (risk === 'medium') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
};

/**
 * Operational lists: exclude non-patient (2) and archived (4).
 * Dentrix status: 1=Patient, 2=Non-Patient, 3=Inactive, 4=Archived.
 * Unknown/missing status stays listable for backward compatibility.
 */
export const isActiveDentrixPatient = (data: { status?: number }): boolean => {
  const s = Number(data.status ?? 0);
  if (s === 0) return true;
  if (s === 2 || s === 4) return false;
  return true;
};
