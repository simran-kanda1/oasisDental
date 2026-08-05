import { describe, expect, it } from 'vitest';
import {
  applyLedgerCoverageToContext,
  coveragePercentFromLedgerAmounts,
  isEstimateFullyCovered,
  isTrackedTreatmentCompleted,
  resolveTreatmentDate,
} from './estimateTreatment';
import type { DocumentProcedureContext } from './procedureCodeTypes';
import type { DentrixLedgerTransactionDoc } from './ledgerTransactions';

const crownCtx: DocumentProcedureContext = {
  procedureCodes: [{ code: '27201', description: 'Crown' }],
  codeTypes: [],
  primaryCodeType: null,
  insurancePlanId: null,
};

describe('coveragePercentFromLedgerAmounts', () => {
  it('returns null when fee or insurance has not posted', () => {
    expect(coveragePercentFromLedgerAmounts(907, 0, 0)).toBeNull();
    expect(coveragePercentFromLedgerAmounts(0, 100, 0)).toBeNull();
  });

  it('uses primary plus secondary insurance against the fee', () => {
    expect(coveragePercentFromLedgerAmounts(200, 100, 100)).toBe(100);
    expect(coveragePercentFromLedgerAmounts(200, 80, 20)).toBe(50);
  });
});

describe('isEstimateFullyCovered', () => {
  const adaByProccodeId = new Map<number, string>([
    [100, '27201'],
    [200, '23321'],
  ]);

  it('keeps rows with unknown ledger coverage on the list', () => {
    expect(isEstimateFullyCovered(crownCtx)).toBe(false);
    expect(
      isEstimateFullyCovered(crownCtx, [{ id: '1', patid: 1, proccodeid: 100, amt: 907, amtpriminspaid: 0 }], adaByProccodeId)
    ).toBe(false);
  });

  it('keeps rows that are only partially covered on the ledger', () => {
    const ledger: DentrixLedgerTransactionDoc[] = [
      { id: '1', patid: 1, proccodeid: 100, amt: 200, amtpriminspaid: 160, amtsecinspaid: 0, chartstatus: 102 },
    ];
    expect(isEstimateFullyCovered(crownCtx, ledger, adaByProccodeId)).toBe(false);
  });

  it('hides rows only when every tracked ledger procedure is 100% covered', () => {
    const ctx: DocumentProcedureContext = {
      ...crownCtx,
      procedureCodes: [
        { code: '27201', description: 'Crown' },
        { code: '23321', description: 'Composite' },
      ],
      codeTypes: [
        { groupId: 'crown', label: 'Crown' },
        { groupId: 'resto', label: 'Restorative' },
      ],
    };
    const ledger: DentrixLedgerTransactionDoc[] = [
      { id: '1', patid: 1, proccodeid: 100, amt: 907, amtpriminspaid: 907, amtsecinspaid: 0, chartstatus: 102 },
      { id: '2', patid: 1, proccodeid: 200, amt: 250, amtpriminspaid: 200, amtsecinspaid: 50, chartstatus: 102 },
    ];
    expect(isEstimateFullyCovered(ctx, ledger, adaByProccodeId)).toBe(true);
  });

  it('keeps mixed coverage rows visible', () => {
    const ctx: DocumentProcedureContext = {
      ...crownCtx,
      procedureCodes: [
        { code: '27201', description: 'Crown' },
        { code: '23321', description: 'Composite' },
      ],
    };
    const ledger: DentrixLedgerTransactionDoc[] = [
      { id: '1', patid: 1, proccodeid: 100, amt: 907, amtpriminspaid: 907, amtsecinspaid: 0, chartstatus: 102 },
      { id: '2', patid: 1, proccodeid: 200, amt: 250, amtpriminspaid: 125, amtsecinspaid: 0, chartstatus: 102 },
    ];
    expect(isEstimateFullyCovered(ctx, ledger, adaByProccodeId)).toBe(false);
  });

  it('prefers preauth-linked ledger lines over other history for the same code', () => {
    const ctx: DocumentProcedureContext = {
      ...crownCtx,
      preauthId: 9002,
    };
    const ledger: DentrixLedgerTransactionDoc[] = [
      {
        id: 'old',
        patid: 1,
        proccodeid: 100,
        amt: 800,
        amtpriminspaid: 400,
        preauthid: 111,
        chartstatus: 102,
      },
      {
        id: 'linked',
        patid: 1,
        proccodeid: 100,
        amt: 907,
        amtpriminspaid: 907,
        preauthid: 9002,
        chartstatus: 102,
      },
    ];
    expect(isEstimateFullyCovered(ctx, ledger, adaByProccodeId)).toBe(true);
  });

  it('falls back to code-type percent only when no procedure codes are linked', () => {
    expect(
      isEstimateFullyCovered({
        procedureCodes: [],
        codeTypes: [{ groupId: 'crown', label: 'Crown', percentCov: 100 }],
        primaryCodeType: { groupId: 'crown', label: 'Crown', percentCov: 100 },
        insurancePlanId: null,
      })
    ).toBe(true);
  });
});

