import { z } from 'zod';
import { orderCodePattern } from './sepay-provider';
import type { PaymentReviewReason } from './payment-review-rows';

// The SePay bank-transaction webhook as this app reads it. `id` is SePay's
// transaction id, identical across retries and replays, so it is both the
// dedup key and the grant's idempotency key (`sepay:tx:<id>`).

export const sepayTransferSchema = z.object({
  id: z.union([z.number().int(), z.string().regex(/^\d+$/)]).transform(String),
  transferType: z.string(),
  transferAmount: z.number().int().nonnegative(),
  /** Filled only when the account's payment-code structure is configured. */
  code: z.string().nullish(),
  content: z.string().nullish(),
  transactionDate: z.string().nullish(),
});
export type SepayTransfer = z.infer<typeof sepayTransferSchema>;

/**
 * The order code a transfer carries: SePay's extracted `code` when it matches
 * our shape, else the first match in the memo text. Banks change a memo's case
 * and may glue words to it, so the match is case-insensitive and unanchored;
 * the code is stored upper case, so the result is too.
 */
export function orderCodeOf(
  transfer: Pick<SepayTransfer, 'code' | 'content'>,
  prefix: string,
): string | null {
  const pattern = orderCodePattern(prefix);
  for (const text of [transfer.code, transfer.content]) {
    const match = text ? pattern.exec(text) : null;
    if (match) return match[0].toUpperCase();
  }
  return null;
}

export type ReviewReason = Extract<
  PaymentReviewReason,
  'amount_mismatch' | 'unknown_code' | 'refused_allowlist'
>;

/** What a matched order's transfer should do, before any write. */
export type TransferDecision =
  | { action: 'grant'; lateBySeconds: number }
  | { action: 'review'; reason: ReviewReason };

/**
 * A transfer that found its order. The exact amount is required — the QR asks
 * for it — and the buyer must still be allowlisted. Lateness never refuses:
 * the code and amount are the payer's own, so a payment made after the QR
 * expired is still granted, and only logged as late.
 */
export function decideTransfer(
  order: { amountVnd: number | null; expiresAt: Date },
  transfer: Pick<SepayTransfer, 'transferAmount'>,
  allowlisted: boolean,
  now: Date,
): TransferDecision {
  if (order.amountVnd === null || transfer.transferAmount !== order.amountVnd) {
    return { action: 'review', reason: 'amount_mismatch' };
  }
  if (!allowlisted) return { action: 'review', reason: 'refused_allowlist' };
  const lateMs = now.getTime() - order.expiresAt.getTime();
  return {
    action: 'grant',
    lateBySeconds: Math.max(0, Math.round(lateMs / 1000)),
  };
}
