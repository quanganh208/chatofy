// Backend-agnostic store for a session's meeting minutes, mirroring the
// SessionStore seam: the default is in-memory (dev/test), and a PrismaMinutes
// store can replace it without touching the service or controller.
import type { MeetingMinutes } from '@chatofy/types';

/** DI injection token for the minutes store. */
export const MINUTES_STORE = Symbol('MINUTES_STORE');

/**
 * One (owner, session) pair has at most one minutes artifact. A regeneration
 * OVERWRITES rather than appends — the minutes are a view of the conversation,
 * not a log of attempts, so keeping every draft would be storing history nobody
 * asked for.
 *
 * Every method is scoped by `ownerId` — the authenticated caller's user id, read
 * from the verified token, never from the request body or path. This is the
 * store-level half of the ownership guarantee: a caller can only ever read or
 * replace minutes it generated, so a `sessionId` guessed or copied from another
 * user resolves to `null` here rather than to their minutes. Two users may hold
 * separate minutes under the same `sessionId` without collision.
 */
export interface MinutesStore {
  /** The caller's minutes for a session, or null if they have generated none. */
  get(ownerId: string, sessionId: string): Promise<MeetingMinutes | null>;
  /** Create or replace the caller's minutes for a session; returns what was stored. */
  put(ownerId: string, minutes: MeetingMinutes): Promise<MeetingMinutes>;
}
