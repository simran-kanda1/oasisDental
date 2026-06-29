import { describe, expect, it } from 'vitest';
import { buildQueueRowCount, buildQueueRows } from '../data/queueRules';
import type { DentrixAppointmentDoc } from './dentrix';

describe('buildQueueRowCount', () => {
  const now = new Date('2026-06-24T12:00:00Z');
  const patientsById = {
    '1': { id: 'p1', patient_id: 1, first_name: 'Test', last_name: 'Patient', status: 1 },
  };
  const hygieneProcedureCodes = [{ id: 'h1', proccodeid: 111, adacode: '11101', descript: 'Prophy' }];

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
            id: `l-${patid}`,
            patid,
            proccodeid,
            procdate,
            chartstatus: 105,
          },
        ],
      ],
    ]);
  }

  it('matches buildQueueRows length for hygiene CC', () => {
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
    const ctx = {
      procedureCodes: hygieneProcedureCodes,
      ledgerByPatientId: ledgerForVisit(1, 111, '2026-01-01T10:00:00Z'),
    };
    const rows = buildQueueRows('hygiene_cc', appts, patientsById, 0, now, 'all', 'all', ctx);
    const count = buildQueueRowCount('hygiene_cc', appts, patientsById, now, 'all', 'all', ctx);
    expect(count).toBe(rows.length);
  });

  it('matches buildQueueRows length for emerg follow-up', () => {
    const appts: DentrixAppointmentDoc[] = [
      {
        id: 'a1',
        patient_id: 1,
        patient_name: 'Test Patient',
        appointment_date: '2026-06-01T10:00:00Z',
        reason: 'emergency pain',
      },
    ];
    const rows = buildQueueRows('emerg_follow_up', appts, patientsById, 0, now, 'all', 'all', {});
    const count = buildQueueRowCount('emerg_follow_up', appts, patientsById, now, 'all', 'all', {});
    expect(count).toBe(rows.length);
  });
});
