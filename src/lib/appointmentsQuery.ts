/** Firestore appointments listener limit — raised from 5000 for older qualifying visits. */
export const APPOINTMENTS_QUERY_LIMIT = 10000;

/** New patient follow-up: hide patients whose last qualifying visit was more than this many months ago. */
export const NEW_PATIENT_MAX_MONTHS = 12;
