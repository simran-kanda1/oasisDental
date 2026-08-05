import type { DentrixLedgerTransactionDoc } from './ledgerTransactions';
import { normalizeProcedureCode } from './procedureCodeTypes';

/** Dentrix ledger ADA codes that indicate a missed / no-show / oasis-cancelled appointment. */
export const NO_SHOW_LEDGER_ADA_CODES = ['NC000020', 'NC000021', 'NC000022', 'NC000027'] as const;

const NO_SHOW_LEDGER_CODE_SET = new Set<string>(NO_SHOW_LEDGER_ADA_CODES);

export function isNoShowLedgerAdaCode(code: string | undefined | null): boolean {
  const normalized = normalizeProcedureCode(code);
  return normalized ? NO_SHOW_LEDGER_CODE_SET.has(normalized) : false;
}

export function resolveLedgerRowAdaCode(
  row: DentrixLedgerTransactionDoc,
  adaByProccodeId: Map<number, string>
): string | undefined {
  const fromMap = adaByProccodeId.get(Number(row.proccodeid));
  if (fromMap) return fromMap;
  const fromRow = normalizeProcedureCode((row as DentrixLedgerTransactionDoc & { adacode?: string }).adacode);
  return fromRow || undefined;
}

export function ledgerRowIndicatesNoShow(
  row: DentrixLedgerTransactionDoc,
  adaByProccodeId: Map<number, string>
): boolean {
  if (isNoShowLedgerAdaCode(resolveLedgerRowAdaCode(row, adaByProccodeId))) return true;
  const extra = row as DentrixLedgerTransactionDoc & {
    descript?: string;
    description?: string;
    note?: string;
    notes?: string;
  };
  const text = [extra.descript, extra.description, extra.note, extra.notes, extra.adacode]
    .filter(Boolean)
    .join(' ');
  return /\b(no[\s-]?show|oasis[\s-]?cancel(?:led|ed)?)\b/i.test(text);
}
