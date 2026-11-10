import { describe, expect, it } from 'vitest';
import {
  CREDIT_SECONDS_PER_CREDIT,
  billingPortalResponseSchema,
  checkoutOrderSchema,
  checkoutResponseSchema,
  creditBalanceSchema,
  creditUsageEntrySchema,
  creditUsageListReadSchema,
  creditUsageListResponseSchema,
  creditsFromSeconds,
  planSchema,
} from './billing.js';

/** A usage entry the schema accepts, so each case can vary one field. */
const entry = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  at: '2026-11-09T10:00:00.000Z',
  kind: 'translate',
  credits: -1.5,
  conversationId: null,
  label: 'Live translation',
  ...over,
});

describe('creditsFromSeconds', () => {
  it('a credit is one minute', () => {
    expect(CREDIT_SECONDS_PER_CREDIT).toBe(60);
    expect(creditsFromSeconds(7200)).toBe(120);
  });

  it('floors to 2 decimals so a balance is never overstated', () => {
    // 59 s = 0.98333… credits
    expect(creditsFromSeconds(59)).toBe(0.98);
    expect(creditsFromSeconds(1)).toBe(0.01);
    expect(creditsFromSeconds(0)).toBe(0);
  });

  it('floors a debit toward minus infinity', () => {
    expect(creditsFromSeconds(-59)).toBe(-0.99);
  });
});

describe('credit amounts', () => {
  it('accepts every value creditsFromSeconds produces', () => {
    for (let seconds = -600; seconds <= 600; seconds += 1) {
      const parsed = creditUsageEntrySchema.safeParse(
        entry({ credits: creditsFromSeconds(seconds) }),
      );
      expect(parsed.success, `seconds=${seconds}`).toBe(true);
    }
  });

  it('refuses a third decimal', () => {
    expect(creditUsageEntrySchema.safeParse(entry({ credits: 0.983 })).success).toBe(false);
  });
});

describe('creditUsageListReadSchema', () => {
  it('drops an entry of a kind this client does not know and keeps the rest', () => {
    const read = creditUsageListReadSchema.parse({
      entries: [entry({ id: 'a' }), entry({ id: 'b', kind: 'gift' }), entry({ id: 'c' })],
      nextCursor: 'cur',
    });
    expect(read.entries.map((e) => e.id)).toEqual(['a', 'c']);
    expect(read.dropped).toBe(1);
    expect(read.nextCursor).toBe('cur');
  });

  it('the writing schema refuses the same unknown kind', () => {
    expect(
      creditUsageListResponseSchema.safeParse({
        entries: [entry({ kind: 'gift' })],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});

describe('checkoutResponseSchema', () => {
  it('reads a Polar checkout as a URL to open', () => {
    const parsed = checkoutResponseSchema.parse({
      rail: 'polar',
      url: 'https://sandbox.polar.sh/checkout/abc',
    });
    expect(parsed.rail).toBe('polar');
  });

  it('reads a SePay checkout with its QR, amount and expiry', () => {
    const parsed = checkoutResponseSchema.parse({
      rail: 'sepay',
      orderId: 'o1',
      orderCode: 'CHTF1A2B3C',
      amountVnd: 249000,
      qrUrl: 'https://qr.sepay.vn/img?acc=1&amount=249000',
      expiresAt: '2026-11-09T10:15:00.000Z',
    });
    expect(parsed.rail === 'sepay' && parsed.amountVnd).toBe(249000);
  });

  it('refuses a SePay checkout without its order code', () => {
    expect(
      checkoutResponseSchema.safeParse({
        rail: 'sepay',
        orderId: 'o1',
        amountVnd: 249000,
        qrUrl: 'https://qr.sepay.vn/img',
        expiresAt: '2026-11-09T10:15:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('planSchema and creditBalanceSchema', () => {
  it('a top-up has no period', () => {
    expect(
      planSchema.safeParse({
        code: 'topup_300',
        kind: 'topup',
        credits: 300,
        priceUsdCents: 499,
        priceVnd: 125000,
        periodDays: null,
        rails: ['polar', 'sepay'],
      }).success,
    ).toBe(true);
  });

  it('reads a Free balance with both rails unavailable', () => {
    expect(
      creditBalanceSchema.safeParse({
        totalCredits: 119.5,
        planCredits: 119.5,
        topupCredits: 0,
        planResetsAt: '2026-12-01T00:00:00.000Z',
        plan: 'free',
        proSource: null,
        checkoutAllowed: false,
        rails: { polar: 'unavailable', sepay: 'unavailable' },
      }).success,
    ).toBe(true);
  });
});

describe('checkoutOrderSchema and billingPortalResponseSchema', () => {
  const order = (over: Record<string, unknown> = {}) => ({
    id: 'o1',
    status: 'pending',
    planCode: 'topup_250',
    amountVnd: 125000,
    expiresAt: '2026-11-09T10:30:00.000Z',
    paidAt: null,
    ...over,
  });

  it('reads a pending order and one held for review', () => {
    expect(checkoutOrderSchema.parse(order()).status).toBe('pending');
    expect(
      checkoutOrderSchema.parse(
        order({ status: 'needs_review', paidAt: '2026-11-09T10:05:00.000Z' }),
      ).status,
    ).toBe('needs_review');
  });

  it('refuses an unknown status and a non-ISO expiry', () => {
    expect(checkoutOrderSchema.safeParse(order({ status: 'refunded' })).success).toBe(false);
    expect(checkoutOrderSchema.safeParse(order({ expiresAt: 'soon' })).success).toBe(false);
  });

  it('reads a portal link and refuses one that is not a URL', () => {
    expect(billingPortalResponseSchema.parse({ url: 'https://polar.sh/portal/x' }).url).toContain(
      'polar.sh',
    );
    expect(billingPortalResponseSchema.safeParse({ url: 'portal' }).success).toBe(false);
  });
});
