import { Injectable } from '@nestjs/common';
import type { MeetingMinutes } from '@chatofy/types';
import type { MinutesStore } from '../interfaces/minutes-store.interface';

/**
 * Process-local minutes store — dev and test default.
 *
 * State lives in one process and dies with it. That is fine for the current
 * client-submits-the-transcript flow (the minutes are derived on demand from a
 * payload the client still holds), and is the seam a PrismaMinutesStore fills
 * when minutes need to outlive a restart or be read on another instance.
 */
@Injectable()
export class MemoryMinutesStore implements MinutesStore {
  // Keyed by owner AND session so one user's minutes can never be read under
  // another user's request. `ownerId` comes first because it is the security
  // boundary — the same reason the interface takes it as a separate argument
  // rather than folding it into the record.
  private readonly byOwnerSession = new Map<string, MeetingMinutes>();

  get(ownerId: string, sessionId: string): Promise<MeetingMinutes | null> {
    return Promise.resolve(
      this.byOwnerSession.get(key(ownerId, sessionId)) ?? null,
    );
  }

  put(ownerId: string, minutes: MeetingMinutes): Promise<MeetingMinutes> {
    this.byOwnerSession.set(key(ownerId, minutes.sessionId), minutes);
    return Promise.resolve(minutes);
  }
}

/**
 * Composite map key. A newline separates the two ids because it cannot appear in
 * a user id or a session id, so `(a, b\nc)` and `(a\nb, c)` cannot collide.
 */
function key(ownerId: string, sessionId: string): string {
  return `${ownerId}\n${sessionId}`;
}
