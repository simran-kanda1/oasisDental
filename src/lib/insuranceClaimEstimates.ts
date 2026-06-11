import { cleanDentrixText } from './dentrix';
import { normalizeProcedureCode } from './procedureCodeTypes';

/**
 * Dentrix Ascend/API-style insurance claims (when synced to Firestore).
 * Filter isPredetermination === true for pre-treatment estimates per Dentrix support.
 */
export interface InsuranceClaimProcedureLine {
  procedureId?: string | number;
  id?: string | number;
  proccodeid?: number;
  adacode?: string;
  primaryInsurancePortion?: number;
  writeOff?: number;
  primary_insurance_portion?: number;
  write_off?: number;
  practiceProcedure?: {
    id?: number;
    adacode?: string;
    code?: string;
    description?: string;
    descript?: string;
  };
}

export interface DentrixInsuranceClaimDoc {
  id: string;
  isPredetermination?: boolean;
  is_predetermination?: boolean;
  patientId?: number;
  patient_id?: number;
  patid?: number;
  claimId?: number;
  claim_id?: number;
  preauthid?: number;
  preauth_id?: number;
  procedures?: InsuranceClaimProcedureLine[];
  data?: {
    procedures?: InsuranceClaimProcedureLine[];
  };
}

export function isPredeterminationClaim(claim: DentrixInsuranceClaimDoc): boolean {
  return claim.isPredetermination === true || claim.is_predetermination === true;
}

export function claimPatientId(claim: DentrixInsuranceClaimDoc): number | null {
  const id = Number(claim.patientId ?? claim.patient_id ?? claim.patid);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function claimNumericId(claim: DentrixInsuranceClaimDoc): number | null {
  const id = Number(claim.claimId ?? claim.claim_id ?? claim.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function claimProcedures(claim: DentrixInsuranceClaimDoc): InsuranceClaimProcedureLine[] {
  return claim.procedures ?? claim.data?.procedures ?? [];
}

export function buildClaimsByPatientId(
  claims: DentrixInsuranceClaimDoc[]
): Map<number, DentrixInsuranceClaimDoc[]> {
  const map = new Map<number, DentrixInsuranceClaimDoc[]>();
  for (const claim of claims) {
    if (!isPredeterminationClaim(claim)) continue;
    const pid = claimPatientId(claim);
    if (!pid) continue;
    const list = map.get(pid) ?? [];
    list.push(claim);
    map.set(pid, list);
  }
  return map;
}

export interface ResolvedClaimProcedure {
  proccodeid: number | null;
  adacode: string | null;
  primaryInsurancePortion: number | null;
  writeOff: number | null;
}

export function resolveClaimProcedureLines(
  claim: DentrixInsuranceClaimDoc
): ResolvedClaimProcedure[] {
  return claimProcedures(claim).map((p) => {
    const practice = p.practiceProcedure;
    const proccodeid = Number(p.proccodeid ?? practice?.id);
    const adacode = normalizeProcedureCode(p.adacode ?? practice?.adacode ?? practice?.code);
    return {
      proccodeid: Number.isFinite(proccodeid) && proccodeid > 0 ? proccodeid : null,
      adacode: adacode || null,
      primaryInsurancePortion:
        p.primaryInsurancePortion ?? p.primary_insurance_portion ?? null,
      writeOff: p.writeOff ?? p.write_off ?? null,
    };
  });
}

function claimAdaCodes(claim: DentrixInsuranceClaimDoc): Set<string> {
  const codes = new Set<string>();
  for (const line of resolveClaimProcedureLines(claim)) {
    if (line.adacode) codes.add(line.adacode);
  }
  return codes;
}

function scoreClaimByHintCodes(claim: DentrixInsuranceClaimDoc, hintCodes: string[]): number {
  if (!hintCodes.length) return 0;
  const claimCodes = claimAdaCodes(claim);
  return hintCodes.filter((c) => claimCodes.has(normalizeProcedureCode(c))).length;
}

export function findClaimForDocument(options: {
  patientId: string;
  descript: string;
  claimsForPatient: DentrixInsuranceClaimDoc[];
  idCandidates: number[];
  hintCodes?: string[];
}): DentrixInsuranceClaimDoc | null {
  const { claimsForPatient, idCandidates, descript, hintCodes = [] } = options;
  if (!claimsForPatient.length) return null;

  for (const id of idCandidates) {
    const hit = claimsForPatient.find((c) => claimNumericId(c) === id || Number(c.preauthid ?? c.preauth_id) === id);
    if (hit) return hit;
  }

  if (hintCodes.length) {
    const ranked = [...claimsForPatient]
      .map((c) => ({ claim: c, score: scoreClaimByHintCodes(c, hintCodes) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
    if (ranked[0]) return ranked[0].claim;
  }

  const d = cleanDentrixText(descript).toLowerCase();
  if (d.includes('explanation') || d.includes('acknowledg') || d.includes('predet') || d.includes('benefits')) {
    if (hintCodes.length) {
      const ranked = [...claimsForPatient]
        .map((c) => ({ claim: c, score: scoreClaimByHintCodes(c, hintCodes) }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0]?.score > 0) return ranked[0].claim;
    }
    return null;
  }
  return null;
}
