import type { DentrixAppointmentDoc } from './dentrix';
import { parseDentrixDate } from './dentrix';
import {
  buildProcedureCodeByAdaMap,
  extractProcedureCodesFromText,
  isProcedureCodeInRange,
  normalizeProcedureCode,
  type DentrixProcedureCodeDoc,
} from './procedureCodeTypes';
import type { DentrixLedgerTransactionDoc } from './ledgerTransactions';
import { appointmentLabelText } from './appointmentHeuristics';
import { isSameDay, startOfDay, subDays, addDays } from 'date-fns';

const CHART_COMPLETED = 102;

/** A single inclusive code range or explicit code list entry. */
export type QueueCodeRule =
  | { type: 'range'; begin: string; end: string }
  | { type: 'codes'; codes: string[] };

export interface QueueProcedureConfig {
  queueId: string;
  codeRules: QueueCodeRule[];
}

export const QUEUE_PROCEDURE_CONFIGS: QueueProcedureConfig[] = [
  { queueId: 'hygiene_cc', codeRules: [{ type: 'range', begin: '11101', end: '13599' }] },
  { queueId: 'ortho_follow_ups', codeRules: [{ type: 'range', begin: '80000', end: '89999' }] },
  { queueId: 'cbct', codeRules: [{ type: 'range', begin: '07000', end: '07043' }] },
  { queueId: 'fillings', codeRules: [{ type: 'range', begin: '23111', end: '23515' }] },
  { queueId: 'root_canal', codeRules: [{ type: 'range', begin: '30000', end: '39999' }] },
  { queueId: 'perio', codeRules: [{ type: 'range', begin: '40000', end: '49999' }] },
  { queueId: 'implants', codeRules: [{ type: 'range', begin: '79000', end: 'AOX-SXG' }] },
  {
    queueId: 'bone_grafting',
    codeRules: [
      { type: 'range', begin: '42611', end: '42703' },
      { type: 'codes', codes: ['74401'] },
    ],
  },
  { queueId: 'gum_grafting', codeRules: [{ type: 'range', begin: '42511', end: '42592' }] },
  { queueId: 'extraction', codeRules: [{ type: 'range', begin: '71101', end: '72331' }] },
  {
    queueId: 'ga_all_appointments',
    codeRules: [
      { type: 'range', begin: '92222', end: '92229' },
      { type: 'range', begin: '92232', end: '92239' },
    ],
  },
  {
    queueId: 'night_guard',
    codeRules: [
      { type: 'range', begin: '14611', end: '14623' },
      { type: 'range', begin: '14811', end: '14832' },
    ],
  },
  {
    queueId: 'periodontal_surgery',
    codeRules: [
      { type: 'range', begin: '42111', end: '42481' },
      { type: 'codes', codes: ['42811', '42819'] },
    ],
  },
  {
    queueId: 'tmj_mri',
    codeRules: [
      { type: 'range', begin: 'M0000020', end: 'M0000026' },
      { type: 'range', begin: 'IM0000020', end: 'IM0000026' },
    ],
  },
  { queueId: 'new_patient_follow_up', codeRules: [{ type: 'range', begin: '01101', end: '02601' }] },
];

const CONFIG_BY_QUEUE = new Map(QUEUE_PROCEDURE_CONFIGS.map((c) => [c.queueId, c]));

export function getQueueProcedureConfig(queueId: string): QueueProcedureConfig | undefined {
  return CONFIG_BY_QUEUE.get(queueId);
}

/** Human-readable ADA code ranges for queue UI (e.g. "23111–23515; 74401"). */
export function formatQueueCodeRules(config: QueueProcedureConfig): string {
  return config.codeRules
    .map((rule) => {
      if (rule.type === 'range') return `${rule.begin}–${rule.end}`;
      return rule.codes.join(', ');
    })
    .join('; ');
}

export function getQueueCodeRulesLabel(queueId: string): string | null {
  const config = getQueueProcedureConfig(queueId);
  return config ? formatQueueCodeRules(config) : null;
}

export function codeMatchesQueueRule(code: string, rule: QueueCodeRule): boolean {
  const normalized = normalizeProcedureCode(code);
  if (!normalized) return false;
  if (rule.type === 'range') return isProcedureCodeInRange(normalized, rule.begin, rule.end);
  return rule.codes.some((c) => normalizeProcedureCode(c) === normalized);
}

