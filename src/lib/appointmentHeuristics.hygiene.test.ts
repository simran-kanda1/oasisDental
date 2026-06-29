import { describe, expect, it } from 'vitest';
import type { DentrixAppointmentDoc } from './dentrix';
import {
  hygieneRecallLabelText,
  isHygieneContinuingCareProductionType,
  isScalingPrimaryHygieneVisit,
  parseHygieneRecallIntervalMonths,
} from './appointmentHeuristics';

describe('hygiene recall parsing', () => {
  it('parses interval from reason only, not continuing-care production type', () => {
    const appt = {
      id: 'a1',
      reason: '4M prophy',
      production_type_desc: '6mo Continuing care',
    } as DentrixAppointmentDoc;
    expect(hygieneRecallLabelText(appt)).toBe('4m prophy');
    expect(parseHygieneRecallIntervalMonths(appt)).toBe(4);
  });

  it('detects scaling-primary and continuing-care production types', () => {
    const scaling = { id: 'a1', reason: '* SCALING', appointment_type: 'HYG2' } as DentrixAppointmentDoc;
    const cc = { id: 'a2', production_type_desc: '6mo Continuing care' } as DentrixAppointmentDoc;
    expect(isScalingPrimaryHygieneVisit(scaling)).toBe(true);
    expect(isHygieneContinuingCareProductionType(cc)).toBe(true);
  });
});
