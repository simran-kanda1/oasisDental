import { describe, expect, it } from 'vitest';
import {
  getRecallDueDate,
  isHygieneProductionType,
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
    expect(anyCodeMatchesQueue(['27201'], 'fillings')).toBe(false);
  });

  it('matches new patient comprehensive codes but not routine periodic exams', () => {
    expect(anyCodeMatchesQueue(['01401'], 'new_patient_follow_up')).toBe(true);
    expect(anyCodeMatchesQueue(['01501'], 'new_patient_follow_up')).toBe(true);
    expect(anyCodeMatchesQueue(['01101'], 'new_patient_follow_up')).toBe(false);
    expect(anyCodeMatchesQueue(['27201'], 'fillings')).toBe(false);
  });

  it('matches explicit codes in bone grafting', () => {
    expect(codeMatchesQueueRule('74401', { type: 'codes', codes: ['74401'] })).toBe(true);
    expect(codeMatchesQueueRule('42650', { type: 'range', begin: '42611', end: '42703' })).toBe(true);
  });

  it('matches ga, cbct, perio, and root canal ranges', () => {
    expect(anyCodeMatchesQueue(['92222'], GA_ALL_APPOINTMENTS_QUEUE_ID)).toBe(true);
    expect(anyCodeMatchesQueue(['07011'], 'cbct')).toBe(true);
    expect(anyCodeMatchesQueue(['41101'], 'perio')).toBe(true);
    expect(anyCodeMatchesQueue(['33111'], 'root_canal')).toBe(true);
    expect(anyCodeMatchesQueue(['27201'], 'fillings')).toBe(false);
    expect(anyCodeMatchesQueue(['M0000022'], 'tmj_mri')).toBe(true);
  });
});

describe('isHygieneProductionType', () => {
  it('matches HYG1, HYG2, HYRA, and HYCP appointment categories', () => {
    expect(isHygieneProductionType({ id: 'a', appointment_type: 'HYG1' })).toBe(true);
    expect(isHygieneProductionType({ id: 'a', appt_type: 'HYG2' })).toBe(true);
    expect(isHygieneProductionType({ id: 'a', appointment_type: 'HYRA' })).toBe(true);
    expect(isHygieneProductionType({ id: 'a', appointment_type: 'HYCP' })).toBe(true);
    expect(isHygieneProductionType({ id: 'a', appointment_type: 'Crown prep' })).toBe(false);
  });
});

