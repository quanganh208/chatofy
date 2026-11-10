import type { GrantSource, LedgerBalance } from './credit-ledger.port';
import { distributeRelease, type LeaseReserve } from './credit-spend';

/** A live grant as the balance reads it. */
export interface BalanceGrant {
  id: string;
  source: string;
  remaining: number;
  expiresAt: Date | null;
}

/** An open lease and its reserves, for adding its unspent holding back. */
export interface BalanceLease {
  held: number;
  consumed: number;
  reserves: LeaseReserve[];
}

/** Sources that reset with a period; everything else never expires. */
const PLAN_SOURCES: ReadonlySet<string> = new Set<GrantSource>([
  'free',
  'subscription',
  'pass',
]);
const PRO_SOURCES: ReadonlySet<string> = new Set<GrantSource>([
  'subscription',
  'pass',
]);

/**
 * The balance a person is shown.
 *
 * `grants` must already be the live ones (active, unexpired). Held credit is out
 * of `remaining`, so each open lease's unspent part is attributed back to the
 * grants that funded it — the same split a release would make — and counted in
 * that grant's bucket. Without that, an open but idle socket would look like
 * credit spent.
 */
export function summarizeBalance(
  grants: readonly BalanceGrant[],
  leases: readonly BalanceLease[],
  now: Date,
): LedgerBalance {
  const heldByGrant = new Map<string, number>();
  let held = 0;
  for (const lease of leases) {
    const unspent = Math.max(0, lease.held - lease.consumed);
    held += unspent;
    for (const part of distributeRelease(unspent, lease.reserves)) {
      heldByGrant.set(
        part.grantId,
        (heldByGrant.get(part.grantId) ?? 0) + part.back,
      );
    }
  }

  let available = 0;
  let planSeconds = 0;
  let topupSeconds = 0;
  let planResetsAt: Date | null = null;
  let pro: BalanceGrant | null = null;
  const live = new Set<string>();
  for (const grant of grants) {
    live.add(grant.id);
    available += grant.remaining;
    const withHeld = grant.remaining + (heldByGrant.get(grant.id) ?? 0);
    if (PLAN_SOURCES.has(grant.source)) {
      planSeconds += withHeld;
      if (
        grant.expiresAt &&
        (!planResetsAt || grant.expiresAt < planResetsAt)
      ) {
        planResetsAt = grant.expiresAt;
      }
    } else {
      topupSeconds += withHeld;
    }
    if (
      PRO_SOURCES.has(grant.source) &&
      grant.expiresAt &&
      grant.expiresAt > now &&
      (!pro || (pro.expiresAt && grant.expiresAt > pro.expiresAt))
    ) {
      pro = grant;
    }
  }
  // Held credit from a grant that has since expired is still the user's until
  // the lease settles or closes; count it as plan credit rather than drop it.
  for (const [grantId, amount] of heldByGrant) {
    if (!live.has(grantId)) planSeconds += amount;
  }

  return {
    available,
    held,
    planSeconds,
    topupSeconds,
    planResetsAt,
    plan: pro ? 'pro' : 'free',
    proSource: pro ? (pro.source as 'subscription' | 'pass') : null,
  };
}
