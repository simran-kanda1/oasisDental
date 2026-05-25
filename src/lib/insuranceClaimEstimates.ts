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

export function findClaimForDocument(options: {
  patientId: string;
  descript: string;
  claimsForPatient: DentrixInsuranceClaimDoc[];
  idCandidates: number[];
}): DentrixInsuranceClaimDoc | null {
  const { claimsForPatient, idCandidates, descript } = options;
  if (!claimsForPatient.length) return null;

  for (const id of idCandidates) {
    const hit = claimsForPatient.find((c) => claimNumericId(c) === id || Number(c.preauthid ?? c.preauth_id) === id);
    if (hit) return hit;
  }

  const d = cleanDentrixText(descript).toLowerCase();
  if (d.includes('explanation') || d.includes('acknowledg') || d.includes('predet') || d.includes('benefits')) {
    return claimsForPatient[0] ?? null;
  }
  return null;
}
