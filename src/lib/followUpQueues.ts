export const FOLLOW_UP_QUEUE_RECALL = 'recall' as const;
export const FOLLOW_UP_QUEUE_OUTREACH = 'outreach' as const;

export type FollowUpQueue = typeof FOLLOW_UP_QUEUE_RECALL | typeof FOLLOW_UP_QUEUE_OUTREACH;

/** Legacy estimate rows may omit `queue` but set `status: estimate_followup`. */
export function isOutreachFollowUpDoc(data: Record<string, unknown>): boolean {
  if (data.queue === FOLLOW_UP_QUEUE_OUTREACH) return true;
  if (String(data.status ?? '').toLowerCase() === 'estimate_followup') return true;
  return false;
}

export function isRecallFollowUpDoc(data: Record<string, unknown>): boolean {
  return !isOutreachFollowUpDoc(data);
}

/** Open items for outreach queue KPIs (post-visit uses postVisitResolved, estimates use nextAppointmentBooked). */
export function isOpenOutreachItem(data: Record<string, unknown>): boolean {
  if (!isOutreachFollowUpDoc(data)) return false;
  if (data.kind === 'post_visit') return data.postVisitResolved !== true;
  return data.nextAppointmentBooked !== true;
}
