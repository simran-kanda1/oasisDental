import { describe, expect, it } from 'vitest';
import { getNotRebookedReasonOptionsForQueue } from './notRebookedReasons';

describe('getNotRebookedReasonOptionsForQueue', () => {
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
});
