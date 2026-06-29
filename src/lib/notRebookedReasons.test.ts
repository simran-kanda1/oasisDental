import { describe, expect, it } from 'vitest';
import {
  getNotRebookedReasonOptionsForQueue,
  queueReasonRemovalPatch,
  queueReasonRemovesFromList,
} from './notRebookedReasons';

describe('getNotRebookedReasonOptionsForQueue', () => {
  it('uses emergency workflow options', () => {
    const labels = getNotRebookedReasonOptionsForQueue('emerg_follow_up').map((o) => o.label);
    expect(labels).toContain('Patient booked');
    expect(labels).toContain('Treatment on hold');
    expect(labels).toContain('Transferred care elsewhere');
    expect(labels).not.toContain('Medical hold');
  });

  it('uses new patient workflow options', () => {
    const labels = getNotRebookedReasonOptionsForQueue('new_patient_follow_up').map((o) => o.label);
    expect(labels).toContain('Patient booked');
    expect(labels).toContain('Hold');
    expect(labels).not.toContain('Medical hold');
  });

  it('uses gum grafting workflow options', () => {
    const labels = getNotRebookedReasonOptionsForQueue('gum_grafting').map((o) => o.label);
    expect(labels).toContain('Other sections pending');
    expect(labels).toContain('Follow up at next hygiene');
    expect(labels).toContain('Treatment on hold');
    expect(labels).not.toContain('Medical hold');
  });

  it('uses default options with treatment on hold and unreliable flag', () => {
    const labels = getNotRebookedReasonOptionsForQueue('extraction').map((o) => o.label);
    expect(labels).toContain('Treatment on hold');
    expect(labels).toContain("Unreliable, don't book");
    expect(labels).not.toContain('Medical hold');
  });

  it('uses night guard workflow options', () => {
    const labels = getNotRebookedReasonOptionsForQueue('night_guard').map((o) => o.label);
    expect(labels).toContain('Estimate sent');
    expect(labels).toContain('Patient booked for impression/scan');
    expect(labels).toContain('Complete');
    expect(labels).not.toContain('Cost / financial');
  });

  it('adds perio-specific follow-up options', () => {
    const labels = getNotRebookedReasonOptionsForQueue('perio').map((o) => o.label);
    expect(labels).toContain('Other sections pending');
    expect(labels).toContain('Treatment complete');
    expect(labels).toContain('Cost / financial');
  });

  it('uses GA workflow status options', () => {
    const labels = getNotRebookedReasonOptionsForQueue('ga_all_appointments').map((o) => o.label);
    expect(labels).toContain('Estimate sent');
    expect(labels).toContain('GA IC sent/received');
    expect(labels).toContain('Patient undecided / treatment on hold');
    expect(labels).toContain('Treatment complete');
    expect(labels).not.toContain('Cost / financial');
  });

  it('uses ortho follow-up workflow status options', () => {
    const labels = getNotRebookedReasonOptionsForQueue('ortho_follow_ups').map((o) => o.label);
    expect(labels).toContain('Consult booked');
    expect(labels).toContain('Estimate sent/received');
    expect(labels).toContain('Ortho records booked');
    expect(labels).toContain('Inactive treatment');
    expect(labels).toContain('Ortho complete');
    expect(labels).toContain('Ortho recare');
    expect(labels).not.toContain('Cost / financial');
    expect(labels).not.toContain('Patient/parent declined');
  });
});

describe('queueReasonRemovalPatch', () => {
  it('removes emerg rows when patient booked or care transferred', () => {
    expect(queueReasonRemovesFromList('emerg_follow_up', 'patient_booked')).toBe(true);
    expect(queueReasonRemovesFromList('emerg_follow_up', 'transferred')).toBe(true);
    expect(queueReasonRemovesFromList('emerg_follow_up', 'treatment_on_hold')).toBe(false);
    expect(queueReasonRemovalPatch('emerg_follow_up', 'patient_booked')).toMatchObject({
      removedFromList: true,
    });
  });

  it('removes new patient rows when patient booked', () => {
    expect(queueReasonRemovesFromList('new_patient_follow_up', 'patient_booked')).toBe(true);
    expect(queueReasonRemovesFromList('new_patient_follow_up', 'hold')).toBe(false);
    expect(queueReasonRemovalPatch('new_patient_follow_up', 'patient_booked')).toMatchObject({
      removedFromList: true,
    });
  });

  it('removes no appt booked rows when care transferred elsewhere', () => {
    expect(queueReasonRemovesFromList('no_appt_booked', 'transferred')).toBe(true);
    expect(queueReasonRemovalPatch('no_appt_booked', 'transferred')).toMatchObject({
      removedFromList: true,
    });
  });

  it('removes no appt booked rows for declined, unreliable, or repeated voicemail', () => {
    expect(queueReasonRemovesFromList('no_appt_booked', 'declined')).toBe(true);
    expect(queueReasonRemovesFromList('no_appt_booked', 'unreliable_dont_book')).toBe(true);
    expect(queueReasonRemovesFromList('no_appt_booked', 'voicemail_multiple')).toBe(true);
    expect(queueReasonRemovesFromList('no_appt_booked', 'voicemail')).toBe(false);
    expect(queueReasonRemovalPatch('no_appt_booked', 'declined')).toMatchObject({
      removedFromList: true,
    });
  });

  it('includes left voicemail multiple times on recall options', () => {
    const labels = getNotRebookedReasonOptionsForQueue('no_appt_booked').map((o) => o.label);
    expect(labels).toContain('Left voicemail multiple times');
  });

  it('removes GA rows when patient booked or treatment complete', () => {
    expect(queueReasonRemovesFromList('ga_all_appointments', 'patient_booked')).toBe(true);
    expect(queueReasonRemovesFromList('ga_all_appointments', 'treatment_complete')).toBe(true);
    expect(queueReasonRemovalPatch('ga_all_appointments', 'treatment_complete')).toMatchObject({
      removedFromList: true,
      treatmentComplete: true,
    });
  });
});
