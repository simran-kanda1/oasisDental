import { describe, expect, it } from 'vitest';
import {
  classifyDocumentEstimateStatus,
  classifyEstimateDocumentCategory,
  collectCodesCoveredByPredeterminationResponses,
  countEstimateDocumentCategories,
  documentsSharePredeterminationAssociation,
  isClaimAcknowledgement,
  isPredApprovedDocumentStatus,
  isPredFollowUpDocumentStatus,
  isPredeterminationResponseDocument,
  predAckClearedByResponseDocument,
} from './documentEstimates';
import type { DocumentProcedureContext } from './procedureCodeTypes';

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

  it('keeps generic claim EOBs off the estimate tabs', () => {
    expect(classifyDocumentEstimateStatus('Explanation of benefits')).toBe('unclassified');
    expect(isPredApprovedDocumentStatus('unclassified')).toBe(false);
  });

  it('routes pred errors and office estimate paperwork onto the list', () => {
    expect(classifyDocumentEstimateStatus('Error in Pre-Determination')).toBe('needs_follow_up');
    expect(classifyDocumentEstimateStatus('est rcvd')).toBe('book_right_away');
    expect(classifyDocumentEstimateStatus('CBCT Estimate')).toBe('book_right_away');
    expect(classifyDocumentEstimateStatus('Estimate Received')).toBe('book_right_away');
    expect(isPredApprovedDocumentStatus('book_right_away')).toBe(true);
  });
});

describe('predetermination response documents', () => {
  it('detects claim acknowledgments without routing them to estimate tabs', () => {
    expect(isClaimAcknowledgement('Claim acknowledgment')).toBe(true);
    expect(classifyDocumentEstimateStatus('Claim acknowledgment')).toBe('unclassified');
    expect(isPredeterminationResponseDocument('Claim acknowledgment')).toBe(true);
    expect(isPredeterminationResponseDocument('Explanation of benefits')).toBe(true);
    expect(isPredeterminationResponseDocument('Predetermination Explanation of Benefits')).toBe(true);
  });

  it('links response documents by shared preauth or claim id', () => {
    const predAck: DocumentProcedureContext = {
      procedureCodes: [{ code: '27201', description: 'Crown' }],
      codeTypes: [],
      primaryCodeType: null,
      insurancePlanId: null,
      preauthId: 9001,
      claimId: null,
    };
    const response: DocumentProcedureContext = {
      procedureCodes: [{ code: '27201', description: 'Crown' }],
      codeTypes: [],
      primaryCodeType: null,
      insurancePlanId: null,
      preauthId: 9001,
      claimId: 8800,
    };

    expect(
      documentsSharePredeterminationAssociation(predAck, response, 'Pre-determination acknowledgement 9001', 'Explanation of benefits 9001')
    ).toBe(true);
    expect(
      documentsSharePredeterminationAssociation(
        { ...predAck, preauthId: 1111 },
        { ...response, preauthId: 2222 },
        'Pre-determination acknowledgement',
        'Explanation of benefits'
      )
    ).toBe(false);
  });

  it('collects covered codes from associated EOB / claim acknowledgment documents', () => {
    const predAck: DocumentProcedureContext = {
      procedureCodes: [
        { code: '27201', description: 'Crown' },
        { code: '23111', description: 'Resto' },
      ],
      codeTypes: [],
      primaryCodeType: null,
      insurancePlanId: null,
      preauthId: 5001,
      claimId: null,
    };

    const covered = collectCodesCoveredByPredeterminationResponses({
      predAckDescript: 'Pre-determination acknowledgement 5001',
      predAckContext: predAck,
      patientDocuments: [
        { descript: 'Predetermination Explanation of Benefits 5001' },
        { descript: 'Claim acknowledgment 5001' },
        { descript: 'Explanation of benefits 9999' },
      ],
      resolveResponseContext: (descript) => {
        if (descript.includes('9999')) {
          return {
            procedureCodes: [{ code: '27201', description: 'Crown' }],
            codeTypes: [],
            primaryCodeType: null,
            insurancePlanId: null,
            preauthId: 9999,
          };
        }
        if (descript.toLowerCase().includes('claim')) {
          return {
            procedureCodes: [{ code: '23111', description: 'Resto' }],
            codeTypes: [],
            primaryCodeType: null,
            insurancePlanId: null,
            preauthId: 5001,
          };
        }
        return {
          procedureCodes: [{ code: '27201', description: 'Crown' }],
          codeTypes: [],
          primaryCodeType: null,
          insurancePlanId: null,
          preauthId: 5001,
        };
      },
    });

    expect([...covered].sort()).toEqual(['23111', '27201']);
  });
});

describe('estimate document categories', () => {
  it('splits loaded documents into pred, claim ack, EOB, and other', () => {
    expect(classifyEstimateDocumentCategory('Pre-determination acknowledgement')).toBe('pred_ack');
    expect(classifyEstimateDocumentCategory('Error in Pre-Determination')).toBe('pred_error');
    expect(classifyEstimateDocumentCategory('Predetermination Explanation of Benefits')).toBe('pred_eob');
    expect(classifyEstimateDocumentCategory('CBCT Estimate')).toBe('office_estimate');
    expect(classifyEstimateDocumentCategory('Claim acknowledgment')).toBe('claim_ack');
    expect(classifyEstimateDocumentCategory('Explanation of benefits')).toBe('generic_eob');
    expect(classifyEstimateDocumentCategory('Referral letter')).toBe('other');

    const counts = countEstimateDocumentCategories([
      { descript: 'Pre-determination acknowledgement 100' },
      { descript: 'Claim acknowledgment 100' },
      { descript: 'Explanation of benefits' },
      { descript: 'Explanation of benefits' },
      { descript: 'Welcome packet' },
    ]);
    expect(counts.pred_ack).toBe(1);
    expect(counts.claim_ack).toBe(1);
    expect(counts.generic_eob).toBe(2);
    expect(counts.other).toBe(1);
  });

  it('flags pred acks that share an id with a claim ack or EOB', () => {
    expect(
      predAckClearedByResponseDocument('Pre-determination acknowledgement 5001', [
        { descript: 'Claim acknowledgment 5001' },
        { descript: 'Welcome packet' },
      ])
    ).toBe(true);
    expect(
      predAckClearedByResponseDocument('Pre-determination acknowledgement 5001', [
        { descript: 'Claim acknowledgment 9999' },
      ])
    ).toBe(false);
  });
});