describe('isHygieneRecallLabel', () => {
  it('treats 3M and 4M recall labels as hygiene', () => {
    expect(isHygieneRecallLabel('4m')).toBe(true);
    expect(isHygieneRecallLabel('3M recall')).toBe(true);
    expect(isHygieneRecallLabel('crown prep 4m')).toBe(false);
  });

  it('treats 6M continuing care and continuing care labels as hygiene', () => {
    expect(isHygieneRecallLabel('6mo continuing care')).toBe(true);
    expect(isHygieneRecallLabel('6m recall')).toBe(true);
    expect(isHygieneRecallLabel('continuing care')).toBe(true);
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
  const hygieneProcedureCodes = [{ id: 'h1', proccodeid: 111, adacode: '11101', descript: 'Prophy' }];
  const orthoProcedureCodes = [{ id: 'o1', proccodeid: 801, adacode: '80101', descript: 'Ortho' }];

  function ledgerForVisit(
    patid: number,
    proccodeid: number,
    procdate: string,
    chartstatus = 105
  ): Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]> {
    return new Map([
      [
        patid,
        [
          {
            id: `l-${patid}-${procdate}`,
            patid,
            proccodeid,
            procdate,
            chartstatus,
          },
        ],
      ],
    ]);
  }

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
    const rows = buildQueueRows('hygiene_cc', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes: hygieneProcedureCodes,
      ledgerByPatientId: ledgerForVisit(1, 111, '2026-03-01T10:00:00Z'),
    });
    expect(rows).toHaveLength(0);
  });

  it('hides overdue hygiene patient when future visit only has recall text (no ledger codes yet)', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'past',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-01T10:00:00Z',
        reason: '4M prophy',
        appointment_type: 'cleaning',
      },
      {
        id: 'future-hyg',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-08-01T10:00:00Z',
        reason: '4M prophy',
        appointment_type: 'cleaning',
      },
    ];
    const rows = buildQueueRows('hygiene_cc', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes: hygieneProcedureCodes,
      ledgerByPatientId: ledgerForVisit(1, 111, '2026-01-01T10:00:00Z'),
    });
    expect(rows).toHaveLength(0);
  });

  it('does not list hygiene from recall text without hygiene codes on the visit', () => {
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
    const rows = buildQueueRows('hygiene_cc', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes: hygieneProcedureCodes,
    });
    expect(rows).toHaveLength(0);
  });

  it('hides overdue hygiene patient when any future hygiene visit exists (not only next)', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'past',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-01T10:00:00Z',
        reason: '4M prophy',
        appointment_type: 'cleaning',
      },
      {
        id: 'future-crown',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-07-01T10:00:00Z',
        reason: 'Crown prep',
      },
      {
        id: 'future-hyg',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-08-01T10:00:00Z',
        reason: 'Adult prophy',
        appointment_type: 'cleaning',
      },
    ];
    const rows = buildQueueRows('hygiene_cc', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes: hygieneProcedureCodes,
      ledgerByPatientId: new Map([
        ...(ledgerForVisit(1, 111, '2026-01-01T10:00:00Z').entries()),
        ...(ledgerForVisit(1, 111, '2026-08-01T10:00:00Z').entries()),
      ]),
    });
    expect(rows).toHaveLength(0);
  });

  it('hides overdue ortho patient when a future ortho visit exists', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'past-ortho',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-01T10:00:00Z',
        reason: 'Ortho adjustment',
      },
      {
        id: 'future-ortho',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-08-01T10:00:00Z',
        reason: 'Invisalign check',
      },
    ];
    const rows = buildQueueRows('ortho_follow_ups', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes: orthoProcedureCodes,
      ledgerByPatientId: new Map([
        ...(ledgerForVisit(1, 801, '2026-01-01T10:00:00Z').entries()),
        ...(ledgerForVisit(1, 801, '2026-08-01T10:00:00Z').entries()),
      ]),
    });
    expect(rows).toHaveLength(0);
  });

  it('does not hide overdue ortho when future visit only has unrelated procedure codes', () => {
    const procedureCodes = [
      { id: '1', proccodeid: 1, adacode: '27201', descript: 'Crown' },
      ...orthoProcedureCodes,
    ];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'past-ortho',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-01T10:00:00Z',
        reason: 'Ortho bands',
      },
      {
        id: 'future-crown',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-08-01T10:00:00Z',
        reason: '27201 crown prep',
      },
    ];
    const rows = buildQueueRows('ortho_follow_ups', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId: ledgerForVisit(1, 801, '2026-01-01T10:00:00Z'),
    });
    expect(rows).toHaveLength(1);
  });

  it('shows hygiene patient with HYG1 production type when overdue', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'a1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-01T10:00:00Z',
        appointment_type: 'HYG1',
        reason: '4M prophy',
      },
    ];
    const rows = buildQueueRows('hygiene_cc', appts, patientsById, 0, now, 'all', 'all', {});
    expect(rows).toHaveLength(1);
  });

  it('hides overdue hygiene when future visit is HYG2 production type', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'past',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-01T10:00:00Z',
        appointment_type: 'HYG1',
        reason: '4M prophy',
      },
      {
        id: 'future',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-08-01T10:00:00Z',
        appointment_type: 'HYG2',
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
    const rows = buildQueueRows('hygiene_cc', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes: hygieneProcedureCodes,
      ledgerByPatientId: ledgerForVisit(1, 111, '2026-01-01T10:00:00Z'),
    });
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
    const ctx = {
      procedureCodes: hygieneProcedureCodes,
      ledgerByPatientId: ledgerForVisit(1, 111, '2026-04-10T10:00:00Z'),
    };
    const beforeDue = buildQueueRows(
      'hygiene_cc',
      [appt],
      patientsById,
      0,
      new Date('2026-06-09T12:00:00Z'),
      'all',
      'all',
      ctx
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
      ctx
    );
    expect(onDue).toHaveLength(1);
    expect(onDue[0].isOverdue).toBe(true);
  });

  it('uses reason recall interval instead of continuing-care production type label', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'a1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-01T10:00:00Z',
        reason: '4M prophy',
        appointment_type: 'HYG1',
        production_type_desc: '6mo Continuing care',
      } as DentrixAppointmentDoc,
    ];
    const rows = buildQueueRows('hygiene_cc', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes: hygieneProcedureCodes,
      ledgerByPatientId: ledgerForVisit(1, 111, '2026-01-01T10:00:00Z'),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].recallIntervalMonths).toBe(4);
  });

  it('hides patient when scaling visit exists but future 6mo continuing care is booked', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'scaling',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-05-01T10:00:00Z',
        appointment_type: 'HYG2',
        reason: '* SCALING',
        production_type_desc: '6mo Continuing care',
      } as DentrixAppointmentDoc,
      {
        id: 'future-cc',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-11-01T10:00:00Z',
        production_type_desc: '6mo Continuing care',
      } as DentrixAppointmentDoc,
    ];
    const rows = buildQueueRows('hygiene_cc', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes: hygieneProcedureCodes,
      ledgerByPatientId: ledgerForVisit(1, 111, '2026-01-01T10:00:00Z'),
    });
    expect(rows).toHaveLength(0);
  });

  it('anchors hygiene CC on prior prophy when latest visit is scaling only', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'prophy',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-01T10:00:00Z',
        appointment_type: 'HYG1',
        reason: '4M prophy',
      },
      {
        id: 'scaling',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-05-01T10:00:00Z',
        appointment_type: 'HYG2',
        reason: '* SCALING',
        production_type_desc: '6mo Continuing care',
      } as DentrixAppointmentDoc,
    ];
    const rows = buildQueueRows('hygiene_cc', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes: hygieneProcedureCodes,
      ledgerByPatientId: ledgerForVisit(1, 111, '2026-01-01T10:00:00Z'),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].recallIntervalMonths).toBe(4);
    expect(rows[0].detail).toBe('4M prophy');
  });

  it('does not list GA from appointment text without completed ledger code', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ga1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-15T10:00:00Z',
        reason: 'General anesthesia',
      },
    ];
    const rows = buildQueueRows(GA_ALL_APPOINTMENTS_QUEUE_ID, appts, patientsById, 0, now, 'all', 'all', {});
    expect(rows).toHaveLength(0);
  });

  it('removes GA row when completed GA code is already posted in ledger', () => {
    const procedureCodes = [{ id: '1', proccodeid: 922, adacode: '92222', descript: 'GA' }];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ga1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-15T10:00:00Z',
        reason: 'General anesthesia',
      },
    ];
    const ledgerByPatientId = new Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]>([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 922,
            procdate: '2026-01-15T10:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
    ]);
    const rows = buildQueueRows(GA_ALL_APPOINTMENTS_QUEUE_ID, appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
    });
    expect(rows).toHaveLength(0);
  });

  it('lists upcoming GA appointments within four months when filter is upcoming_4mo', () => {
    const procedureCodes = [{ id: '1', proccodeid: 922, adacode: '92222', descript: 'GA' }];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ga-future',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-08-01T10:00:00Z',
        reason: '92222 GA',
      },
    ];
    const ctx = { procedureCodes, gaTimeFilter: 'upcoming_4mo' as const };
    const upcoming = buildQueueRows(GA_ALL_APPOINTMENTS_QUEUE_ID, appts, patientsById, 0, now, 'all', 'all', ctx);
    expect(upcoming).toHaveLength(1);

    const pastOnly = buildQueueRows(GA_ALL_APPOINTMENTS_QUEUE_ID, appts, patientsById, 0, now, 'all', 'all', {
      ...ctx,
      gaTimeFilter: 'past',
    });
    expect(pastOnly).toHaveLength(0);
  });

  it('excludes GA appointments more than four months in the future', () => {
    const procedureCodes = [{ id: '1', proccodeid: 922, adacode: '92222', descript: 'GA' }];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ga-far',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-12-01T10:00:00Z',
        reason: '92222 GA',
      },
    ];
    const rows = buildQueueRows(GA_ALL_APPOINTMENTS_QUEUE_ID, appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      gaTimeFilter: 'upcoming_4mo',
    });
    expect(rows).toHaveLength(0);
  });

  it('does not list root canal when only unrelated codes are on the visit', () => {
    const procedureCodes = [
      { id: '1', proccodeid: 233, adacode: '23311', descript: 'Filling' },
      { id: '2', proccodeid: 331, adacode: '33111', descript: 'RCT' },
    ];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'a1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-15T10:00:00Z',
        reason: 'Refer to endo / root canal eval',
      },
    ];
    const ledgerByPatientId = new Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]>([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 233,
            procdate: '2026-01-15T10:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
    ]);
    const rows = buildQueueRows('root_canal', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
    });
    expect(rows).toHaveLength(0);
  });

  it('lists root canal when endo code is on the visit', () => {
    const procedureCodes = [{ id: '2', proccodeid: 331, adacode: '33111', descript: 'RCT' }];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'a1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-15T10:00:00Z',
        reason: 'Endo visit',
      },
    ];
    const ledgerByPatientId = new Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]>([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 331,
            procdate: '2026-01-15T10:00:00Z',
            chartstatus: 105,
          },
        ],
      ],
    ]);
    const rows = buildQueueRows('root_canal', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
    });
    expect(rows).toHaveLength(1);
  });

  it('removes extraction once matching code is posted in ledger', () => {
    const procedureCodes = [{ id: '1', proccodeid: 711, adacode: '71101', descript: 'Extraction' }];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ext1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-15T10:00:00Z',
        reason: 'Extraction',
      },
    ];
    const ledgerByPatientId = new Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]>([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 711,
            procdate: '2026-01-15T10:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
    ]);
    const rows = buildQueueRows('extraction', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
    });
    expect(rows).toHaveLength(0);
  });

  it('removes restorative once matching code is posted in ledger', () => {
    const procedureCodes = [{ id: '1', proccodeid: 233, adacode: '23311', descript: 'Filling' }];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'f1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-15T10:00:00Z',
        reason: 'Composite',
      },
    ];
    const ledgerByPatientId = new Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]>([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 233,
            procdate: '2026-01-15T10:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
    ]);
    const rows = buildQueueRows('fillings', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
    });
    expect(rows).toHaveLength(0);
  });

  it('removes root canal once matching code is posted in ledger', () => {
    const procedureCodes = [{ id: '2', proccodeid: 331, adacode: '33111', descript: 'RCT' }];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'a1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-15T10:00:00Z',
        reason: 'Endo visit',
      },
    ];
    const ledgerByPatientId = new Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]>([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 331,
            procdate: '2026-01-15T10:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
    ]);
    const rows = buildQueueRows('root_canal', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
    });
    expect(rows).toHaveLength(0);
  });

  it('removes ortho once matching code is posted in ledger', () => {
    const procedureCodes = [{ id: 'o1', proccodeid: 801, adacode: '80101', descript: 'Ortho' }];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ortho1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-15T10:00:00Z',
        reason: 'Ortho adjustment',
      },
    ];
    const ledgerByPatientId = new Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]>([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 801,
            procdate: '2026-01-15T10:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
    ]);
    const rows = buildQueueRows('ortho_follow_ups', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
    });
    expect(rows).toHaveLength(0);
  });

  it('removes bone grafting once matching code is posted in ledger', () => {
    const procedureCodes = [{ id: 'bg1', proccodeid: 426, adacode: '42611', descript: 'Bone graft' }];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'bg1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-15T10:00:00Z',
        reason: 'Bone graft',
      },
    ];
    const ledgerByPatientId = new Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]>([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 426,
            procdate: '2026-01-15T10:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
    ]);
    const rows = buildQueueRows('bone_grafting', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
    });
    expect(rows).toHaveLength(0);
  });

  it('excludes rows marked treatment complete or removed in any queue', () => {
    const procedureCodes = [{ id: '1', proccodeid: 711, adacode: '71101', descript: 'Extraction' }];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ext1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-15T10:00:00Z',
        reason: 'Extraction',
      },
    ];
    const ledgerByPatientId = new Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]>([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 711,
            procdate: '2026-01-15T10:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
    ]);
    const withComplete = buildQueueRows('extraction', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
      trackingByApptId: {
        ext1: { appointmentId: 'ext1', treatmentComplete: true },
      },
    });
    expect(withComplete).toHaveLength(0);
  });

  it('excludes GA rows marked treatment complete or removed', () => {
    const procedureCodes = [{ id: '1', proccodeid: 922, adacode: '92222', descript: 'GA' }];
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ga1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-01-15T10:00:00Z',
        reason: 'General anesthesia',
      },
    ];
    const ledgerByPatientId = new Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]>([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 922,
            procdate: '2026-01-15T10:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
    ]);
    const baseCtx = { procedureCodes, ledgerByPatientId };
    const withComplete = buildQueueRows(GA_ALL_APPOINTMENTS_QUEUE_ID, appts, patientsById, 0, now, 'all', 'all', {
      ...baseCtx,
      trackingByApptId: {
        ga1: { appointmentId: 'ga1', treatmentComplete: true },
      },
    });
    expect(withComplete).toHaveLength(0);

    const withRemoved = buildQueueRows(GA_ALL_APPOINTMENTS_QUEUE_ID, appts, patientsById, 0, now, 'all', 'all', {
      ...baseCtx,
      trackingByApptId: {
        ga1: { appointmentId: 'ga1', removedFromList: true },
      },
    });
    expect(withRemoved).toHaveLength(0);
  });
});

