import { describe, expect, it } from 'vitest';
import { resolveLedgerProceduresForDocument } from './ledgerTransactions';

const adaByProccodeId = new Map<number, string>([
  [100, '27201'],
  [200, '11101'],
]);

function ledgerRow(partial: Record<string, unknown>) {
  return {
    id: String(partial.id ?? '1'),
    patid: 1,
    ...partial,
  };
}

describe('resolveLedgerProceduresForDocument', () => {
  it('does not link by nearest preauth date when document has no procedure hints', () => {
    const rows = [
      ledgerRow({
        id: 'cleaning',
        proccodeid: 200,
        preauthid: 9001,
        claimid: 8001,
        chartstatus: 102,
        procdate: '2026-06-08T00:00:00',
      }),
      ledgerRow({
        id: 'crown',
        proccodeid: 100,
        preauthid: 9002,
        claimid: 8002,
        chartstatus: 105,
        procdate: '2026-01-10T00:00:00',
      }),
    ];

    const result = resolveLedgerProceduresForDocument({
      patientId: '1',
      documentDescript: 'Predetermination Explanation of Benefits',
      documentDate: '2026-06-08T00:00:00',
      ledgerRows: rows,
      hintCodes: [],
      adaByProccodeId,
    });

    expect(result.matchReason).not.toBe('date_window');
    expect(result.lines.map((l) => l.proccodeid)).not.toContain(200);
  });

  it('links via document hint codes to the matching preauth group', () => {
    const rows = [
      ledgerRow({
        id: 'cleaning',
        proccodeid: 200,
        preauthid: 9001,
        claimid: 8001,
        chartstatus: 102,
        procdate: '2026-06-08T00:00:00',
      }),
      ledgerRow({
        id: 'crown',
        proccodeid: 100,
        preauthid: 9002,
        claimid: 8002,
        chartstatus: 105,
        procdate: '2026-01-10T00:00:00',
      }),
    ];

    const result = resolveLedgerProceduresForDocument({
      patientId: '1',
      documentDescript: 'EOB 27201 crown',
      documentDate: '2026-06-08T00:00:00',
      ledgerRows: rows,
      hintCodes: ['27201'],
      adaByProccodeId,
    });

    expect(result.matchReason).toBe('hint_code');
    expect(result.lines.some((l) => l.proccodeid === 100)).toBe(true);
    expect(result.lines.some((l) => l.proccodeid === 200)).toBe(false);
  });
});