describe('applyLedgerCoverageToContext', () => {
  it('copies ledger insurance amounts onto code types for display', () => {
    const adaByProccodeId = new Map<number, string>([[100, '27201']]);
    const ctx: DocumentProcedureContext = {
      ...crownCtx,
      codeTypes: [{ groupId: 'crown', label: 'Crown', percentCov: 0 }],
      primaryCodeType: { groupId: 'crown', label: 'Crown', percentCov: 0 },
    };
    const next = applyLedgerCoverageToContext(
      ctx,
      [{ id: '1', patid: 1, proccodeid: 100, amt: 200, amtpriminspaid: 160, amtsecinspaid: 0 }],
      adaByProccodeId
    );
    expect(next.primaryCodeType?.percentCov).toBe(80);
    expect(next.procedureCodes[0]?.primaryInsurancePortion).toBe(160);
    expect(next.procedureCodes[0]?.chargeAmount).toBe(200);
  });
});

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

describe('resolveTreatmentDate', () => {
  const adaByProccodeId = new Map<number, string>([[100, '27201'], [200, '11101']]);

  it('uses document date when link is from parsed document text only', () => {
    const ctx: DocumentProcedureContext = {
      ...crownCtx,
      linkSource: 'document_text',
    };
    const ledger: DentrixLedgerTransactionDoc[] = [
      {
        id: 'cleaning',
        patid: 1,
        proccodeid: 200,
        chartstatus: 102,
        procdate: '2026-06-08T00:00:00',
      },
    ];

    const result = resolveTreatmentDate(
      ctx,
      '2026-03-15T00:00:00',
      'crown',
      ledger,
      adaByProccodeId
    );

    expect(result.source).toBe('document');
    expect(result.label).toContain('2026-03-15');
  });

  it('uses ledger date for strong preauth link on matching codes only', () => {
    const ctx: DocumentProcedureContext = {
      ...crownCtx,
      linkSource: 'ledger_preauth',
      preauthId: 9002,
    };
    const ledger: DentrixLedgerTransactionDoc[] = [
      {
        id: 'cleaning',
        patid: 1,
        proccodeid: 200,
        preauthid: 9001,
        chartstatus: 102,
        procdate: '2026-06-08T00:00:00',
      },
      {
        id: 'crown',
        patid: 1,
        proccodeid: 100,
        preauthid: 9002,
        chartstatus: 105,
        procdate: '2026-05-20T00:00:00',
      },
    ];

    const result = resolveTreatmentDate(
      ctx,
      '2026-03-15T00:00:00',
      'crown',
      ledger,
      adaByProccodeId
    );

    expect(result.source).toBe('ledger');
    expect(result.label).toContain('2026-05-20');
  });
});
