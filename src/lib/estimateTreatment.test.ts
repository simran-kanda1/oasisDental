import { describe, expect, it } from 'vitest';
import {
  isTrackedTreatmentCompleted,
  resolveTreatmentDate,
  shouldHideEstimateOnLedgerComplete,
} from './estimateTreatment';
import type { DocumentProcedureContext } from './procedureCodeTypes';
import type { DentrixLedgerTransactionDoc } from './ledgerTransactions';

const crownCtx: DocumentProcedureContext = {
  procedureCodes: [{ code: '27201', description: 'Crown' }],
  codeTypes: [],
  primaryCodeType: null,
  insurancePlanId: null,
};

const preauthLedgerCtx: DocumentProcedureContext = {
  ...crownCtx,
  linkSource: 'ledger_preauth',
  preauthId: 12345,
};

describe('shouldHideEstimateOnLedgerComplete', () => {
  it('keeps pre-auth ledger links on the list', () => {
    expect(shouldHideEstimateOnLedgerComplete(preauthLedgerCtx, 'ledger')).toBe(false);
  });

  it('keeps predetermination acknowledgement documents without preauth code type', () => {
    expect(
      shouldHideEstimateOnLedgerComplete(crownCtx, 'ledger', { documentStatus: 'needs_follow_up' })
    ).toBe(false);
  });

  it('closes preauth rows when treatment date is from ledger', () => {
    expect(
      shouldHideEstimateOnLedgerComplete(
        {
          ...crownCtx,
          primaryCodeType: { groupId: 'crown', label: 'Crown', requiresPreauth: true },
          codeTypes: [{ groupId: 'crown', label: 'Crown', requiresPreauth: true }],
        },
        'ledger',
        { documentStatus: 'needs_follow_up' }
      )
    ).toBe(true);
  });

  it('removes generic from-ledger rows when complete', () => {
    expect(shouldHideEstimateOnLedgerComplete(crownCtx, 'ledger')).toBe(true);
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
