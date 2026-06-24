export const NOT_REBOOKED_REASON_OPTIONS = [
  { value: '', label: '—' },
  { value: 'cost_financial', label: 'Cost / financial' },
  { value: 'scheduling', label: 'Scheduling conflict' },
  { value: 'declined', label: 'Patient/parent declined' },
  { value: 'treatment_on_hold', label: 'Treatment on hold' },
  { value: 'voicemail', label: 'Left voicemail' },
  { value: 'unreachable', label: 'No answer / unreachable' },
  { value: 'transferred', label: 'Transferred care elsewhere' },
  { value: 'rebooked_elsewhere', label: 'Will call back / pending' },
  { value: 'unreliable_dont_book', label: "Unreliable, don't book" },
  { value: 'other', label: 'Other (see notes)' },
] as const;

/** No appt booked (recall) — same as default reason list. */
export const RECALL_REASON_OPTIONS = NOT_REBOOKED_REASON_OPTIONS;

/** New patient follow-up — custom reason list. */
export const NEW_PATIENT_REASON_OPTIONS = [
  { value: '', label: '—' },
  { value: 'patient_booked', label: 'Patient booked' },
  { value: 'cost_financial', label: 'Cost / financial' },
  { value: 'scheduling', label: 'Scheduling conflict' },
  { value: 'declined', label: 'Patient/parent declined' },
  { value: 'hold', label: 'Hold' },
  { value: 'voicemail', label: 'Left voicemail' },
  { value: 'unreachable', label: 'No answer / unreachable' },
  { value: 'transferred', label: 'Transferred care elsewhere' },
  { value: 'rebooked_elsewhere', label: 'Will call back / pending' },
  { value: 'other', label: 'Other (see notes)' },
] as const;

/** Emerg patient follow-up — custom reason list and auto-remove rules. */
export const EMERGENCY_REASON_OPTIONS = [
  { value: '', label: '—' },
  { value: 'patient_booked', label: 'Patient booked' },
  { value: 'cost_financial', label: 'Cost / financial' },
  { value: 'scheduling', label: 'Scheduling conflict' },
  { value: 'declined', label: 'Patient/parent declined' },
  { value: 'treatment_on_hold', label: 'Treatment on hold' },
  { value: 'voicemail', label: 'Left voicemail' },
  { value: 'unreachable', label: 'No answer / unreachable' },
  { value: 'transferred', label: 'Transferred care elsewhere' },
  { value: 'rebooked_elsewhere', label: 'Will call back / pending' },
  { value: 'other', label: 'Other (see notes)' },
] as const;

export const GUM_GRAFTING_REASON_OPTIONS = [
  { value: '', label: '—' },
  { value: 'cost_financial', label: 'Cost / financial' },
  { value: 'scheduling', label: 'Scheduling conflict' },
  { value: 'declined', label: 'Patient/parent declined' },
  { value: 'treatment_on_hold', label: 'Treatment on hold' },
  { value: 'voicemail', label: 'Left voicemail' },
  { value: 'unreachable', label: 'No answer / unreachable' },
  { value: 'transferred', label: 'Transferred care elsewhere' },
  { value: 'rebooked_elsewhere', label: 'Will call back / pending' },
  { value: 'other_sections_pending', label: 'Other sections pending' },
  { value: 'follow_up_at_next_hygiene', label: 'Follow up at next hygiene' },
  { value: 'other', label: 'Other (see notes)' },
] as const;

const QUEUE_REASON_REMOVES_FROM_LIST: Record<string, ReadonlySet<string>> = {
  emerg_follow_up: new Set(['patient_booked', 'transferred']),
  new_patient_follow_up: new Set(['patient_booked']),
  no_appt_booked: new Set(['transferred']),
};

export function queueReasonRemovesFromList(queueId: string, reasonValue: string): boolean {
  return QUEUE_REASON_REMOVES_FROM_LIST[queueId]?.has(reasonValue) ?? false;
}

export function queueReasonRemovalPatch(
  queueId: string,
  reasonValue: string
): { removedFromList: true; removedAt: string } | Record<string, never> {
  if (!reasonValue || !queueReasonRemovesFromList(queueId, reasonValue)) return {};
  return { removedFromList: true, removedAt: new Date().toISOString() };
}

export const TMJ_MRI_REASON_OPTIONS = [
  { value: '', label: '—' },
  { value: 'patient_booked', label: 'Patient booked' },
  { value: 'patient_declined', label: 'Patient/parent declined' },
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
  { value: 'declined', label: 'Patient/parent declined' },
  { value: 'treatment_on_hold', label: 'Treatment on hold' },
  { value: 'voicemail', label: 'Left voicemail' },
  { value: 'unreachable', label: 'No answer / unreachable' },
  { value: 'transferred', label: 'Transferred care elsewhere' },
  { value: 'rebooked_elsewhere', label: 'Will call back / pending' },
  { value: 'other_sections_pending', label: 'Other sections pending' },
  { value: 'treatment_complete', label: 'Treatment complete' },
  { value: 'other', label: 'Other (see notes)' },
] as const;

export function getNotRebookedReasonOptionsForQueue(queueId: string) {
  if (queueId === 'emerg_follow_up') return EMERGENCY_REASON_OPTIONS;
  if (queueId === 'new_patient_follow_up') return NEW_PATIENT_REASON_OPTIONS;
  if (queueId === 'no_appt_booked') return RECALL_REASON_OPTIONS;
  if (queueId === 'gum_grafting') return GUM_GRAFTING_REASON_OPTIONS;
  if (queueId === 'tmj_mri') return TMJ_MRI_REASON_OPTIONS;
  if (queueId === 'night_guard') return NIGHT_GUARD_REASON_OPTIONS;
  if (queueId === 'perio') return PERIO_REASON_OPTIONS;
  return NOT_REBOOKED_REASON_OPTIONS;
}
