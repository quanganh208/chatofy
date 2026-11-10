import type { LedgerTx } from '../ledger-transaction';
import {
  recordPaymentReview,
  type PaymentReviewReason,
} from './payment-review-rows';
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
 * already paid or reviewed) the extra money gets a review row of its own.
 *
 * The order keeps the plan it was created for, so a later transfer of the
 * right amount still buys that plan; resolving a wrong amount grants the plan
 * priced at what was paid instead (see `resolvePayment`). A row of its own is
 * filed under that paid-for plan directly. Returns the review row's id.
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

/** The order fields settling it reads. */
export interface SepaySettledOrder {
  id: string;
  userId: string | null;
  planCode: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  externalRef: string | null;
  paidAmountVnd: number | null;
  reviewReason: string | null;
  paidAt: Date | null;
}

/**
 * Marks the order paid by the transfer that was just granted for it.
 *
 * An order still under review (an earlier transfer for it had the wrong amount
 * or was refused) is settled as well: left in review, resolving it would grant
 * the plan a second time under the earlier transfer's reference, which the
 * grant's idempotency key cannot catch. That earlier transfer is real money,
 * so it keeps a review row of its own, under its own reference and filed under
 * the plan its amount buys, written after the order gives that reference up.
 */
export async function settleSepayOrder(
  tx: LedgerTx,
  order: SepaySettledOrder,
  transfer: SepayTransfer,
  ref: string,
  now: Date,
  planCodeForAmount: (amountVnd: number) => Promise<string | null>,
): Promise<void> {
  const settled = await tx.paymentOrder.updateMany({
    where: {
      id: order.id,
      status: { in: [...OPEN_SEPAY_ORDER_STATUSES, 'needs_review'] },
    },
    data: {
      status: 'paid',
      reviewReason: null,
      paidAt: now,
      paidAmountVnd: transfer.transferAmount,
      externalRef: ref,
    },
  });
  const earlierRef = order.externalRef;
  if (
    settled.count !== 1 ||
    order.status !== 'needs_review' ||
    !earlierRef ||
    earlierRef === ref
  ) {
    return;
  }
  await recordPaymentReview(tx, {
    provider: 'sepay',
    userId: order.userId,
    planCode:
      order.reviewReason === 'amount_mismatch' && order.paidAmountVnd !== null
        ? await planCodeForAmount(order.paidAmountVnd)
        : order.planCode,
    amountMinor: order.paidAmountVnd ?? order.amountMinor,
    currency: order.currency,
    paidAmountVnd: order.paidAmountVnd,
    externalRef: earlierRef,
    // The column is written only from `PaymentReviewReason`.
    reason: (order.reviewReason ?? 'amount_mismatch') as PaymentReviewReason,
    now: order.paidAt ?? now,
  });
}
