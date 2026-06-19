import { describe, expect, it } from 'vitest';
import {
  classifyDocumentEstimateStatus,
  isPredApprovedDocumentStatus,
  isPredFollowUpDocumentStatus,
} from './documentEstimates';

describe('classifyDocumentEstimateStatus', () => {
  it('routes pre-d acknowledgement variants to follow-up tab', () => {
    expect(classifyDocumentEstimateStatus('Pre-determination acknowledgement')).toBe('needs_follow_up');
    expect(classifyDocumentEstimateStatus('Pre-Determination Acknowledgement')).toBe('needs_follow_up');
    expect(classifyDocumentEstimateStatus('Predetermination Acknowledgement')).toBe('needs_follow_up');
    expect(isPredFollowUpDocumentStatus('needs_follow_up')).toBe(true);
  });

  it('does not route claim acknowledgement to estimates', () => {
    expect(classifyDocumentEstimateStatus('Claim acknowledgement')).toBe('unclassified');
    expect(classifyDocumentEstimateStatus('Claim acknowledgment')).toBe('unclassified');
  });

  it('routes predetermination EOB to pre-d approved only', () => {
    expect(classifyDocumentEstimateStatus('Predetermination Explanation of Benefits')).toBe('covered_eob');
    expect(isPredApprovedDocumentStatus('covered_eob')).toBe(true);
    expect(isPredFollowUpDocumentStatus('covered_eob')).toBe(false);
  });

  it('routes generic EOB to pre-d approved only', () => {
    expect(classifyDocumentEstimateStatus('Explanation of benefits')).toBe('covered_eob');
    expect(isPredFollowUpDocumentStatus('covered_eob')).toBe(false);
  });

  it('routes bare explanation to book right away', () => {
    expect(classifyDocumentEstimateStatus('Explanation for crown')).toBe('book_right_away');
  });
});
