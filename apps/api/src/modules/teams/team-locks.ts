import type { Prisma } from '@prisma/client';
import { LOCK_CLASS } from '../../common/library-scope/advisory-lock-classes';

/**
 * Transaction-scoped locks over team membership, both in the ONE class
 * `LOCK_CLASS.TEAM_MEMBERSHIP`.
 *
 * - {@link lockTeam} guards one team's members and invites (seat counts, role
 *   changes, removals, deletion).
 * - {@link lockUser} guards one user's membership and invite counts (the
 *   per-user team cap, the per-inviter daily cap).
 *
 * **Order rule:** when a transaction needs both, it calls `lockUser` FIRST and
 * then `lockTeam`. One fixed order is what rules out a deadlock between two
 * transactions that each hold one key. Team and user keys are cuids of
 * different tables, so they never meet by design; a `hashtext` collision only
 * costs a spurious wait.
 */
export async function lockTeam(
  tx: Prisma.TransactionClient,
  teamId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_CLASS.TEAM_MEMBERSHIP}::int, hashtext(${teamId}))`;
}

/** See {@link lockTeam}; always taken before the team key. */
export async function lockUser(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_CLASS.TEAM_MEMBERSHIP}::int, hashtext(${userId}))`;
}
