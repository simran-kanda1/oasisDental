export const NOT_REBOOKED_REASON_OPTIONS = [
  { value: '', label: '—' },
  { value: 'cost_financial', label: 'Cost / financial' },
  { value: 'scheduling', label: 'Scheduling conflict' },
  { value: 'declined', label: 'Patient declined' },
  { value: 'medical_hold', label: 'Medical hold' },
  { value: 'voicemail', label: 'Left voicemail' },
  { value: 'unreachable', label: 'No answer / unreachable' },
  { value: 'transferred', label: 'Transferred care elsewhere' },
  { value: 'rebooked_elsewhere', label: 'Will call back / pending' },
  { value: 'other', label: 'Other (see notes)' },
] as const;

export const TMJ_MRI_REASON_OPTIONS = [
  { value: '', label: '—' },
  { value: 'patient_booked', label: 'Patient booked' },
  { value: 'patient_declined', label: 'Patient declined' },
  { value: 'mri_requisition_given', label: 'MRI requisition given' },
  { value: 'records_appt_booked', label: 'Records appointment booked' },
  { value: 'referred_chiro_physio', label: 'Referred to chiro / physio' },
  { value: 'inactive', label: 'Inactive' },
] as const;

export const NIGHT_GUARD_REASON_OPTIONS = [
  { value: '', label: '—' },
  { value: 'estimate_sent', label: 'Estimate sent' },
  { value: 'estimate_received', label: 'Estimate received' },
  { value: 'booked_impression_scan', label: 'Patient booked for impression/scan' },
  { value: 'complete', label: 'Complete' },
] as const;

export const PERIO_REASON_OPTIONS = [
  { value: '', label: '—' },
  { value: 'cost_financial', label: 'Cost / financial' },
  { value: 'scheduling', label: 'Scheduling conflict' },
  { value: 'declined', label: 'Patient declined' },
  { value: 'medical_hold', label: 'Medical hold' },
  { value: 'voicemail', label: 'Left voicemail' },
  { value: 'unreachable', label: 'No answer / unreachable' },
  { value: 'transferred', label: 'Transferred care elsewhere' },
  { value: 'rebooked_elsewhere', label: 'Will call back / pending' },
  { value: 'other_sections_pending', label: 'Other sections pending' },
  { value: 'treatment_complete', label: 'Treatment complete' },
  { value: 'other', label: 'Other (see notes)' },
] as const;

export function getNotRebookedReasonOptionsForQueue(queueId: string) {
  if (queueId === 'tmj_mri') return TMJ_MRI_REASON_OPTIONS;
  if (queueId === 'night_guard') return NIGHT_GUARD_REASON_OPTIONS;
  if (queueId === 'perio') return PERIO_REASON_OPTIONS;
  return NOT_REBOOKED_REASON_OPTIONS;
}
