import { describe, expect, it } from 'vitest';
import { classifyDocumentEstimateStatus } from './documentEstimates';

describe('classifyDocumentEstimateStatus', () => {
  it('routes pre-d acknowledgement to follow-up tab', () => {
    expect(classifyDocumentEstimateStatus('Pre-determination acknowledgement')).toBe('needs_follow_up');
  });

  it('does not route claim acknowledgement to estimates', () => {
    expect(classifyDocumentEstimateStatus('Claim acknowledgement')).toBe('unclassified');
    expect(classifyDocumentEstimateStatus('Claim acknowledgment')).toBe('unclassified');
  });

  it('routes EOB to approved tab', () => {
    expect(classifyDocumentEstimateStatus('Explanation of benefits')).toBe('covered_eob');
  });

  it('routes bare explanation to book right away', () => {
    expect(classifyDocumentEstimateStatus('Explanation for crown')).toBe('book_right_away');
  });
});
