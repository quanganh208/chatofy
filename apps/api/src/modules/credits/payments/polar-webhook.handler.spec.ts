import { describe, expect, it } from 'vitest';
import type { PlanRow } from '../plan-catalog';
import {
  addCalendarMonth,
  decideOrderPaid,
  periodOfOrder,
  polarEnvelopeSchema,
  polarOrderSchema,
  polarSubscriptionSchema,
  polarReviewRow,
  polarUserOf,
} from './polar-webhook-payload';

// The decisions the Polar webhook handler makes from a payload, before any
// write. The database side (dedup in the transaction, renewal expiry, stale
// subscription events) is proven against Postgres in billing-webhooks.db-e2e.

const plan = (over: Partial<PlanRow>): PlanRow => ({
  code: 'pro_monthly',
  kind: 'subscription',
  credits: 600,
  priceUsdCents: 999,
  priceVnd: null,
  periodDays: 30,
  polar: true,
  sepay: false,
  active: true,
  sortOrder: 10,
  ...over,
});
const pro = plan({});
const topup = plan({
  code: 'topup_250',
  kind: 'topup',
  credits: 250,
  periodDays: null,
});

/** An order.paid payload shaped like Polar's 2026-04 `Order`, extra fields included. */
function orderPayload(over: Record<string, unknown> = {}) {
  return {
    type: 'order.paid',
    timestamp: '2026-12-09T10:00:05.123456Z',
    data: {
      id: 'ord_1',
      created_at: '2026-12-09T10:00:00.000000Z',
      modified_at: '2026-12-09T10:00:05Z',
      status: 'paid',
      paid: true,
      billing_reason: 'subscription_cycle',
      net_amount: 999,
      tax_amount: 0,
      total_amount: 999,
      currency: 'usd',
      customer_id: 'cus_1',
      customer: { id: 'cus_1', external_id: 'user_1', email: 'x@y.z' },
      product_id: 'prod_pro',
      subscription_id: 'sub_1',
      subscription: {
        id: 'sub_1',
        status: 'active',
        current_period_start: '2026-12-09T10:00:00+00:00',
        current_period_end: '2027-01-09T10:00:00+00:00',
      },
      metadata: { userId: 'user_1', planCode: 'pro_monthly' },
      items: [{ id: 'it_1', label: 'Pro', amount: 999, proration: false }],
      ...over,
    },
  };
}
const order = (over: Record<string, unknown> = {}) =>
  polarOrderSchema.parse(orderPayload(over).data);

describe('Polar payload parsing', () => {
  it('reads an order.paid shaped like the documented Order, ignoring extra fields', () => {
    const envelope = polarEnvelopeSchema.parse(orderPayload());
    expect(envelope.type).toBe('order.paid');
    const parsed = polarOrderSchema.parse(envelope.data);
    expect(parsed.subscription?.current_period_end?.toISOString()).toBe(
      '2027-01-09T10:00:00.000Z',
    );
    expect(parsed.total_amount).toBe(999);
  });

  it('refuses an order with no total or no id', () => {
    expect(
      polarOrderSchema.safeParse({
        ...orderPayload().data,
        total_amount: undefined,
      }).success,
    ).toBe(false);
    expect(
      polarOrderSchema.safeParse({ ...orderPayload().data, id: '' }).success,
    ).toBe(false);
  });

  it('reads a subscription with no modified_at', () => {
    const sub = polarSubscriptionSchema.parse({
      id: 'sub_1',
      status: 'active',
      created_at: '2026-12-09T10:00:00Z',
      modified_at: null,
      customer: { external_id: 'user_1' },
      metadata: { userId: 'user_1' },
    });
    expect(sub.modified_at).toBeNull();
  });
});

describe('polarUserOf', () => {
  it('is the external id when it equals metadata.userId', () => {
    expect(polarUserOf(order())).toBe('user_1');
  });

  it('trusts the external id alone when the order carries no metadata.userId (a renewal)', () => {
    expect(polarUserOf(order({ metadata: {} }))).toBe('user_1');
    expect(polarUserOf(order({ metadata: null }))).toBe('user_1');
    expect(polarUserOf(order({ metadata: { userId: null } }))).toBe('user_1');
  });

  it('is null when metadata.userId disagrees, or there is no external id', () => {
    expect(polarUserOf(order({ metadata: { userId: 'user_2' } }))).toBeNull();
    expect(polarUserOf(order({ metadata: { userId: 7 } }))).toBeNull();
    expect(polarUserOf(order({ customer: { external_id: null } }))).toBeNull();
    expect(polarUserOf(order({ customer: null }))).toBeNull();
  });
});