describe('cbct and night guard queues', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const patientsById = {
    '1': { id: '1', patient_id: 1, first_name: 'Pat', last_name: 'One', status: 1 },
  };

  it('lists CBCT when ADA code appears on the appointment visit', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'cbct1',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-03-01T10:00:00',
        reason: '07011 imaging',
      },
    ];
    const procedureCodes = [{ id: '1', proccodeid: 701, adacode: '07011', descript: 'CBCT' }];
    const rows = buildQueueRows('cbct', appts, patientsById, 0, now, 'all', 'all', { procedureCodes });
    expect(rows).toHaveLength(1);
  });

  it('lists CBCT from ledger codes on the visit date', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'cbct1',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-03-01T10:00:00',
        reason: 'Imaging appointment',
      },
    ];
    const procedureCodes = [{ id: '1', proccodeid: 701, adacode: '07011', descript: 'CBCT' }];
    const ledgerByPatientId = new Map([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 701,
            procdate: '2026-03-01T10:00:00',
            chartstatus: 105,
          },
        ],
      ],
    ]);
    const rows = buildQueueRows('cbct', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
    });
    expect(rows).toHaveLength(1);
  });

  it('does not list CBCT from keyword text without matching codes', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'cbct1',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-03-01T10:00:00',
        reason: 'CBCT scan',
      },
    ];
    const procedureCodes = [{ id: '1', proccodeid: 701, adacode: '07011', descript: 'CBCT' }];
    const rows = buildQueueRows('cbct', appts, patientsById, 0, now, 'all', 'all', { procedureCodes });
    expect(rows).toHaveLength(0);
  });

  it('removes CBCT once matching code is posted in ledger', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'cbct1',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-03-01T10:00:00',
        reason: 'CBCT scan',
      },
    ];
    const procedureCodes = [{ id: '1', proccodeid: 701, adacode: '07011', descript: 'CBCT' }];
    const ledgerByPatientId = new Map([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 701,
            procdate: '2026-03-01T10:00:00',
            chartstatus: 102,
          },
        ],
      ],
    ]);
    const rows = buildQueueRows('cbct', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
    });
    expect(rows).toHaveLength(0);
  });

  it('lists night guard when ADA code appears on the appointment visit', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ng1',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-04-01T10:00:00',
        reason: '14611 impression',
      },
    ];
    const procedureCodes = [{ id: '1', proccodeid: 146, adacode: '14611', descript: 'Night guard' }];
    const rows = buildQueueRows('night_guard', appts, patientsById, 0, now, 'all', 'all', { procedureCodes });
    expect(rows).toHaveLength(1);
  });

  it('lists night guard from ledger codes on the visit date', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ng1',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-04-01T10:00:00',
        reason: 'Appliance delivery',
      },
    ];
    const procedureCodes = [{ id: '1', proccodeid: 146, adacode: '14611', descript: 'Night guard' }];
    const ledgerByPatientId = new Map([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 146,
            procdate: '2026-04-01T10:00:00',
            chartstatus: 105,
          },
        ],
      ],
    ]);
    const rows = buildQueueRows('night_guard', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
    });
    expect(rows).toHaveLength(1);
  });

  it('does not list night guard from keyword text without matching codes', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ng1',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-04-01T10:00:00',
        reason: 'Night guard impression',
      },
    ];
    const procedureCodes = [{ id: '1', proccodeid: 146, adacode: '14611', descript: 'Night guard' }];
    const rows = buildQueueRows('night_guard', appts, patientsById, 0, now, 'all', 'all', { procedureCodes });
    expect(rows).toHaveLength(0);
  });

  it('removes night guard once matching code is posted in ledger', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'ng1',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-04-01T10:00:00',
        reason: 'Night guard impression',
      },
    ];
    const procedureCodes = [{ id: '1', proccodeid: 146, adacode: '14611', descript: 'Night guard' }];
    const ledgerByPatientId = new Map([
      [
        1,
        [
          {
            id: 'l1',
            patid: 1,
            proccodeid: 146,
            procdate: '2026-04-02T10:00:00',
            chartstatus: 102,
          },
        ],
      ],
    ]);
    const rows = buildQueueRows('night_guard', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes,
      ledgerByPatientId,
    });
    expect(rows).toHaveLength(0);
  });
});

