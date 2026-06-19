import { describe, expect, it } from 'vitest';
import {
  buildReferralDoctorQueueRows,
  isDoctorReferrerSource,
  type DentrixPatientReferralLinkDoc,
  type DentrixReferralDoc,
} from './referralDoctorQueue';
import type { DentrixPatientDoc } from './dentrix';

describe('isDoctorReferrerSource', () => {
  it('matches Dr in referrer names', () => {
    expect(isDoctorReferrerSource('Dr John Smith')).toBe(true);
    expect(isDoctorReferrerSource('DR. Jane Doe')).toBe(true);
  });

  it('rejects non-doctor sources', () => {
    expect(isDoctorReferrerSource('Smith Dental Office')).toBe(false);
    expect(isDoctorReferrerSource('Organization')).toBe(false);
  });
});

describe('buildReferralDoctorQueueRows', () => {
  const patientsById: Record<string, DentrixPatientDoc> = {
    '1': { id: '1', patient_id: 1, first_name: 'Pat', last_name: 'One', status: 1 },
  };

  it('only includes rows whose referrer source contains Dr', () => {
    const doctorReferrals: DentrixReferralDoc[] = [
      { id: 'r1', ref_id: 101, ref_type: 1, title: 'Dr', first_name: 'Amy', last_name: 'Lee' },
      { id: 'r2', ref_id: 102, ref_type: 1, first_name: 'City', last_name: 'Dental' },
    ];
    const links: DentrixPatientReferralLinkDoc[] = [
      { id: 'l1', patient_id: 1, referral_id: 101 },
      { id: 'l2', patient_id: 1, referral_id: 102 },
    ];

    const rows = buildReferralDoctorQueueRows(patientsById, doctorReferrals, links);
    expect(rows).toHaveLength(1);
    expect(rows[0].referralRefId).toBe(101);
    expect(rows[0].referrerDisplay).toContain('Dr');
  });
});
