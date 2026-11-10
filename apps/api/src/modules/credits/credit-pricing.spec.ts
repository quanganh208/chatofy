import { describe, expect, it } from 'vitest';
import { creditMultiplier } from './credit-pricing';

describe('creditMultiplier', () => {
  it('charges 1 for captions into one language', () => {
    expect(creditMultiplier({ voiceOutput: false, extraTargets: 0 })).toBe(1);
  });

  it('charges 2 for spoken output into one language', () => {
    expect(creditMultiplier({ voiceOutput: true, extraTargets: 0 })).toBe(2);
  });

  it('charges every extra target, times the mode', () => {
    expect(creditMultiplier({ voiceOutput: true, extraTargets: 2 })).toBe(6);
    expect(creditMultiplier({ voiceOutput: false, extraTargets: 2 })).toBe(3);
  });

  it.each([-1, 1.5, Number.NaN])('refuses extraTargets %s', (extraTargets) => {
    expect(() =>
      creditMultiplier({ voiceOutput: false, extraTargets }),
    ).toThrow(RangeError);
  });
});