describe('new_patient_follow_up queue', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const patientsById = {
    '1': { id: '1', patient_id: 1, first_name: 'Pat', last_name: 'One', status: 1 },
  };
  const npProcedureCodes = [
    { id: 'np1', proccodeid: 1401, adacode: '01401', descript: 'Comprehensive oral evaluation' },
    { id: 'per1', proccodeid: 1101, adacode: '01101', descript: 'Periodic oral evaluation' },
  ];

  function ledgerForVisit(
    patid: number,
    proccodeid: number,
    procdate: string
  ): Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]> {
    return new Map([
      [
        patid,
        [
          {
            id: `l-${patid}-${procdate}`,
            patid,
            proccodeid,
            procdate,
            chartstatus: 105,
          },
        ],
      ],
    ]);
  }

  it('lists true new patient with comprehensive code and no prior visits', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'np1',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-05-01T10:00:00',
        reason: 'New patient comprehensive exam',
      },
    ];
    const rows = buildQueueRows('new_patient_follow_up', appts, patientsById, 0, now, 'all', 'w4plus', {
      procedureCodes: npProcedureCodes,
      ledgerByPatientId: ledgerForVisit(1, 1401, '2026-05-01T10:00:00'),
    });
    expect(rows).toHaveLength(1);
  });

  it('excludes established patients with prior visit history', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'old',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2020-03-01T10:00:00',
        reason: '4M prophy',
      },
      {
        id: 'recent',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-05-01T10:00:00',
        reason: 'New patient comprehensive exam',
      },
    ];
    const rows = buildQueueRows('new_patient_follow_up', appts, patientsById, 0, now, 'all', 'w4plus', {
      procedureCodes: npProcedureCodes,
      ledgerByPatientId: ledgerForVisit(1, 1401, '2026-05-01T10:00:00'),
    });
    expect(rows).toHaveLength(0);
  });

  it('does not list routine periodic exam visits for established patients', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'recent',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-05-01T10:00:00',
        reason: 'Periodic exam',
      },
    ];
    const rows = buildQueueRows('new_patient_follow_up', appts, patientsById, 0, now, 'all', 'w4plus', {
      procedureCodes: npProcedureCodes,
      ledgerByPatientId: ledgerForVisit(1, 1101, '2026-05-01T10:00:00'),
    });
    expect(rows).toHaveLength(0);
  });

  it('does not match generic exam text without new patient wording', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'recent',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-05-01T10:00:00',
        reason: 'Exam and cleaning',
      },
    ];
    const rows = buildQueueRows('new_patient_follow_up', appts, patientsById, 0, now, 'all', 'w4plus', {
      procedureCodes: npProcedureCodes,
    });
    expect(rows).toHaveLength(0);
  });
});

