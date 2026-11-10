import { describe, expect, it } from 'vitest';
import { newOrderCode, orderCodePattern } from './sepay-provider';
import {
  decideTransfer,
  orderCodeOf,
  sepayTransferSchema,
} from './sepay-webhook-payload';

// The decisions the SePay webhook handler makes from a transfer, before any
// write. The writes themselves are proven against Postgres in
// billing-webhooks.db-e2e.

describe('order codes', () => {
  it('are the prefix plus 8 base32 characters, and differ every time', () => {
    const codes = new Set(
      Array.from({ length: 200 }, () => newOrderCode('CHF')),
    );
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^CHF[A-Z2-7]{8}$/);
  });

  it("are found in SePay's code field, or else in the memo text", () => {
    expect(orderCodeOf({ code: 'CHFABCDEF23', content: 'x' }, 'CHF')).toBe(
      'CHFABCDEF23',
    );
    expect(
      orderCodeOf(
        { code: null, content: 'NGUYEN VAN A chfabcdef23 chuyen tien' },
        'CHF',
      ),
    ).toBe('CHFABCDEF23');
    expect(
      orderCodeOf(
        { code: null, content: 'MBVCB.123.CHFABCDEF23.CT tu' },
        'CHF',
      ),
    ).toBe('CHFABCDEF23');
  });

  it('are not found when the memo carries none, or a different prefix', () => {
    expect(
      orderCodeOf({ code: null, content: 'chuyen tien' }, 'CHF'),
    ).toBeNull();
    expect(
      orderCodeOf({ code: 'DHABCDEF23', content: 'DHABCDEF23' }, 'CHF'),
    ).toBeNull();
    expect(orderCodePattern('CHF').test('CHFABC')).toBe(false);
  });
});

describe('SePay payload parsing', () => {
  it('reads the documented payload and keeps the transaction id as a string', () => {
    const parsed = sepayTransferSchema.parse({
      id: 92704,
      gateway: 'Vietcombank',
      transactionDate: '2024-07-02 11:08:33',
      accountNumber: '1017588888',
      subAccount: '',
      code: null,
      content: 'CHFABCDEF23 chuyen tien',
      transferType: 'in',
      description: '',
      transferAmount: 125000,
      accumulated: 0,
      referenceCode: 'FT24012345678',
    });
    expect(parsed.id).toBe('92704');
  });

  it('refuses a payload without an id or an amount', () => {
    expect(
      sepayTransferSchema.safeParse({ transferType: 'in', transferAmount: 1 })
        .success,
    ).toBe(false);
    expect(
      sepayTransferSchema.safeParse({ id: 1, transferType: 'in' }).success,
    ).toBe(false);
  });
});

describe('decideTransfer', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  const order = {
    amountVnd: 125000,
    expiresAt: new Date('2026-11-09T12:30:00Z'),
  };

  it('grants the exact amount from an allowlisted account', () => {
    expect(
      decideTransfer(order, { transferAmount: 125000 }, true, now),
    ).toEqual({
      action: 'grant',
      lateBySeconds: 0,
    });
  });

  it('still grants after the order expired, and says how late', () => {
    const late = new Date('2026-11-09T13:00:00Z');
    expect(
      decideTransfer(order, { transferAmount: 125000 }, true, late),
    ).toEqual({
      action: 'grant',
      lateBySeconds: 1800,
    });
  });

  it('sends a wrong amount to review, before the allowlist is considered', () => {
    for (const amount of [124999, 125001, 250000]) {
      expect(
        decideTransfer(order, { transferAmount: amount }, false, now),
      ).toEqual({
        action: 'review',
        reason: 'amount_mismatch',
      });
    }
  });

  it('sends an account no longer allowlisted to review', () => {
    expect(
      decideTransfer(order, { transferAmount: 125000 }, false, now),
    ).toEqual({
      action: 'review',
      reason: 'refused_allowlist',
    });
  });
});
