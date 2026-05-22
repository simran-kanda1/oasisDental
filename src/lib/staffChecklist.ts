/** Stable 0/1 bucket for splitting reception protocols between two secretaries. */
export function receptionColumnIndex(taskId: string): 0 | 1 {
  let hash = 0;
  for (let i = 0; i < taskId.length; i++) hash = (hash + taskId.charCodeAt(i)) % 2;
  return hash as 0 | 1;
}

export const RECEPTION_COLUMN_LABELS = ['Reception 1', 'Reception 2'] as const;

/** Dentist task visible to everyone on the checklist */
export const DENTIST_ASSIGNMENT_GENERAL = '__general__' as const;

export type DentistChecklistId = 'rick' | 'vick';

export const DENTIST_CHECKLIST_LABELS: Record<DentistChecklistId, string> = {
  rick: 'Dr. Rick — to do',
  vick: 'Dr. Vick — to do',
};

export const DENTIST_TASK_TYPE = 'dentist_checklist' as const;
