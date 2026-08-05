import { describe, expect, it } from 'vitest';
import { resolveEstimateSentVisit } from './estimateSent';

const adaByProccodeId = new Map<number, string>([[100, '27201']]);

describe('resolveEstimateSentVisit', () => {
  it('uses the appointment date and time that matches the related ledger visit', () => {
    const result = resolveEstimateSentVisit({
      documentDate: '2026-06-20T15:00:00Z',
      procedureCodes: ['27201'],
      preauthId: 9002,
      ledgerRows: [
        {
          id: 'crown',
          patid: 1,
          proccodeid: 100,
          chartstatus: 105,
          preauthid: 9002,
          procdate: '2026-06-08T04:00:00Z',
          amt: 907,
          amtpriminspaid: 0,
        },
      ],
      appointments: [
        {
          id: 'a1',
          patient_id: 1,
          appointment_date: '2026-06-08T04:00:00Z',
          start_hour: 14,
          start_minute: 30,
        },
        {
          id: 'a2',
          patient_id: 1,
          appointment_date: '2026-05-01T04:00:00Z',
          start_hour: 9,
          start_minute: 0,
        },
      ],
      adaByProccodeId,
    });

    expect(result).toEqual({
      label: '2026-06-08 · 2:30 PM',
      source: 'appointment',
    });
  });

  it('falls back to ledger procdate when no appointment matches', () => {
    const result = resolveEstimateSentVisit({
      documentDate: '2026-06-20T15:00:00Z',
      procedureCodes: ['27201'],
      ledgerRows: [
        {
          id: 'crown',
          patid: 1,
          proccodeid: 100,
          chartstatus: 105,
          procdate: '2026-06-08T04:00:00Z',
        },
      ],
      appointments: [],
      adaByProccodeId,
    });

    expect(result).toEqual({ label: '2026-06-08', source: 'ledger' });
  });

  it('uses the document date when the document itself proves an estimate went out', () => {
    const result = resolveEstimateSentVisit({
      documentDate: '2026-06-20T15:00:00Z',
      procedureCodes: [],
      ledgerRows: [],
      appointments: [],
      adaByProccodeId,
    });

    expect(result).toEqual({ label: '2026-06-20', source: 'document' });
  });
});
