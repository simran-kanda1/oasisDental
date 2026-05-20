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
