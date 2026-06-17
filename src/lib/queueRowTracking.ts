/** Firestore collection for per-appointment queue notes (all front-desk queues + no-shows). */
export const QUEUE_ROW_TRACKING_COLLECTION = 'queueRowTracking';

export interface QueueRowTrackingDoc {
  appointmentId: string;
  patientId?: string;
  queueId?: string;
  notRebookedReason?: string;
  notes?: string;
  updatedAt?: string;
  updatedBy?: string;
  removedFromList?: boolean;
  removedAt?: string;
  treatmentComplete?: boolean;
  treatmentCompleteAt?: string;
}

export function queueTrackingDocId(appointmentFirestoreId: string): string {
  return appointmentFirestoreId;
}
