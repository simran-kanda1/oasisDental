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
  { value: 'inactive', label: 'Inactive' },
] as const;

export function getNotRebookedReasonOptionsForQueue(queueId: string) {
  if (queueId === 'tmj_mri') return TMJ_MRI_REASON_OPTIONS;
  return NOT_REBOOKED_REASON_OPTIONS;
}
