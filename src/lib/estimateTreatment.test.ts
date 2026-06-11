import { describe, expect, it } from 'vitest';
import { isTrackedTreatmentCompleted } from './estimateTreatment';
import type { DocumentProcedureContext } from './procedureCodeTypes';
import type { DentrixLedgerTransactionDoc } from './ledgerTransactions';

const crownCtx: DocumentProcedureContext = {
  procedureCodes: [{ code: '27201', description: 'Crown' }],
  codeTypes: [],
  primaryCodeType: null,
  insurancePlanId: null,
};

describe('isTrackedTreatmentCompleted', () => {
  const adaByProccodeId = new Map<number, string>([[100, '27201']]);

  it('ignores ledger completion before the document date', () => {
    const ledger: DentrixLedgerTransactionDoc[] = [
      {
        id: '1',
        patid: 1,
        proccodeid: 100,
        chartstatus: 102,
        procdate: '2024-01-15T00:00:00',
      },
    ];
    const documentDate = new Date('2026-05-01T12:00:00Z');
    expect(
      isTrackedTreatmentCompleted(crownCtx, 'crown', ledger, adaByProccodeId, documentDate)
    ).toBe(false);
  });

  it('detects completion on or after the document date', () => {
    const ledger: DentrixLedgerTransactionDoc[] = [
      {
        id: '2',
        patid: 1,
        proccodeid: 100,
        chartstatus: 102,
        procdate: '2026-05-10T00:00:00',
      },
    ];
    const documentDate = new Date('2026-05-01T12:00:00Z');
    expect(
      isTrackedTreatmentCompleted(crownCtx, 'crown', ledger, adaByProccodeId, documentDate)
    ).toBe(true);
  });
});
