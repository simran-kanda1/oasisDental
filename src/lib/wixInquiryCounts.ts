/** Open lead for sidebar / dashboard / KPI counts (excludes converted + patient phone matches). */
export function isOpenWixInquiryDoc(data: Record<string, unknown>): boolean {
    if (data.phoneMatchExcluded === true) return false;
    const status = String(data.status ?? '').toLowerCase();
    return status !== 'converted';
}