export function codeMatchesQueueConfig(code: string, config: QueueProcedureConfig): boolean {
  return config.codeRules.some((rule) => codeMatchesQueueRule(code, rule));
}

export function anyCodeMatchesQueue(codes: string[], queueId: string): boolean {
  const config = getQueueProcedureConfig(queueId);
  if (!config || !codes.length) return false;
  return codes.some((code) => codeMatchesQueueConfig(code, config));
}

export function buildAdaByProccodeId(procedureCodes: DentrixProcedureCodeDoc[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of procedureCodes) {
    const id = Number(row.proccodeid);
    const ada = normalizeProcedureCode(row.adacode);
    if (Number.isFinite(id) && ada) map.set(id, ada);
  }
  return map;
}

export interface ProcedureCodeLookupCache {
  adaIndex: ReturnType<typeof buildProcedureCodeByAdaMap>;
  adaByProccodeId: Map<number, string>;
}

/** ADA codes from appointment text + ledger rows on the appointment date (±1 day). */
export function getAppointmentProcedureCodes(
  appt: DentrixAppointmentDoc,
  ledgerRows: DentrixLedgerTransactionDoc[],
  procedureCodes: DentrixProcedureCodeDoc[],
  cache?: ProcedureCodeLookupCache
): string[] {
  const adaIndex = cache?.adaIndex ?? buildProcedureCodeByAdaMap(procedureCodes);
  const adaByProccodeId = cache?.adaByProccodeId ?? buildAdaByProccodeId(procedureCodes);
  const label = appointmentLabelText(appt);
  const fromText = extractProcedureCodesFromText(label, adaIndex);

  const apptDate = parseDentrixDate(appt.appointment_date);
  const patid = Number(appt.patient_id);
  const fromLedger: string[] = [];

  if (apptDate && Number.isFinite(patid)) {
    const dayStart = startOfDay(apptDate);
    const windowStart = subDays(dayStart, 1);
    const windowEnd = addDays(dayStart, 1);

    for (const row of ledgerRows) {
      if (Number(row.patid) !== patid) continue;
      const procDate = parseDentrixDate(row.procdate ?? row.entrydate);
      if (!procDate) continue;
      const pd = startOfDay(procDate);
      if (pd < windowStart || pd > windowEnd) continue;
      const ada = adaByProccodeId.get(Number(row.proccodeid));
      if (ada) fromLedger.push(ada);
    }
  }

  return [...new Set([...fromText, ...fromLedger])].sort();
}

/** Completed (posted) ledger ADA codes on the appointment date (±1 day). */
export function getCompletedLedgerCodesOnAppointment(
  appt: DentrixAppointmentDoc,
  ledgerRows: DentrixLedgerTransactionDoc[],
  adaByProccodeId: Map<number, string>
): string[] {
  const apptDate = parseDentrixDate(appt.appointment_date);
  const patid = Number(appt.patient_id);
  if (!apptDate || !Number.isFinite(patid)) return [];

  const dayStart = startOfDay(apptDate);
  const windowStart = subDays(dayStart, 1);
  const windowEnd = addDays(dayStart, 1);
  const codes: string[] = [];

  for (const row of ledgerRows) {
    if (Number(row.patid) !== patid) continue;
    if (Number(row.chartstatus) !== CHART_COMPLETED) continue;
    const procDate = parseDentrixDate(row.procdate ?? row.entrydate);
    if (!procDate) continue;
    const pd = startOfDay(procDate);
    if (pd < windowStart || pd > windowEnd) continue;
    const ada = adaByProccodeId.get(Number(row.proccodeid));
    if (ada) codes.push(ada);
  }

  return [...new Set(codes)].sort();
}

export function ledgerCodesOnAppointmentDate(
  appt: DentrixAppointmentDoc,
  ledgerRows: DentrixLedgerTransactionDoc[],
  adaByProccodeId: Map<number, string>
): string[] {
  const apptDate = parseDentrixDate(appt.appointment_date);
  const patid = Number(appt.patient_id);
  if (!apptDate || !Number.isFinite(patid)) return [];

  const codes: string[] = [];
  for (const row of ledgerRows) {
    if (Number(row.patid) !== patid) continue;
    const procDate = parseDentrixDate(row.procdate ?? row.entrydate);
    if (!procDate || !isSameDay(procDate, apptDate)) continue;
    const ada = adaByProccodeId.get(Number(row.proccodeid));
    if (ada) codes.push(ada);
  }
  return [...new Set(codes)];
}
