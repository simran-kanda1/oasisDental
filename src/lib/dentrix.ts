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
  provider_id?: string;
  operatory_id?: string;
  status_id?: number;
  production_type?: number;
  amount?: number;
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
