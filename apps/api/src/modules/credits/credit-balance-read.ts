import { summarizeBalance } from './credit-balance';
import type { LedgerBalance } from './credit-ledger.port';
import type { LeaseReserve } from './credit-spend';
import type { LedgerTx } from './ledger-transaction';

// Reads over a user's grants and leases that write nothing: the balance a
// person is shown, and the reserve entries a release or the balance splits.

/** A lease's reserve entries, as `distributeRelease` reads them. */
export async function leaseReserves(
  tx: LedgerTx,
  leaseIds: string[],
): Promise<Map<string, LeaseReserve[]>> {
  const out = new Map<string, LeaseReserve[]>();
  if (leaseIds.length === 0) return out;
  const rows = await tx.creditEntry.findMany({
    where: { leaseId: { in: leaseIds }, kind: 'reserve' },
    select: {
      id: true,
      leaseId: true,
      grantId: true,
      amount: true,
      createdAt: true,
    },
  });
  for (const row of rows) {
    if (!row.leaseId || !row.grantId) continue;
    const list = out.get(row.leaseId) ?? [];
    list.push({
      entryId: row.id,
      grantId: row.grantId,
      take: -row.amount,
      createdAt: row.createdAt,
    });
    out.set(row.leaseId, list);
  }
  return out;
}

/**
 * The balance as of `now`. Grants past their expiry are left out whether or
 * not they have been marked expired yet, so this needs no write first.
 */
export async function readBalance(
  tx: LedgerTx,
  userId: string,
  now: Date,
): Promise<LedgerBalance> {
  const grants = await tx.creditGrant.findMany({
    where: {
      userId,
      status: 'active',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true, source: true, remaining: true, expiresAt: true },
  });
  const leases = await tx.creditLease.findMany({
    where: { userId, status: 'open' },
    select: { id: true, held: true, consumed: true },
  });
  const reserves = await leaseReserves(
    tx,
    leases.map((lease) => lease.id),
  );
  return summarizeBalance(
    grants,
    leases.map((lease) => ({
      ...lease,
      reserves: reserves.get(lease.id) ?? [],
    })),
    now,
  );
}
