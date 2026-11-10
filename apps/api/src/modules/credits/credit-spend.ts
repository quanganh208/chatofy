// Pure credit arithmetic shared by the Prisma ledger and the in-memory one, so
// both spend and give back in exactly the same order.

/** The fields of a grant that decide which one is spent first. */
export interface SpendableGrant {
  id: string;
  remaining: number;
  expiresAt: Date | null;
  costBasis: number;
  createdAt: Date;
}

export interface Allocation {
  grantId: string;
  take: number;
}

/**
 * Spend order: soonest-expiring first (never-expiring last), then free before
 * paid when expiry ties, then oldest first, then id so the order is total. It
 * is the same order as the ledger's `ORDER BY "expiresAt" ASC NULLS LAST,
 * ("costBasis" > 0) ASC, "createdAt" ASC, id ASC`.
 */
export function compareSpendOrder(
  a: SpendableGrant,
  b: SpendableGrant,
): number {
  const ea = a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const eb = b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (ea !== eb) return ea < eb ? -1 : 1;
  const pa = a.costBasis > 0 ? 1 : 0;
  const pb = b.costBasis > 0 ? 1 : 0;
  if (pa !== pb) return pa - pb;
  const ca = a.createdAt.getTime();
  const cb = b.createdAt.getTime();
  if (ca !== cb) return ca - cb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Takes up to `amount` credit-seconds across `grants` in spend order. Never
 * takes more than a grant holds, so the sum of `take` is
 * `min(amount, total remaining)`; the caller decides whether a short allocation
 * is acceptable (a lease shrinks to it, a debit refuses it).
 */
export function allocate(
  amount: number,
  grants: readonly SpendableGrant[],
): Allocation[] {
  assertCreditSeconds(amount, 'amount');
  const out: Allocation[] = [];
  let left = amount;
  for (const grant of [...grants].sort(compareSpendOrder)) {
    if (left === 0) break;
    if (grant.remaining <= 0) continue;
    const take = Math.min(left, grant.remaining);
    out.push({ grantId: grant.id, take });
    left -= take;
  }
  return out;
}

/** A `reserve` entry of one lease: `take` credit-seconds held from one grant. */
export interface LeaseReserve {
  entryId: string;
  grantId: string;
  take: number;
  createdAt: Date;
}

export interface ReleasePart {
  entryId: string;
  grantId: string;
  back: number;
}

/**
 * Splits a lease's unspent holding back over the grants that funded it, newest
 * reserve first: what a lease consumed is treated as coming from its oldest
 * reserves, so the credit that goes back is the credit taken last.
 */
export function distributeRelease(
  unspent: number,
  reserves: readonly LeaseReserve[],
): ReleasePart[] {
  assertCreditSeconds(unspent, 'unspent');
  const newestFirst = [...reserves].sort((a, b) => {
    const d = b.createdAt.getTime() - a.createdAt.getTime();
    if (d !== 0) return d;
    return a.entryId < b.entryId ? 1 : a.entryId > b.entryId ? -1 : 0;
  });
  const out: ReleasePart[] = [];
  let left = unspent;
  for (const reserve of newestFirst) {
    if (left === 0) break;
    const back = Math.min(left, reserve.take);
    if (back > 0)
      out.push({ entryId: reserve.entryId, grantId: reserve.grantId, back });
    left -= back;
  }
  return out;
}

/** Credit-seconds are whole and never negative; anything else is a caller bug. */
export function assertCreditSeconds(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${name} must be a non-negative integer of credit-seconds, got ${value}`,
    );
  }
}
