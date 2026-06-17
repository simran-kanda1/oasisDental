import { describe, expect, it } from 'vitest';
import {
  getRecallDueDate,
  isRecallOverdue,
  parseRecallIntervalMonths,
} from './appointmentHeuristics';
import { buildQueueRows, matchesAgeBucket, isHygieneRecallLabel, GA_ALL_APPOINTMENTS_QUEUE_ID } from '../data/queueRules';
import type { DentrixAppointmentDoc } from './dentrix';
import {
  anyCodeMatchesQueue,
  codeMatchesQueueRule,
} from './queueProcedureCodes';
import { findClaimForDocument, type DentrixInsuranceClaimDoc } from './insuranceClaimEstimates';
import { matchesEstimateAgeBucket } from './estimateTreatment';

describe('parseRecallIntervalMonths', () => {
  it('parses 4M and 4 mo patterns', () => {
    expect(parseRecallIntervalMonths('4M prophy')).toBe(4);
    expect(parseRecallIntervalMonths('2M recall')).toBe(2);
    expect(parseRecallIntervalMonths('hygiene 6 mo recall')).toBe(6);
    expect(parseRecallIntervalMonths('2 month check')).toBe(2);
  });

  it('returns null when no interval', () => {
    expect(parseRecallIntervalMonths('adult prophy')).toBeNull();
  });
});

describe('matchesAgeBucket (exclusive)', () => {
  it('places months in a single bucket', () => {
    expect(matchesAgeBucket(0, '0-1')).toBe(true);
    expect(matchesAgeBucket(0, '1-3')).toBe(false);
    expect(matchesAgeBucket(2, '1-3')).toBe(true);
    expect(matchesAgeBucket(2, '0-1')).toBe(false);
    expect(matchesAgeBucket(12, '12+')).toBe(true);
    expect(matchesAgeBucket(11, '12+')).toBe(false);
  });
});

describe('matchesEstimateAgeBucket', () => {
  it('matches queue aging buckets', () => {
    expect(matchesEstimateAgeBucket(5, '3-6')).toBe(true);
    expect(matchesEstimateAgeBucket(5, '6-9')).toBe(false);
  });
});

describe('queue procedure codes', () => {
  it('matches resto range for fillings queue config', () => {
    expect(anyCodeMatchesQueue(['23311'], 'fillings')).toBe(true);
    expect(anyCodeMatchesQueue(['01101'], 'new_patient_follow_up')).toBe(true);
    expect(anyCodeMatchesQueue(['27201'], 'fillings')).toBe(false);
  });

  it('matches explicit codes in bone grafting', () => {
    expect(codeMatchesQueueRule('74401', { type: 'codes', codes: ['74401'] })).toBe(true);
    expect(codeMatchesQueueRule('42650', { type: 'range', begin: '42611', end: '42703' })).toBe(true);
  });

  it('matches ga, cbct, and perio ranges', () => {
    expect(anyCodeMatchesQueue(['92222'], GA_ALL_APPOINTMENTS_QUEUE_ID)).toBe(true);
    expect(anyCodeMatchesQueue(['07011'], 'cbct')).toBe(true);
    expect(anyCodeMatchesQueue(['41101'], 'perio')).toBe(true);
    expect(anyCodeMatchesQueue(['27201'], 'fillings')).toBe(false);
    expect(anyCodeMatchesQueue(['M0000022'], 'tmj_mri')).toBe(true);
  });
});

describe('isHygieneRecallLabel', () => {
  it('treats 3M and 4M recall labels as hygiene', () => {
    expect(isHygieneRecallLabel('4m')).toBe(true);
    expect(isHygieneRecallLabel('3M recall')).toBe(true);
    expect(isHygieneRecallLabel('crown prep 4m')).toBe(false);
  });
});

