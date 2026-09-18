import { describe, expect, it } from 'vitest';
import {
  buildLedgerEstimateSeeds,
  CHART_TREATMENT_PLANNED,
  mergeLedgerAndDocumentWorkItems,
} from './estimateDiscovery';
import type { DentrixLedgerTransactionDoc } from './ledgerTransactions';
import type { DocumentEstimateWorkItem } from './documentEstimates';

describe('buildLedgerEstimateSeeds', () => {
  const adaByProccodeId = new Map<number, string>([
    [424, '23312'],
    [3423, '07012'],
    [12, '01202'],
  ]);

  it('keeps treatment-planned lines in estimate ranges and joins ADA via proccodeid', () => {
    const rows: DentrixLedgerTransactionDoc[] = [
      {
        id: '1',
        patid: 7740,
        proccodeid: 424,
        chartstatus: CHART_TREATMENT_PLANNED,
        preauthid: 82253,
        procdate: '2026-09-15T04:00:00Z',
      },
      {
        id: '2',
        patid: 7740,
        proccodeid: 12,
        chartstatus: CHART_TREATMENT_PLANNED,
        preauthid: 0,
        procdate: '2026-09-15T04:00:00Z',
      },
      {
        id: '3',
        patid: 539,
        proccodeid: 3423,
        chartstatus: CHART_TREATMENT_PLANNED,
        preauthid: 0,
        procdate: '2026-08-31T04:00:00Z',
      },
    ];

    const seeds = buildLedgerEstimateSeeds(rows, adaByProccodeId);
    expect(seeds.some((s) => s.patientId === '7740' && s.codeTypeGroupId === 'resto')).toBe(true);
    expect(seeds.some((s) => s.patientId === '539' && s.codeTypeGroupId === 'cbct')).toBe(true);
    expect(seeds.every((s) => !s.procedureCodes.includes('01202'))).toBe(true);
  });
});

describe('mergeLedgerAndDocumentWorkItems', () => {
  it('uses docs for status and keeps ledger-only preauth rows', () => {
    const seeds = [
      {
        patientId: '100',
        codeTypeGroupId: 'crown',
        codeTypeLabel: 'Crown',
        procedureCodes: ['27211'],
        preauthId: 9001,
        latestProcDate: '2026-09-01',
        lineCount: 1,
      },
    ];
    const documentItems: DocumentEstimateWorkItem[] = [
      {
        docFirestoreId: 'd1',
        docId: 55,
        patientId: '200',
        patientGuid: null,
        patientName: 'Doc Only',
        descript: 'Pre-Determination Acknowledgement',
        createdate: '2026-09-02',
        createdLabel: '2026-09-02',
        workflowStatus: 'needs_follow_up',
        followUpDocId: 'doc-55',
      },
    ];
    const documentsByPatientId = new Map([
      [
        '100',
        [
          {
            id: 'x',
            docid: 10,
            descript: 'Predetermination Explanation of Benefits',
            createdate: '2026-09-03',
          },
        ],
      ],
    ]);

    const merged = mergeLedgerAndDocumentWorkItems({
      ledgerSeeds: seeds,
      documentItems,
      documentsByPatientId: documentsByPatientId as never,
      patientsById: {},
    });

    expect(merged.some((r) => r.patientId === '100' && r.workflowStatus === 'covered_eob')).toBe(true);
    expect(merged.some((r) => r.patientId === '200' && r.followUpDocId === 'doc-55')).toBe(true);
  });
});
