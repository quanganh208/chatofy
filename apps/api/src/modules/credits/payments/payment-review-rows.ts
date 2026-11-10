import type { LedgerTx } from '../ledger-transaction';

// Money that arrived and was not granted is never only logged: it becomes a
// `needs_review` PaymentOrder that `credits:resolve-payment` lists and settles.
// The row carries the payment's own reference (`sepay:tx:<id>`,
// `polar:order:<id>`), which is also the key a grant for it is written under,
// so a resolution and a later webhook retry cannot both grant.

/** Why a paid payment was not granted. */
export type PaymentReviewReason =
  | 'amount_mismatch'
  | 'unknown_code'
  | 'refused_allowlist'
  | 'user_mismatch'
  | 'unknown_product';

export interface PaymentReviewRow {
  provider: 'polar' | 'sepay';
  /** Null when no account could be trusted; the owner names one on resolve. */
  userId: string | null;
  /** The plan a resolve grants; null when none could be told from the payment. */
  planCode: string | null;
  /** What was paid, in the currency's minor unit (đồng, cents). */
  amountMinor: number;
  currency: string;
  /** Set for SePay, whose orders are priced in đồng. */
  paidAmountVnd?: number | null;
  externalRef: string;
  reason: PaymentReviewReason;
  now: Date;
}

/**
 * Writes the review row for a payment, once: a second delivery of the same
 * payment (a provider retry under a new delivery id) finds the row by its
 * reference and writes nothing. `ON CONFLICT DO NOTHING`, because a unique
 * violation would abort the caller's transaction. Returns the row's id.
 */
export async function recordPaymentReview(
  tx: LedgerTx,
  row: PaymentReviewRow,
): Promise<string> {
  const created = await tx.paymentOrder.createManyAndReturn({
    data: [
      {
        userId: row.userId,
        provider: row.provider,
        planCode: row.planCode,
        amountMinor: row.amountMinor,
        currency: row.currency,
        paidAmountVnd: row.paidAmountVnd ?? null,
        externalRef: row.externalRef,
        status: 'needs_review',
        reviewReason: row.reason,
        expiresAt: row.now,
        paidAt: row.now,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  if (created[0]) return created[0].id;
  const existing = await tx.paymentOrder.findUniqueOrThrow({
    where: { externalRef: row.externalRef },
    select: { id: true },
  });
  return existing.id;
}
