import { createHash, randomBytes } from 'node:crypto';

/**
 * How long a refresh FAMILY lives, absolute, from the moment it is minted.
 *
 * One refresh number, not two. An idle window and an absolute window both set
 * to 30 days makes the idle one dead code, and choosing a different pair would
 * be inventing product policy this change was not asked for. The web session
 * cookie is set to the same 30 days so the two cannot disagree about when a
 * session is over.
 */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * How long a SPENT refresh token is still honoured.
 *
 * A simultaneity bound, NOT a theft-detection knob. `getSession()` is not
 * deduped and is called per request, so one screen can fire several refreshes
 * at once; without this, all but one would 401 and the last cookie write might
 * be the errored one — a mass logout on every refresh.
 *
 * The rule that fixes the number: it must exceed the web client's 5 s abort
 * plus in-flight skew, so every member of one burst — including a member that
 * timed out and re-signed the stale cookie — lands inside the window. 10 s
 * does. Raising it buys nothing and only widens the thief-in-burst blind spot,
 * because what actually detects theft is lineage (`gen`/`epoch`), not the
 * clock — see the Lua script's header.
 */
export const ROTATION_GRACE_SECONDS = 10;

/**
 * A new refresh token: 256 bits of machine entropy, base64url.
 *
 * Well past RFC 6749 §10.10's 128-bit floor. It is opaque — no subject, no
 * expiry, nothing a client or a thief can read out of it. Only the SHA-256 of
 * it is ever stored, so possession of the database is possession of hashes.
 */
export function mintRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The at-rest form. SHA-256 hex, and deliberately NOT argon2.
 *
 * OWASP reserves slow hashing for human-memorised secrets, where the point is
 * to price up guessing a small search space. Against 256 bits of `randomBytes`
 * there is no search space to price up, and argon2 at its configured cost would
 * put 64 MiB of work per refresh on the same libuv threadpool the translate
 * pipeline contends for (see `auth.controller.ts`).
 */
export function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** The Redis key holding one token's record. */
export function tokenKey(tokenHash: string): string {
  return `rt:${tokenHash}`;
}

/** The Redis key holding one family's record. */
export function familyKey(familyId: string): string {
  return `rtfam:${familyId}`;
}
