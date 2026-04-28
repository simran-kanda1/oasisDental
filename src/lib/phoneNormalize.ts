/** Digits only, suitable for comparing US and formatted numbers. */
export function normalizePhoneDigits(phone: string | undefined | null): string {
    if (!phone || typeof phone !== 'string') return '';
    return phone.replace(/\D/g, '');
}

/** Last 10 digits when long enough (NANP), else full digit string. */
export function phoneMatchKey(digits: string): string {
    if (digits.length >= 10) return digits.slice(-10);
    return digits;
}

export function collectPatientPhoneKeys(
    patients: Array<{ home_phone?: string; mobile_phone?: string }>
): Set<string> {
    const keys = new Set<string>();
    for (const p of patients) {
        const h = phoneMatchKey(normalizePhoneDigits(p.home_phone));
        const m = phoneMatchKey(normalizePhoneDigits(p.mobile_phone));
        if (h) keys.add(h);
        if (m) keys.add(m);
    }
    return keys;
}

export function inquiryPhoneMatchesPatientSet(inquiryPhone: string | undefined | null, patientKeys: Set<string>): boolean {
    const k = phoneMatchKey(normalizePhoneDigits(inquiryPhone));
    if (!k) return false;
    return patientKeys.has(k);
}
