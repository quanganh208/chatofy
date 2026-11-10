import { allocate, type SpendableGrant } from './credit-spend';
import type { LedgerTx } from './ledger-transaction';

// The grant-level steps every ledger transaction is built from. Each one
// assumes the caller already holds the user's advisory lock
// (`runLedgerTransaction`), which is what makes read-then-write safe here.

export type EntryKind =
  | 'grant'
  | 'reserve'
  | 'release'
  | 'settle'
  | 'debit'
  | 'refund'
  | 'expire'
  | 'void';

export interface EntryWrite {
  userId: string;
  kind: EntryKind;
  amount: number;
  idempotencyKey: string;
  grantId?: string | null;
  leaseId?: string | null;
  sessionId?: string | null;
  conversationId?: string | null;
  reason?: string | null;
}

export async function writeEntries(
  tx: LedgerTx,
  entries: EntryWrite[],
): Promise<void> {
  if (entries.length > 0) await tx.creditEntry.createMany({ data: entries });
}

/** The key of the n-th entry (0-based) one operation writes: the base, then `#2`, `#3`… */
export function nthKey(base: string, index: number): string {
  return index === 0 ? base : `${base}#${index + 1}`;
}

/** Writes off what a grant still holds and marks it expired. */
export async function expireGrant(
  tx: LedgerTx,
  userId: string,
  grant: { id: string; remaining: number },
): Promise<void> {
  await writeEntries(tx, [
    {
      userId,
      grantId: grant.id,
      kind: 'expire',
      amount: -grant.remaining,
      idempotencyKey: `expire:${grant.id}`,
    },
  ]);
  await tx.creditGrant.update({
    where: { id: grant.id },
    data: { remaining: 0, status: 'expired' },
  });
}

/** Expires every active grant of the user whose `expiresAt` has passed. */
export async function expireDueGrants(
  tx: LedgerTx,
  userId: string,
  now: Date,
): Promise<number> {
  const due = await tx.creditGrant.findMany({
    where: { userId, status: 'active', expiresAt: { lte: now } },
    select: { id: true, remaining: true },
  });
  for (const grant of due) await expireGrant(tx, userId, grant);
  return due.length;
}

/** The user's spendable grants, row-locked, in spend order. */
async function lockSpendableGrants(
  tx: LedgerTx,
  userId: string,
  now: Date,
): Promise<SpendableGrant[]> {
  return tx.$queryRaw<SpendableGrant[]>`
    SELECT id, remaining, "expiresAt", "costBasis", "createdAt"
    FROM "CreditGrant"
    WHERE "userId" = ${userId}
      AND status = 'active'
      AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
      AND remaining > 0
    ORDER BY "expiresAt" ASC NULLS LAST, ("costBasis" > 0) ASC, "createdAt" ASC, id ASC
    FOR UPDATE`;
}

/** Spendable credit-seconds outside any lease. */
export async function availableSeconds(
  tx: LedgerTx,
  userId: string,
  now: Date,
): Promise<number> {
  const sum = await tx.creditGrant.aggregate({
    where: {
      userId,
      status: 'active',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    _sum: { remaining: true },
  });
  return sum._sum.remaining ?? 0;
}

export interface TakeInput {
  userId: string;
  want: number;
  kind: 'reserve' | 'debit';
  keyBase: string;
  now: Date;
  leaseId?: string | null;
  sessionId?: string | null;
  conversationId?: string | null;
  reason?: string | null;
}

/** Takes up to `want` from the grants in spend order, one entry per grant. Returns what it took. */
export async function takeFromGrants(
  tx: LedgerTx,
  input: TakeInput,
): Promise<number> {
  if (input.want === 0) return 0;
  const grants = await lockSpendableGrants(tx, input.userId, input.now);
  const allocations = allocate(input.want, grants);
  let taken = 0;
  const entries: EntryWrite[] = [];
  for (const [index, { grantId, take }] of allocations.entries()) {
    await tx.creditGrant.update({
      where: { id: grantId },
      data: { remaining: { decrement: take } },
    });
    entries.push({
      userId: input.userId,
      grantId,
      leaseId: input.leaseId ?? null,
      kind: input.kind,
      amount: -take,
      idempotencyKey: nthKey(input.keyBase, index),
      sessionId: input.sessionId ?? null,
      conversationId: input.conversationId ?? null,
      reason: input.reason ?? null,
    });
    taken += take;
  }
  await writeEntries(tx, entries);
  return taken;
}
