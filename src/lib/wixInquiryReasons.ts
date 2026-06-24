export const INQUIRY_NOT_BOOKED_REASONS = [
  { id: 'left_message', label: 'Left message' },
  { id: 'patient_declined', label: 'Patient/parent declined' },
  { id: 'direct_billing', label: 'Direct billing' },
  { id: 'no_answer', label: 'No answer' },
  { id: 'wrong_number', label: 'Wrong number' },
  { id: 'booked_elsewhere', label: 'Booked elsewhere' },
  { id: 'booked_and_cancelled', label: 'Booked and cancelled' },
  { id: 'not_a_fit', label: 'Not a fit for office' },
  { id: 'spam', label: 'Spam / invalid' },
  { id: 'other', label: 'Other' },
] as const;

export type InquiryNotBookedReasonId = (typeof INQUIRY_NOT_BOOKED_REASONS)[number]['id'];

const REASON_LABEL_BY_ID = new Map(INQUIRY_NOT_BOOKED_REASONS.map((r) => [r.id, r.label]));

export function inquiryNotBookedReasonLabel(id: string | undefined | null): string | null {
  if (!id) return null;
  return REASON_LABEL_BY_ID.get(id as InquiryNotBookedReasonId) ?? id;
}
