import {
  FRONT_DESK_QUEUE_DEFS,
  GA_ALL_APPOINTMENTS_QUEUE_ID,
  NO_APPT_BOOKED_QUEUE_ID,
  STANDALONE_FRONT_DESK_QUEUE_DEFS,
  buildQueueIndexes,
  buildQueueRowCount,
  isStandaloneFrontDeskQueue,
  type AgeBucketFilter,
  type QueueBuildContext,
  type VisitWeekBucketFilter,
} from '../data/queueRules';
import {
  isActiveDentrixPatient,
  parseDentrixDate,
  type DentrixAppointmentDoc,
  type DentrixPatientAppointmentInfoDoc,
  type DentrixPatientDoc,
} from './dentrix';
import { isActiveScheduledAppointment, isAppointmentOnOrAfterToday } from './appointmentHeuristics';

export function countNoApptBookedQueue(
  patientInfoById: Record<string, DentrixPatientAppointmentInfoDoc>,
  patientsById: Record<string, DentrixPatientDoc>,
  appointments: DentrixAppointmentDoc[] = [],
  now = new Date()
): number {
  const futureByPatient = new Set<string>();
  for (const a of appointments) {
    const pid = String(a.patient_id ?? '');
    if (!pid || !isActiveScheduledAppointment(a, now)) continue;
    futureByPatient.add(pid);
  }

  let count = 0;
  for (const info of Object.values(patientInfoById)) {
    const missed = Number(info.number_of_missed_appointments ?? 0);
    if (missed < 1) continue;
    const patientKey = String(info.patient_id ?? info.id);
    if (futureByPatient.has(patientKey)) continue;
    const nextD = parseDentrixDate(info.next_appointment_date);
    if (nextD && isAppointmentOnOrAfterToday(nextD, now)) continue;
    const patient = patientsById[patientKey];
    if (patient && !isActiveDentrixPatient(patient)) continue;
    count += 1;
  }
  return count;
}

export function computeFrontDeskQueueCounts(
  appointments: DentrixAppointmentDoc[],
  patientsById: Record<string, DentrixPatientDoc>,
  patientInfoById: Record<string, DentrixPatientAppointmentInfoDoc>,
  now = new Date(),
  ctx: QueueBuildContext = {}
): Record<string, number> {
  const counts: Record<string, number> = {
    [NO_APPT_BOOKED_QUEUE_ID]: countNoApptBookedQueue(patientInfoById, patientsById, appointments, now),
  };

  const sharedIndexes = buildQueueIndexes(appointments, { ...ctx, patientInfoById }, patientsById);
  for (const q of [...FRONT_DESK_QUEUE_DEFS, ...STANDALONE_FRONT_DESK_QUEUE_DEFS]) {
    const queueCtx: QueueBuildContext =
      q.id === GA_ALL_APPOINTMENTS_QUEUE_ID
        ? { ...ctx, patientInfoById, gaTimeFilter: 'all' }
        : { ...ctx, patientInfoById };
    counts[q.id] = buildQueueRowCount(
      q.id,
      appointments,
      patientsById,
      now,
      'all',
      'all',
      queueCtx,
      sharedIndexes
    );
  }

  return counts;
}

/** Badge total for the No future appointments hub (excludes standalone main-nav queues). */
export function frontDeskHubQueueTotal(counts: Record<string, number>): number {
  return Object.entries(counts).reduce(
    (sum, [id, n]) => (isStandaloneFrontDeskQueue(id) ? sum : sum + n),
    0
  );
}

export function frontDeskQueueTotal(counts: Record<string, number>): number {
  return frontDeskHubQueueTotal(counts);
}

export const DEFAULT_AGE_BUCKET: AgeBucketFilter = 'all';
export const DEFAULT_WEEK_BUCKET: VisitWeekBucketFilter = 'all';