describe('emerg_follow_up queue', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const patientsById = {
    '1': { id: '1', patient_id: 1, first_name: 'Pat', last_name: 'One', status: 1 },
  };

  it('drops patients with any future appointment booked', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'past-emerg',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-05-01T10:00:00',
        reason: 'Emergency pain',
      },
      {
        id: 'future-hygiene',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-07-01T10:00:00',
        reason: '4M prophy',
      },
    ];

    const rows = buildQueueRows('emerg_follow_up', appts, patientsById, 0, now, 'all', 'all', {});
    expect(rows).toHaveLength(0);
  });

  it('keeps patients without a future appointment', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'past-emerg',
        patient_id: 1,
        patient_name: 'Pat One',
        appointment_date: '2026-05-01T10:00:00',
        reason: 'Emergency pain',
      },
    ];

    const rows = buildQueueRows('emerg_follow_up', appts, patientsById, 0, now, 'all', 'all', {});
    expect(rows).toHaveLength(1);
  });
});

describe('no shows past week queue', () => {
  const now = new Date('2026-06-24T12:00:00Z');
  const patientsById = {
    '100': { id: 'p100', patient_id: 100, first_name: 'Joshi', last_name: 'Patient', status: 1 },
    '101': { id: 'p101', patient_id: 101, first_name: 'Renuka', last_name: 'Patient', status: 1 },
  };
  const noShowProcedureCodes = [{ id: 'nc20', proccodeid: 9020, adacode: 'NC000020', descript: 'No show' }];

  it('lists Joshi and Renuka from ledger no-show codes on June 20 without marking rebooked', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'joshi-appt',
        patient_id: 100,
        patient_name: 'Joshi Patient',
        appointment_date: '2026-06-20T14:00:00Z',
        reason: 'Cleaning',
        status_id: 1,
      },
      {
        id: 'renuka-appt',
        patient_id: 101,
        patient_name: 'Renuka Patient',
        appointment_date: '2026-06-20T10:00:00Z',
        reason: 'Exam',
        status_id: 1,
      },
    ];
    const ledgerByPatientId = new Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]>([
      [
        100,
        [
          {
            id: 'l-joshi',
            patid: 100,
            proccodeid: 9020,
            procdate: '2026-06-20T14:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
      [
        101,
        [
          {
            id: 'l-renuka',
            patid: 101,
            proccodeid: 9020,
            procdate: '2026-06-20T10:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
    ]);

    const rows = buildQueueRows('no_shows_past_week', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes: noShowProcedureCodes,
      ledgerByPatientId,
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.patientName)).toEqual(expect.arrayContaining(['Joshi Patient', 'Renuka Patient']));
    expect(rows.every((r) => r.rebooked === false)).toBe(true);
  });

  it('does not list appointments without ledger no-show codes', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'false-positive',
        patient_id: 100,
        patient_name: 'Joshi Patient',
        appointment_date: '2026-06-20T14:00:00Z',
        reason: 'no show',
        status_id: 3,
      },
    ];

    const rows = buildQueueRows('no_shows_past_week', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes: noShowProcedureCodes,
      ledgerByPatientId: new Map(),
    });

    expect(rows).toHaveLength(0);
  });

  it('marks rebooked only when an active future appointment exists after the no-show', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'past-no-show',
        patient_id: 100,
        patient_name: 'Joshi Patient',
        appointment_date: '2026-06-20T14:00:00Z',
        reason: 'Cleaning',
        status_id: 1,
      },
      {
        id: 'cancelled-future',
        patient_id: 100,
        patient_name: 'Joshi Patient',
        appointment_date: '2026-06-28T10:00:00Z',
        reason: 'cancelled',
        status_id: 3,
      },
      {
        id: 'active-future',
        patient_id: 101,
        patient_name: 'Renuka Patient',
        appointment_date: '2026-06-20T10:00:00Z',
        reason: 'Exam',
        status_id: 1,
      },
      {
        id: 'renuka-rebook',
        patient_id: 101,
        patient_name: 'Renuka Patient',
        appointment_date: '2026-06-28T11:00:00Z',
        reason: 'Follow-up',
        status_id: 1,
      },
    ];
    const ledgerByPatientId = new Map<number, import('./ledgerTransactions').DentrixLedgerTransactionDoc[]>([
      [
        100,
        [
          {
            id: 'l-joshi',
            patid: 100,
            proccodeid: 9020,
            procdate: '2026-06-20T14:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
      [
        101,
        [
          {
            id: 'l-renuka',
            patid: 101,
            proccodeid: 9020,
            procdate: '2026-06-20T10:00:00Z',
            chartstatus: 102,
          },
        ],
      ],
    ]);

    const rows = buildQueueRows('no_shows_past_week', appts, patientsById, 0, now, 'all', 'all', {
      procedureCodes: noShowProcedureCodes,
      ledgerByPatientId,
    });

    const joshi = rows.find((r) => r.patientId === '100');
    const renuka = rows.find((r) => r.patientId === '101');
    expect(joshi?.rebooked).toBe(false);
    expect(renuka?.rebooked).toBe(true);
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
