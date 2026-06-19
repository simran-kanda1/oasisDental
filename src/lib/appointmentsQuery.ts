import type { DentrixAppointmentDoc } from './dentrix';

/** Firestore appointments listener limit — raised from 5000 for older qualifying visits. */
export const APPOINTMENTS_QUERY_LIMIT = 10000;

/** Dedicated upcoming-appointments listener so future hygiene/ortho visits are never dropped. */
export const FUTURE_APPOINTMENTS_QUERY_LIMIT = 5000;

/** New patient follow-up: hide patients whose last qualifying visit was more than this many months ago. */
export const NEW_PATIENT_MAX_MONTHS = 12;

/** Merge appointment snapshots by Firestore doc id (later lists win). */
export function mergeAppointmentsById(...lists: DentrixAppointmentDoc[][]): DentrixAppointmentDoc[] {
  const map = new Map<string, DentrixAppointmentDoc>();
  for (const list of lists) {
    for (const a of list) map.set(a.id, a);
  }
  return Array.from(map.values());
}
