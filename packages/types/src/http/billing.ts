// AI credits, plans and checkout — the HTTP contracts every client reads.
//
// 1 credit = 1 caption-minute. The ledger stores integer credit-SECONDS; every
// value a client receives here is already in credits (2 decimals at most),
// converted by `creditsFromSeconds` so web, mobile and the extension round the
// same way. A client never sees or converts raw credit-seconds over HTTP.
import { z } from 'zod';

/** Credit-seconds in one credit: a credit is one caption-minute. */
export const CREDIT_SECONDS_PER_CREDIT = 60;

/**
 * Credit-seconds → credits, floored to 2 decimals so a balance is never shown
 * as more than the account actually holds. Negative input (a debit) floors
 * toward minus infinity for the same reason.
 */
export function creditsFromSeconds(seconds: number): number {
  return Math.floor((seconds / CREDIT_SECONDS_PER_CREDIT) * 100) / 100;
}

/** A credit amount as clients see it: finite, at most 2 decimals. */
const creditAmountSchema = z
  .number()
  .finite()
  // Cents of a 2-decimal float are not exact (0.29 * 100 = 28.999…), so the
  // check allows float noise but not a third decimal.
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'credits carry at most 2 decimals',
  });

/** A payment rail. Polar charges cards in USD; SePay takes VND bank transfers. */
export const paymentRailSchema = z.enum(['polar', 'sepay']);
export type PaymentRail = z.infer<typeof paymentRailSchema>;

/**
 * A rail's state on this deployment. Each rail's env switch is `sandbox|live`;
 * the API reports `unavailable` when that rail's secrets are missing, so a
 * client disables it instead of offering a checkout that cannot open.
 */
export const railStatusSchema = z.enum(['sandbox', 'live', 'unavailable']);
export type RailStatus = z.infer<typeof railStatusSchema>;

/** What buying a plan gives: a monthly allowance, a fixed pass, or a top-up pack. */
export const planKindSchema = z.enum(['free', 'subscription', 'pass', 'topup']);
export type PlanKind = z.infer<typeof planKindSchema>;

export const planSchema = z.object({
  /** Stable plan code, e.g. `pro_monthly`; what checkout is asked for. */
  code: z.string().min(1).max(64),
  kind: planKindSchema,
  /** Credits granted per period (or once, for a top-up). */
  credits: z.number().int().nonnegative(),
  /** Price on the Polar rail, in US cents; null when the plan is not sold there. */
  priceUsdCents: z.number().int().nonnegative().nullable(),
  /** Price on the SePay rail, in whole đồng; null when the plan is not sold there. */
  priceVnd: z.number().int().nonnegative().nullable(),
  /** Length of a plan period in days; null for a top-up, which never expires. */
  periodDays: z.number().int().positive().nullable(),
  /** Rails this plan can be bought on right now (rails reported unavailable are left out). */
  rails: z.array(paymentRailSchema),
});
export type Plan = z.infer<typeof planSchema>;

export const planListResponseSchema = z.object({ plans: z.array(planSchema) });
export type PlanListResponse = z.infer<typeof planListResponseSchema>;

export const creditBalanceSchema = z.object({
  /** Everything spendable now: plan + top-up. */
  totalCredits: creditAmountSchema,
  /** Left from the current Free or Pro period; expires at `planResetsAt`. */
  planCredits: creditAmountSchema,
  /** Bought top-ups; these never expire. */
  topupCredits: creditAmountSchema,
  /** ISO-8601 end of the current plan period; null when no period is active. */
  planResetsAt: z.iso.datetime().nullable(),
  plan: z.enum(['free', 'pro']),
  /** Where Pro came from (Polar subscription or SePay pass); null on Free. */
  proSource: paymentRailSchema.nullable(),
  /** False until this account is let in to checkout; buy actions explain why. */
  checkoutAllowed: z.boolean(),
  rails: z.object({ polar: railStatusSchema, sepay: railStatusSchema }),
});
export type CreditBalance = z.infer<typeof creditBalanceSchema>;

/** Why a ledger entry exists. A kind added later is dropped by shipped readers. */
export const creditUsageKindSchema = z.enum([
  'translate',
  'minutes',
  'grant',
  'refund',
  'expire',
  'void',
]);
export type CreditUsageKind = z.infer<typeof creditUsageKindSchema>;

