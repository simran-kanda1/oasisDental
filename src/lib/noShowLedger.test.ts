import { describe, expect, it } from 'vitest';
import {
  isNoShowLedgerAdaCode,
  ledgerRowIndicatesNoShow,
  NO_SHOW_LEDGER_ADA_CODES,
} from './noShowLedger';
import type { DentrixLedgerTransactionDoc } from './ledgerTransactions';

describe('noShowLedger', () => {
  it('recognizes NC no-show ADA codes', () => {
    for (const code of NO_SHOW_LEDGER_ADA_CODES) {
      expect(isNoShowLedgerAdaCode(code)).toBe(true);
    }
    expect(isNoShowLedgerAdaCode('nc000021')).toBe(true);
    expect(isNoShowLedgerAdaCode('23311')).toBe(false);
  });

  it('detects no-show from ledger proccodeid mapping', () => {
    const adaByProccodeId = new Map<number, string>([[9020, 'NC000020']]);
    const row: DentrixLedgerTransactionDoc = {
      id: 'l1',
      patid: 1,
      proccodeid: 9020,
      procdate: '2026-06-20T10:00:00Z',
      chartstatus: 102,
    };
    expect(ledgerRowIndicatesNoShow(row, adaByProccodeId)).toBe(true);
  });
});