describe('polarReviewRow', () => {
  it('files a paid, ungranted order under its grant key, plan from product else metadata', () => {
    const now = new Date('2026-12-09T10:00:00Z');
    expect(
      polarReviewRow(
        order(),
        'refused_allowlist',
        'user_1',
        'pro_monthly',
        now,
      ),
    ).toEqual({
      provider: 'polar',
      userId: 'user_1',
      planCode: 'pro_monthly',
      amountMinor: 999,
      currency: 'USD',
      externalRef: 'polar:order:ord_1',
      reason: 'refused_allowlist',
      now,
    });
    expect(
      polarReviewRow(order(), 'unknown_product', 'user_1', null, now)?.planCode,
    ).toBe('pro_monthly');
    expect(
      polarReviewRow(
        order({ metadata: {} }),
        'unknown_product',
        null,
        null,
        now,
      )?.planCode,
    ).toBeNull();
  });

  it('records nothing for an order that cost nothing', () => {
    expect(
      polarReviewRow(
        order({ total_amount: 0 }),
        'user_mismatch',
        null,
        null,
        new Date(),
      ),
    ).toBeNull();
  });
});

describe('periodOfOrder', () => {
  it('takes the period the order itself carries', () => {
    const period = periodOfOrder(order());
    expect(period.startsAt.toISOString()).toBe('2026-12-09T10:00:00.000Z');
    expect(period.expiresAt.toISOString()).toBe('2027-01-09T10:00:00.000Z');
  });

  it('falls back to one calendar month from created_at without a period', () => {
    const period = periodOfOrder(
      order({ subscription: null, created_at: '2027-01-31T08:00:00Z' }),
    );
    expect(period.startsAt.toISOString()).toBe('2027-01-31T08:00:00.000Z');
    expect(period.expiresAt.toISOString()).toBe('2027-02-28T08:00:00.000Z');
  });

  it('adds a calendar month, clamping to the last day', () => {
    expect(
      addCalendarMonth(new Date('2028-01-31T00:00:00Z')).toISOString(),
    ).toBe('2028-02-29T00:00:00.000Z');
    expect(
      addCalendarMonth(new Date('2026-12-15T12:00:00Z')).toISOString(),
    ).toBe('2027-01-15T12:00:00.000Z');
  });
});

describe('decideOrderPaid', () => {
  it('grants a renewal 600 credits for the order period, keyed on the order', () => {
    const decision = decideOrderPaid(order(), 'user_1', pro);
    expect(decision).toMatchObject({
      action: 'grant',
      grant: {
        userId: 'user_1',
        source: 'subscription',
        amount: 600 * 60,
        costBasis: 999,
        currency: 'USD',
        externalRef: 'polar:order:ord_1',
      },
    });
  });

  it('grants a top-up that never expires', () => {
    const decision = decideOrderPaid(
      order({
        billing_reason: 'purchase',
        subscription: null,
        total_amount: 500,
      }),
      'user_1',
      topup,
    );
    expect(decision).toMatchObject({
      action: 'grant',
      grant: {
        source: 'topup',
        amount: 250 * 60,
        expiresAt: null,
        costBasis: 500,
      },
    });
  });

  it('grants nothing when the product maps to no plan, or to a plan of the wrong kind', () => {
    expect(decideOrderPaid(order(), 'user_1', undefined)).toEqual({
      action: 'skip',
      outcome: 'unknown_product',
    });
    expect(decideOrderPaid(order(), 'user_1', topup)).toEqual({
      action: 'skip',
      outcome: 'unknown_product',
    });
    expect(
      decideOrderPaid(order({ billing_reason: 'purchase' }), 'user_1', pro),
    ).toEqual({
      action: 'skip',
      outcome: 'unknown_product',
    });
  });

  it('ignores billing reasons that are not a purchase or a period', () => {
    for (const reason of ['subscription_update', 'subscription_meter_cycle']) {
      expect(
        decideOrderPaid(order({ billing_reason: reason }), 'user_1', pro),
      ).toEqual({
        action: 'skip',
        outcome: 'ignored',
      });
    }
  });
});
