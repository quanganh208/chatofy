import { leaseReserves } from './credit-balance-read';
import {
  availableSeconds,
  takeFromGrants,
  writeEntries,
} from './credit-grant-ops';
import { returnToGrants } from './credit-grant-return';
import type { NotOpen, SettleInput, SettleState } from './credit-ledger.port';
import { LEASE_AUDIO_SECONDS, LEASE_GRACE_MS } from './credit-pricing';
import { distributeRelease } from './credit-spend';
import { prepareUser } from './free-grant';
import type { LedgerTx } from './ledger-transaction';

// The lease steps `CreditLeases` composes into transactions. Each assumes the
// caller holds the lease owner's advisory lock.

export const NOT_OPEN: NotOpen = { state: 'not_open' };

/** Reason on the settle entry for consumption beyond everything the user had. */
export const OVERSHOOT_UNCOVERED = 'overshoot_uncovered';

/** A lease stays claimable for one lease length plus grace after its last activity. */
export function leaseExpiry(now: Date): Date {
  return new Date(now.getTime() + LEASE_AUDIO_SECONDS * 1000 + LEASE_GRACE_MS);
}

/** The CAS every mutation starts with: bumps the expiry only if the lease is still open. */
export async function touchIfOpen(
  tx: LedgerTx,
  leaseId: string,
  now: Date,
): Promise<boolean> {
  const done = await tx.creditLease.updateMany({
    where: { id: leaseId, status: 'open' },
    data: { expiresAt: leaseExpiry(now) },
  });
  return done.count === 1;
}

/** Moves up to `want` from the grants into the lease. Returns what it took. */
export function reserveForLease(
  tx: LedgerTx,
  userId: string,
  leaseId: string,
  want: number,
  keyBase: string,
  now: Date,
): Promise<number> {
  return takeFromGrants(tx, {
    userId,
    want,
    kind: 'reserve',
    keyBase,
    now,
    leaseId,
  });
}

/** Gives a closed or reaped lease's unspent holding back, newest reserve first. */
export async function releaseLease(
  tx: LedgerTx,
  userId: string,
  leaseId: string,
  now: Date,
): Promise<number> {
  const lease = await tx.creditLease.findUniqueOrThrow({
    where: { id: leaseId },
    select: { held: true, consumed: true },
  });
  const reserves = (await leaseReserves(tx, [leaseId])).get(leaseId) ?? [];
  const parts = distributeRelease(
    Math.max(0, lease.held - lease.consumed),
    reserves,
  ).map((part) => ({
    grantId: part.grantId,
    back: part.back,
    idempotencyKey: `release:${part.entryId}`,
  }));
  return returnToGrants(tx, { userId, kind: 'release', parts, now, leaseId });
}

/**
 * Records what a turn consumed on an open lease, under idempotency key `key`.
 * Spends the lease's holding first; anything beyond it is taken from the
 * grants, capped at what they hold, and any rest is recorded as
 * `overshoot_uncovered` — consumed but never charged, so the over-spend bound
 * stays measurable. A key already settled is reported, never written twice.
 */
export async function settleOnLease(
  tx: LedgerTx,
  userId: string,
  input: SettleInput & { key: string; freeAmount: number },
  now: Date,
): Promise<SettleState | NotOpen> {
  const seen = await tx.creditEntry.findUnique({
    where: { idempotencyKey: input.key },
    select: { amount: true },
  });
  if (seen) {
    return {
      state: 'ok',
      covered: -seen.amount,
      uncovered: 0,
      duplicate: true,
      available: await availableSeconds(tx, userId, now),
    };
  }
  if (!(await touchIfOpen(tx, input.leaseId, now))) return NOT_OPEN;
  const lease = await tx.creditLease.findUniqueOrThrow({
    where: { id: input.leaseId },
    select: { held: true, consumed: true },
  });
  const fromHold = Math.min(
    input.seconds,
    Math.max(0, lease.held - lease.consumed),
  );
  const over = input.seconds - fromHold;
  let extra = 0;
  if (over > 0) {
    await prepareUser(tx, userId, now, input.freeAmount);
    extra = await reserveForLease(
      tx,
      userId,
      input.leaseId,
      over,
      `${input.key}#reserve`,
      now,
    );
  }
  const uncovered = over - extra;
  await tx.creditLease.update({
    where: { id: input.leaseId },
    data: {
      held: { increment: extra },
      consumed: { increment: fromHold + extra },
    },
  });
  const base = {
    userId,
    leaseId: input.leaseId,
    kind: 'settle' as const,
    sessionId: input.sessionId,
    conversationId: input.conversationId ?? null,
  };
  await writeEntries(tx, [
    { ...base, amount: -(fromHold + extra), idempotencyKey: input.key },
    ...(uncovered > 0
      ? [
          {
            ...base,
            amount: -uncovered,
            idempotencyKey: `${input.key}#uncovered`,
            reason: OVERSHOOT_UNCOVERED,
          },
        ]
      : []),
  ]);
  return {
    state: 'ok',
    covered: fromHold + extra,
    uncovered,
    duplicate: false,
    available: await availableSeconds(tx, userId, now),
  };
}
