// Backend-agnostic store for a conversation's meeting minutes.
//
// The token and the interface survive the removal of the env switch that used to
// choose between them, deliberately: what was wrong was letting a DEPLOYMENT
// decide whether minutes are durable — the default kept nothing — not the seam
// itself. The seam is what lets a test substitute a double, and
// `apps/api/test/utils/in-memory-minutes.store.ts` is the one caller that does.
import type { MeetingMinutes } from '@chatofy/types';

/** DI injection token for the minutes store. */
export const MINUTES_STORE = Symbol('MINUTES_STORE');

/**
 * One conversation has at most one minutes artifact. A regeneration OVERWRITES
 * rather than appends — the minutes are a view of the conversation, not a log of
 * attempts.
 *
 * This comment used to add that keeping every draft "would be storing history
 * nobody asked for". History was subsequently asked for, and it is the
 * TRANSCRIPT: the conversation itself is stored, and the minutes remain one
 * derived view of it that a regenerate replaces.
 *
 * Every method is scoped by `ownerId` — the authenticated caller's user id, read
 * from the verified token, never from the request body or path — and
 * `conversationId` throughout is the CLIENT-minted id that appears in URLs, not
 * the conversation row's server cuid.
 *
 * **That distinction is the ownership guarantee, and it is easy to lose.** The
 * old `(ownerId, sessionId)` compound key made the owner column impossible to
 * omit. Here the minutes row is keyed by the conversation's cuid alone, so the
 * shortest query that compiles — `findUnique({ where: { conversationId } })`
 * with a route parameter — is an ownership-free read of ANY user's minutes, and
 * it would even pass a 404 test that seeds a client id, because the two ids
 * differ. An implementation must resolve the conversation by
 * `(ownerId, clientId)` first. `prisma-minutes.store.spec.ts` is what holds that
 * down: it asserts the owner reaches the CONVERSATION query as
 * `ownerId_clientId` and that the minutes row is keyed by what that resolution
 * returned, which is the shape a shortcut cannot satisfy.
 */
export interface MinutesStore {
  /** The caller's minutes for a conversation, or null if none exist. */
  get(ownerId: string, conversationId: string): Promise<MeetingMinutes | null>;
  /**
   * Create or replace the caller's minutes for a conversation.
   *
   * Throws `NotFoundException` when the caller owns no such conversation. A
   * write against a missing parent is an FK violation the caller would otherwise
   * see as a 500 — and after the re-key it is reachable, because the user can
   * delete the conversation while a generation is in flight.
   */
  put(ownerId: string, minutes: MeetingMinutes): Promise<MeetingMinutes>;
}
