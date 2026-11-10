import { describe, expect, it } from 'vitest';
import {
  billingMonthKey,
  billingMonthStart,
  nextBillingMonthStart,
} from './billing-period';

describe('billing period (Asia/Saigon month)', () => {
  it('treats 2026-11-30T17:00Z as December already', () => {
    const now = new Date('2026-11-30T17:00:00.000Z');
    expect(billingMonthKey(now)).toBe('2026-12');
    expect(billingMonthStart(now).toISOString()).toBe(
      '2026-11-30T17:00:00.000Z',
    );
    expect(nextBillingMonthStart(now).toISOString()).toBe(
      '2026-12-31T17:00:00.000Z',
    );
  });

  it('keeps the last instant before local midnight in November', () => {
    const now = new Date('2026-11-30T16:59:59.999Z');
    expect(billingMonthKey(now)).toBe('2026-11');
    expect(nextBillingMonthStart(now).toISOString()).toBe(
      '2026-11-30T17:00:00.000Z',
    );
  });

  it('rolls the year over in local time', () => {
    const now = new Date('2026-12-31T18:00:00.000Z');
    expect(billingMonthKey(now)).toBe('2027-01');
    expect(nextBillingMonthStart(now).toISOString()).toBe(
      '2027-01-31T17:00:00.000Z',
    );
  });
});
