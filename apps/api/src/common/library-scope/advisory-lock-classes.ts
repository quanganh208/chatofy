/**
 * The first int of every two-int `pg_advisory_xact_lock(int, int)` this API
 * takes, one per resource.
 *
 * These share one key space with the conversation store's own constant
 * (`prisma-conversation.store.ts`, 8155), which keeps its local copy; the
 * credits ledger uses the one-bigint form, which is a separate key space.
 *
 * A library resource has ONE class for every scope, keyed by
 * `hashtext(scopeLockKey(scope))`: a personal key is a user cuid and a team key
 * is a team cuid, ids of different tables that never meet by design, so a
 * `hashtext` collision only costs a spurious wait, never a missed exclusion.
 *
 * `TEAM_MEMBERSHIP` is keyed by `hashtext(teamId)` for a team's members and
 * invites, and by `hashtext(userId)` for one user's membership and invite
 * counts. When both are taken, the user key is always taken first.
 */
export const LOCK_CLASS = {
  CONTEXTS: 8154,
  CONVERSATIONS: 8155,
  GLOSSARIES: 8157,
  TEAM_MEMBERSHIP: 8159,
} as const;