export const creditUsageEntrySchema = z.object({
  id: z.string().min(1),
  /** ISO-8601 time the entry was written. */
  at: z.iso.datetime(),
  kind: creditUsageKindSchema,
  /** Signed: negative spends, positive adds. */
  credits: creditAmountSchema,
  /** History conversation the spend belongs to, when the client sent one. */
  conversationId: z.string().nullable(),
  /** Short server-written description (plan name, feature), shown as-is. */
  label: z.string(),
});
export type CreditUsageEntry = z.infer<typeof creditUsageEntrySchema>;

/** What the API writes for `GET /billing/usage`. */
export const creditUsageListResponseSchema = z.object({
  entries: z.array(creditUsageEntrySchema),
  /** Pass back as `?cursor=` for the next page; null when this is the last. */
  nextCursor: z.string().nullable(),
});
export type CreditUsageListResponse = z.infer<typeof creditUsageListResponseSchema>;

/**
 * What a client parses `GET /billing/usage` with. Each entry is kept only if it
 * reads as a known entry, so a usage kind a later API adds is left out of a
 * shipped client's list instead of failing the whole page. `dropped` counts
 * what was left out.
 */
export const creditUsageListReadSchema = z
  .object({ entries: z.array(z.unknown()), nextCursor: z.string().nullable() })
  .transform(({ entries, nextCursor }) => {
    const readable: CreditUsageEntry[] = [];
    for (const entry of entries) {
      const parsed = creditUsageEntrySchema.safeParse(entry);
      if (parsed.success) readable.push(parsed.data);
    }
    return { entries: readable, nextCursor, dropped: entries.length - readable.length };
  });
export type CreditUsageListRead = z.infer<typeof creditUsageListReadSchema>;

export const createCheckoutRequestSchema = z.object({
  planCode: z.string().min(1).max(64),
  rail: paymentRailSchema,
});
export type CreateCheckoutRequest = z.infer<typeof createCheckoutRequestSchema>;

/** Polar: the client opens the hosted checkout page. */
const polarCheckoutSchema = z.object({
  rail: z.literal('polar'),
  url: z.url(),
});

/** SePay: the client shows a VietQR for an exact amount and memo code, then polls the order. */
const sepayCheckoutSchema = z.object({
  rail: z.literal('sepay'),
  orderId: z.string().min(1),
  /** Memo code the transfer must carry; how the webhook finds the order. */
  orderCode: z.string().min(1),
  /** The exact amount the QR asks for, in whole đồng. */
  amountVnd: z.number().int().positive(),
  qrUrl: z.url(),
  /** ISO-8601 time the order stops being shown as payable. */
  expiresAt: z.iso.datetime(),
});

export const checkoutResponseSchema = z.discriminatedUnion('rail', [
  polarCheckoutSchema,
  sepayCheckoutSchema,
]);
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

/**
 * A payment order's state. `needs_review` is a paid transfer that was not
 * granted (wrong amount, unknown code, refused account); the owner resolves it
 * to `resolved_granted` or `resolved_dismissed`.
 */
export const checkoutOrderStatusSchema = z.enum([
  'pending',
  'paid',
  'expired',
  'needs_review',
  'resolved_granted',
  'resolved_dismissed',
]);
export type CheckoutOrderStatus = z.infer<typeof checkoutOrderStatusSchema>;

/** `GET /billing/orders/:id`: a SePay order as the QR panel polls it. */
export const checkoutOrderSchema = z.object({
  id: z.string().min(1),
  status: checkoutOrderStatusSchema,
  planCode: z.string().nullable(),
  amountVnd: z.number().int().nullable(),
  /** ISO-8601; when the QR stops being shown as payable. */
  expiresAt: z.iso.datetime(),
  /** ISO-8601; null until a transfer arrived. */
  paidAt: z.iso.datetime().nullable(),
});
export type CheckoutOrder = z.infer<typeof checkoutOrderSchema>;

/**
 * `GET /billing/portal`: a short-lived Polar customer-portal link. It signs
 * whoever holds it in to the subscription, so a client opens it once and never
 * stores it.
 */
export const billingPortalResponseSchema = z.object({ url: z.url() });
export type BillingPortalResponse = z.infer<typeof billingPortalResponseSchema>;
