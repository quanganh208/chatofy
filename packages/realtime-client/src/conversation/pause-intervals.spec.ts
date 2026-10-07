import { describe, expect, it } from 'vitest';
import { pausedMsBefore } from './pause-intervals.js';

describe('pausedMsBefore', () => {
  const pauses = [
    { startedAt: 1_000, endedAt: 2_000 },
    { startedAt: 5_000, endedAt: null },
  ];

  it('is zero before the first pause, and with none at all', () => {
    expect(pausedMsBefore(pauses, 500)).toBe(0);
    expect(pausedMsBefore([], 10_000)).toBe(0);
  });

  it('counts the part of an interval that lies before the instant', () => {
    expect(pausedMsBefore(pauses, 1_250)).toBe(250);
    expect(pausedMsBefore(pauses, 4_000)).toBe(1_000);
  });

  it('counts a pause still open up to the instant', () => {
    expect(pausedMsBefore(pauses, 7_000)).toBe(3_000);
  });

  it('reads a non-finite instant as no pause, never as NaN or Infinity', () => {
    expect(pausedMsBefore(pauses, Number.NaN)).toBe(0);
    expect(pausedMsBefore(pauses, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
