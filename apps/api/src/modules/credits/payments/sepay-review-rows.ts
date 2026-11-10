import type { LedgerTx } from '../ledger-transaction';
import { recordPaymentReview } from './payment-review-rows';
import type { ReviewReason, SepayTransfer } from './sepay-webhook-payload';

/** An order a transfer may still settle; anything else already has its outcome. */
export const OPEN_SEPAY_ORDER_STATUSES = ['pending', 'expired'];

/** The order fields a review reads. */
export interface SepayReviewOrder {
  id: string;
  userId: string | null;
  planCode: string | null;
  amountVnd: number | null;
}

/** A transfer recorded for review on a row of its own, keyed on its reference. */
export function recordSepayReview(
  tx: LedgerTx,
  transfer: SepayTransfer,
  ref: string,
  now: Date,
  row: { userId: string | null; planCode: string | null; reason: ReviewReason },
): Promise<string> {
  return recordPaymentReview(tx, {
    provider: 'sepay',
    ...row,
    amountMinor: transfer.transferAmount,
    currency: 'VND',
    paidAmountVnd: transfer.transferAmount,
    externalRef: ref,
    now,
  });
}

/**
 * Marks the order itself for review when it is still open; otherwise (it was
 * already paid or reviewed) the extra money gets a review row of its own. A
 * wrong amount is filed under the plan priced at what was actually paid, so
 * the owner can grant it without naming one. Returns the review row's id.
 */
export async function markSepayReview(
  tx: LedgerTx,
  input: {
    order: SepayReviewOrder;
    transfer: SepayTransfer;
    ref: string;
    now: Date;
    reason: ReviewReason;
    planCodeForAmount: (amountVnd: number) => Promise<string | null>;
  },
): Promise<string> {
  const { order, transfer, ref, now, reason } = input;
  const marked = await tx.paymentOrder.updateMany({
    where: { id: order.id, status: { in: OPEN_SEPAY_ORDER_STATUSES } },
    data: {
      status: 'needs_review',
      reviewReason: reason,
      paidAmountVnd: transfer.transferAmount,
      paidAt: now,
      externalRef: ref,
    },
  });
  if (marked.count === 1) return order.id;
  return recordSepayReview(tx, transfer, ref, now, {
    userId: order.userId,
    planCode:
      reason === 'amount_mismatch'
        ? await input.planCodeForAmount(transfer.transferAmount)
        : order.planCode,
    reason,
  });
}
