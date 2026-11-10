import { describe, expect, it } from 'vitest';
import { isCheckoutAllowed, parseAllowlist } from './checkout-allowlist';

describe('checkout allowlist', () => {
  it('admits addresses whatever their case and surrounding spaces', () => {
    const list = parseAllowlist(' Owner@Example.com ,second@example.org');
    expect(isCheckoutAllowed('owner@example.com', list)).toBe(true);
    expect(isCheckoutAllowed('OWNER@EXAMPLE.COM', list)).toBe(true);
    expect(isCheckoutAllowed('  second@Example.ORG ', list)).toBe(true);
  });

  it('admits no one when unset or empty, and ignores empty entries', () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist('').size).toBe(0);
    expect(parseAllowlist(' , ,').size).toBe(0);
    expect(
      isCheckoutAllowed('owner@example.com', parseAllowlist(undefined)),
    ).toBe(false);
  });

  it('refuses an address not on the list, and a missing one', () => {
    const list = parseAllowlist('owner@example.com');
    expect(isCheckoutAllowed('other@example.com', list)).toBe(false);
    expect(isCheckoutAllowed('owner@example.com.evil', list)).toBe(false);
    expect(isCheckoutAllowed(null, list)).toBe(false);
    expect(isCheckoutAllowed('', list)).toBe(false);
  });
});
