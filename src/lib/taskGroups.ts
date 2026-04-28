/** Groups daily checklist items for the staff UI; also stored on materialized `tasks` as `taskGroup`. */
export const TASK_GROUP_ORDER = ['daily', 'hygiene_cc', 'predeterminations', 'treatment_planner', 'specialty', 'new_patient', 'referrals', 'other'] as const;

export type TaskGroupId = (typeof TASK_GROUP_ORDER)[number];

export const TASK_GROUP_LABELS: Record<TaskGroupId, string> = {
  daily: 'Daily',
  hygiene_cc: 'Hygiene CC',
  predeterminations: 'CC predeterminations',
  treatment_planner: 'Treatment planner',
  specialty: 'Ortho / TMJ / MRI',
  new_patient: 'New patient',
  referrals: 'Referrals',
  other: 'Other',
};

export function deriveTaskGroupFromTitle(title: string): TaskGroupId {
  const t = title.toUpperCase();
  if (t.includes('GOOGLE REVIEW')) return 'daily';
  if (t.includes('EMERGENCY PATIENT')) return 'daily';
  if (t.includes('UNSCHEDULE') || t.includes('NO SHOW')) return 'daily';
  if (t.includes('CC HYG')) return 'hygiene_cc';
  if (t.includes('PREDET')) return 'predeterminations';
  if (t.includes('TREATMENT PLANNER')) return 'treatment_planner';
  if (t.includes('ORTHO') || t.includes('TMJ') || t.includes('MRI')) return 'specialty';
  if (t.includes('NEW PATIENT')) return 'new_patient';
  if (t.includes('REFERAL') || t.includes('REFERRAL')) return 'referrals';
  return 'other';
}
