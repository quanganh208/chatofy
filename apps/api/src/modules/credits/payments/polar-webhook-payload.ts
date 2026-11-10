import { CREDIT_SECONDS_PER_CREDIT } from '@chatofy/types';
import { z } from 'zod';
import type { GrantInput } from '../credit-ledger.port';
import type { PlanRow } from '../plan-catalog';
import type {
  PaymentReviewReason,
  PaymentReviewRow,
} from './payment-review-rows';

// The parts of Polar's webhook payloads this app reads, and the pure decisions
// made from them. Only the fields used are parsed (anything else passes
// through untouched), so a field Polar adds never breaks a delivery.
//
// Field names follow Polar's OpenAPI spec (API version 2026-04): an `Order`
// embeds its `customer` (with `external_id`) and, for a subscription order, the
// `subscription` it belongs to with `current_period_start/end`. The order and
// its line items have no period of their own, so the embedded subscription is
// where a renewal's period comes from.

/** An ISO timestamp as Polar writes it (any fraction, `Z` or an offset). */
const polarDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'not a timestamp')
  .transform((value) => new Date(value));

const customerSchema = z.object({ external_id: z.string().nullish() });
const metadataSchema = z.record(z.string(), z.unknown()).nullish();

export const polarOrderSchema = z.object({
  id: z.string().min(1),
  created_at: polarDate,
  billing_reason: z.string(),
  total_amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  product_id: z.string().nullish(),
  customer: customerSchema.nullish(),
  metadata: metadataSchema,
  subscription: z
    .object({
      current_period_start: polarDate.nullish(),
      current_period_end: polarDate.nullish(),
    })
    .nullish(),
});
export type PolarOrder = z.infer<typeof polarOrderSchema>;

export const polarSubscriptionSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  created_at: polarDate,
  modified_at: polarDate.nullish(),
  current_period_start: polarDate.nullish(),
  current_period_end: polarDate.nullish(),
  cancel_at_period_end: z.boolean().nullish(),
  customer: customerSchema.nullish(),
  metadata: metadataSchema,
});
export type PolarSubscription = z.infer<typeof polarSubscriptionSchema>;

export const polarEnvelopeSchema = z.object({
  type: z.string().min(1),
  data: z.object({ id: z.string().min(1) }).passthrough(),
});

/** Subscription events that carry the subscription's new state. */
export const SUBSCRIPTION_STATE_EVENTS: ReadonlySet<string> = new Set([
  'subscription.active',
  'subscription.updated',
  'subscription.canceled',
  'subscription.revoked',
]);

/**
 * The account an order or subscription belongs to: the Polar customer's
 * `external_id`. Only this server sets it (`external_customer_id` on a checkout
 * it creates with the org token), so it is trusted on its own — a renewal order
 * need not carry the checkout's metadata. When `metadata.userId` IS present it
 * must agree: a customer record reused across accounts credits no one. Null
 * without an `external_id` (a checkout made outside this API) or on a mismatch.
 */
export function polarUserOf(object: {
  customer?: { external_id?: string | null } | null;
  metadata?: Record<string, unknown> | null;
}): string | null {
  const external = object.customer?.external_id;
  if (!external) return null;
  const fromMetadata = object.metadata?.userId;
  if (fromMetadata === undefined || fromMetadata === null) return external;
  return fromMetadata === external ? external : null;
}

/** The plan code our checkout wrote into the order's metadata, if any. */
function metadataPlanCode(order: PolarOrder): string | null {
  const code = order.metadata?.planCode;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/**
 * The review row for a paid order that was not granted, keyed on
 * `polar:order:<id>` — the key the grant would have used, so the owner's
 * `credits:resolve-payment` and a later redelivery cannot both grant. The plan
 * is the product's, else the one our checkout wrote into metadata; the owner
 * checks it before granting. Null for an order that cost nothing.
 */
export function polarReviewRow(
  order: PolarOrder,
  reason: PaymentReviewReason,
  userId: string | null,
  planCode: string | null,
  now: Date,
): PaymentReviewRow | null {
  if (order.total_amount <= 0) return null;
  return {
    provider: 'polar',
    userId,
    planCode: planCode ?? metadataPlanCode(order),
    amountMinor: order.total_amount,
    currency: order.currency.toUpperCase(),
    externalRef: `polar:order:${order.id}`,
    reason,
    now,
  };
}

/** One calendar month after `from`, clamped to the month's last day (Jan 31 → Feb 28/29). */
export function addCalendarMonth(from: Date): Date {
  const next = new Date(from);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/**
 * The paid period an order covers, taken from the order itself — never from
 * "the subscription now", which is a later period when a delivery is late.
 * An order without one covers a calendar month from its creation.
 */
export function periodOfOrder(order: PolarOrder): {
  startsAt: Date;
  expiresAt: Date;
} {
  const start = order.subscription?.current_period_start;
  const end = order.subscription?.current_period_end;
  if (start && end && end > start) return { startsAt: start, expiresAt: end };
  return {
    startsAt: order.created_at,
    expiresAt: addCalendarMonth(order.created_at),
  };
}

export type OrderDecision =
  { action: 'grant'; grant: GrantInput } | { action: 'skip'; outcome: string };

/**
 * What an `order.paid` is worth, before any database check.
 *
 * `billing_reason` decides the kind: `purchase` is a top-up, which never
 * expires; `subscription_create` and `subscription_cycle` are a Pro period.
 * The plan is the one the order's PRODUCT was configured for — not anything in
 * metadata — and its kind must match the reason.
 */
export function decideOrderPaid(
  order: PolarOrder,
  userId: string,
  plan: PlanRow | undefined,
): OrderDecision {
  const reason = order.billing_reason;
  const isPurchase = reason === 'purchase';
  const isPeriod =
    reason === 'subscription_create' || reason === 'subscription_cycle';
  if (!isPurchase && !isPeriod) return { action: 'skip', outcome: 'ignored' };
  if (!plan) return { action: 'skip', outcome: 'unknown_product' };
  const expectedKind = isPurchase ? 'topup' : 'subscription';
  if (plan.kind !== expectedKind) {
    return { action: 'skip', outcome: 'unknown_product' };
  }
  const base = {
    userId,
    planCode: plan.code,
    amount: plan.credits * CREDIT_SECONDS_PER_CREDIT,
    costBasis: order.total_amount,
    currency: order.currency.toUpperCase(),
    externalRef: `polar:order:${order.id}`,
    reason: `polar ${reason}`,
  };
  if (isPurchase) {
    return {
      action: 'grant',
      grant: { ...base, source: 'topup', startsAt: null, expiresAt: null },
    };
  }
  const period = periodOfOrder(order);
  return {
    action: 'grant',
    grant: { ...base, source: 'subscription', ...period },
  };
}