describe('recall due date', () => {
  it('due date is last visit plus interval months on the same day', () => {
    const appt: DentrixAppointmentDoc = {
      id: 'a1',
      patient_id: 1,
      appointment_date: '2026-04-10T10:00:00Z',
      reason: '2M prophy',
    };
    const due = getRecallDueDate(appt, 2);
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-10');
  });

  it('2M from Apr 10 is not overdue until Jun 10', () => {
    const appt: DentrixAppointmentDoc = {
      id: 'a1',
      patient_id: 1,
      appointment_date: '2026-04-10T10:00:00Z',
      reason: '2M prophy',
    };
    expect(isRecallOverdue(appt, new Date('2026-06-09T12:00:00Z'))).toBe(false);
    expect(isRecallOverdue(appt, new Date('2026-06-10T12:00:00Z'))).toBe(true);
    expect(isRecallOverdue(appt, new Date('2026-06-15T12:00:00Z'))).toBe(true);
  });
});

describe('recall interval queue filtering', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const patientsById = {
    '1': { id: 'p1', patient_id: 1, first_name: 'Test', last_name: 'Patient', status: 1 },
  };

  it('hides 4M recall patient until 4 months after last visit', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'a1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-03-01T10:00:00Z',
        reason: '4M prophy',
        appointment_type: 'cleaning',
      },
    ];
    const rows = buildQueueRows('hygiene_cc', appts, patientsById, 0, now, 'all', 'all', {});
    expect(rows).toHaveLength(0);
  });

  it('shows 4M recall patient when overdue', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'a1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-01T10:00:00Z',
        reason: '4M prophy',
        appointment_type: 'cleaning',
      },
    ];
    const rows = buildQueueRows('hygiene_cc', appts, patientsById, 0, now, 'all', 'all', {});
    expect(rows).toHaveLength(1);
    expect(rows[0].recallIntervalMonths).toBe(4);
  });

  it('shows 2M Apr 10 patient in June once due (no future appt)', () => {
    const appt: DentrixAppointmentDoc = {
      id: 'a1',
      patient_id: 1,
      patient_name: 'Test Patient',
      appointment_date: '2026-04-10T10:00:00Z',
      reason: '2M prophy',
      appointment_type: 'cleaning',
    };
    const beforeDue = buildQueueRows(
      'hygiene_cc',
      [appt],
      patientsById,
      0,
      new Date('2026-06-09T12:00:00Z'),
      'all',
      'all',
      {}
    );
    expect(beforeDue).toHaveLength(0);

    const onDue = buildQueueRows(
      'hygiene_cc',
      [appt],
      patientsById,
      0,
      new Date('2026-06-10T12:00:00Z'),
      '1-3',
      'all',
      {}
    );
    expect(onDue).toHaveLength(1);
    expect(onDue[0].isOverdue).toBe(true);
  });

  it('lists GA appointments without requiring no future appt', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ga1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-15T10:00:00Z',
        reason: 'General anesthesia',
      },
      {
        id: 'ga2',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-08-01T10:00:00Z',
        reason: 'GA follow up',
      },
    ];
    const rows = buildQueueRows(GA_ALL_APPOINTMENTS_QUEUE_ID, appts, patientsById, 0, now, 'all', 'all', {});
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('findClaimForDocument', () => {
  const crownClaim: DentrixInsuranceClaimDoc = {
    id: '1',
    procedures: [{ adacode: '27201' }],
  };
  const cleaningClaim: DentrixInsuranceClaimDoc = {
    id: '2',
    procedures: [{ adacode: '11101' }],
  };

  it('prefers claim matching hint codes over first claim', () => {
    const hit = findClaimForDocument({
      patientId: '100',
      descript: 'explanation of benefits',
      claimsForPatient: [cleaningClaim, crownClaim],
      idCandidates: [],
      hintCodes: ['27201'],
    });
    expect(hit?.id).toBe('1');
  });

  it('does not fall back to first claim without hint overlap', () => {
    const hit = findClaimForDocument({
      patientId: '100',
      descript: 'explanation of benefits',
      claimsForPatient: [cleaningClaim, crownClaim],
      idCandidates: [],
      hintCodes: [],
    });
    expect(hit).toBeNull();
  });
});
