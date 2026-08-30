// Backend-agnostic store for a session's meeting minutes, mirroring the
// SessionStore seam: the default is in-memory (dev/test), and a PrismaMinutes
// store can replace it without touching the service or controller.
import type { MeetingMinutes } from '@chatofy/types';

/** DI injection token for the minutes store. */
export const MINUTES_STORE = Symbol('MINUTES_STORE');

/**
 * One session has at most one minutes artifact, keyed by session id. A
 * regeneration OVERWRITES rather than appends — the minutes are a view of the
 * conversation, not a log of attempts, so keeping every draft would be storing
 * history nobody asked for.
 */
export interface MinutesStore {
  /** The minutes for a session, or null if none have been generated. */
  get(sessionId: string): Promise<MeetingMinutes | null>;
  /** Create or replace the minutes for a session; returns what was stored. */
  put(minutes: MeetingMinutes): Promise<MeetingMinutes>;
}
