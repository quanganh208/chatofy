import { CREDIT_SECONDS_PER_CREDIT } from '@chatofy/types';
import type { GrantInput, GrantSource } from './credit-ledger.port';
import type { LedgerTx } from './ledger-transaction';
import type { PlanRow } from './plan-catalog';

// What buying a plan grants, outside a provider's own period: a SePay transfer
// and an owner-resolved payment both build their grant here, so the two cannot
// drift on amount, expiry or the pass's subscription view.

const DAY_MS = 86_400_000;

/** Plan kinds that can be granted by a payment. */
export function isGrantablePlan(
  plan: PlanRow | undefined,
): plan is PlanRow & { kind: Exclude<GrantSource, 'free'> } {
  return (
    plan !== undefined &&
    ['subscription', 'pass', 'topup', 'promo'].includes(plan.kind)
  );
}

/**
 * The grant for one purchase of `plan` paid at `now`: a plan with a period
 * runs from now for `periodDays`, anything else never expires.
 */
export function grantForPlan(
  plan: PlanRow & { kind: Exclude<GrantSource, 'free'> },
  purchase: {
    userId: string;
    now: Date;
    externalRef: string;
    costBasis: number;
    currency: string;
    reason: string;
  },
): GrantInput {
  const expiresAt = plan.periodDays
    ? new Date(purchase.now.getTime() + plan.periodDays * DAY_MS)
    : null;
  return {
    userId: purchase.userId,
    source: plan.kind,
    planCode: plan.code,
    amount: plan.credits * CREDIT_SECONDS_PER_CREDIT,
    startsAt: expiresAt ? purchase.now : null,
    expiresAt,
    costBasis: purchase.costBasis,
    currency: purchase.currency,
    externalRef: purchase.externalRef,
    reason: purchase.reason,
  };
}

/** The account's SePay pass state, for the subscription view: the latest end wins. */
export async function extendPass(
  tx: LedgerTx,
  userId: string,
  now: Date,
  end: Date,
): Promise<void> {
  const externalId = `sepay:pass:${userId}`;
  const stored = await tx.subscription.findUnique({
    where: { externalId },
    select: { currentPeriodEnd: true },
  });
  const currentPeriodEnd =
    stored?.currentPeriodEnd && stored.currentPeriodEnd > end
      ? stored.currentPeriodEnd
      : end;
  await tx.subscription.upsert({
    where: { externalId },
    create: {
      userId,
      provider: 'sepay',
      externalId,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd,
      providerUpdatedAt: now,
    },
    update: { status: 'active', currentPeriodEnd, providerUpdatedAt: now },
  });
}
