import { describe, expect, it } from 'vitest';
import { patientHasFutureAppointmentAfter } from './appointmentHeuristics';
import type { DentrixAppointmentDoc } from './dentrix';

describe('patientHasFutureAppointmentAfter', () => {
  const now = new Date('2026-06-24T12:00:00Z');
  const afterDate = new Date('2026-06-20T12:00:00Z');

  it('returns false when only cancelled future appointments exist', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'cancelled',
        patient_id: 1,
        appointment_date: '2026-06-28T10:00:00Z',
        reason: 'cancelled appointment',
        status_id: 3,
      },
    ];
    expect(patientHasFutureAppointmentAfter('1', afterDate, appts, now)).toBe(false);
  });

  it('returns true for an active future appointment after the no-show date', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'future',
        patient_id: 1,
        appointment_date: '2026-06-28T10:00:00Z',
        reason: 'Recall',
        status_id: 1,
      },
    ];
    expect(patientHasFutureAppointmentAfter('1', afterDate, appts, now)).toBe(true);
  });

  it('ignores the excluded no-show appointment id', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'no-show-appt',
        patient_id: 1,
        appointment_date: '2026-06-28T10:00:00Z',
        reason: 'Recall',
        status_id: 1,
      },
    ];
    expect(patientHasFutureAppointmentAfter('1', afterDate, appts, now, 'no-show-appt')).toBe(false);
  });
});
