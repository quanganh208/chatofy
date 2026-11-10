import {
  billingMonthKey,
  billingMonthStart,
  nextBillingMonthStart,
} from './billing-period';
import { expireDueGrants, writeEntries } from './credit-grant-ops';
import type { LedgerTx } from './ledger-transaction';

// The monthly Free allowance and the "is this account Pro" question it hangs on.

/**
 * How long a Polar subscription still counts as Pro after its stored period
 * ended. Polar charges at the period end, so the renewal's `order.paid` lands
 * seconds to minutes later — days during dunning, which moves the status off
 * `active`. Without this, a read in that gap would mint a full Free grant to
 * someone about to receive their next Pro period.
 */
export const PRO_RENEWAL_GRACE_MS = 48 * 3_600_000;

/** Subscription states Polar still charges for. */
const RENEWING_STATUSES = ['active', 'trialing'];

/** The `externalRef` of `userId`'s Free grant for the billing month of `now`. */
export function freeGrantRef(userId: string, now: Date): string {
  return `free:${userId}:${billingMonthKey(now)}`;
}

/**
 * Whether the account is Pro for the Free rule: a live subscription or pass
 * grant, or a Polar subscription that is renewing (active, not set to cancel)
 * whose period ended less than {@link PRO_RENEWAL_GRACE_MS} ago.
 */
async function isPro(
  tx: LedgerTx,
  userId: string,
  now: Date,
): Promise<boolean> {
  const grant = await tx.creditGrant.findFirst({
    where: {
      userId,
      status: 'active',
      source: { in: ['subscription', 'pass'] },
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  if (grant) return true;
  const renewing = await tx.subscription.findFirst({
    where: {
      userId,
      provider: 'polar',
      status: { in: RENEWING_STATUSES },
      cancelAtPeriodEnd: false,
      currentPeriodEnd: { gt: new Date(now.getTime() - PRO_RENEWAL_GRACE_MS) },
    },
    select: { id: true },
  });
  return renewing !== null;
}

/**
 * Writes this month's Free grant unless it exists or the account is Pro.
 *
 * `ON CONFLICT DO NOTHING` on `externalRef = free:<userId>:<YYYY-MM>` makes it
 * idempotent with or without the user lock: two writers race to one row, and
 * only the winner writes the `grant` entry. Without the lock the Pro check and
 * the insert are not one step, and the worst case is the one the rule already
 * accepts — a Free grant written just before Pro started, left alone to expire
 * on its own date. There is no rollover: last month's grant expires by its own
 * `expiresAt`. The existence check comes first so the common case is one read.
 */
export async function ensureFreeGrant(
  tx: LedgerTx,
  userId: string,
  now: Date,
  amount: number,
): Promise<string | null> {
  if (amount <= 0) return null;
  const externalRef = freeGrantRef(userId, now);
  const existing = await tx.creditGrant.findUnique({
    where: { externalRef },
    select: { id: true },
  });
  if (existing) return null;
  if (await isPro(tx, userId, now)) return null;
  const created = await tx.creditGrant.createManyAndReturn({
    data: [
      {
        userId,
        source: 'free',
        planCode: 'free',
        amount,
        remaining: amount,
        startsAt: billingMonthStart(now),
        expiresAt: nextBillingMonthStart(now),
        costBasis: 0,
        externalRef,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  const grantId = created[0]?.id;
  if (!grantId) return null;
  await writeEntries(tx, [
    {
      userId,
      grantId,
      kind: 'grant',
      amount,
      idempotencyKey: `grant:${externalRef}`,
    },
  ]);
  return grantId;
}

/**
 * Expiry, then the Free grant: the state every spend starts from. Needs the
 * user lock (expiry writes off a grant a reserve may be taking from).
 */
export async function prepareUser(
  tx: LedgerTx,
  userId: string,
  now: Date,
  freeAmount: number,
): Promise<void> {
  await expireDueGrants(tx, userId, now);
  await ensureFreeGrant(tx, userId, now, freeAmount);
}
