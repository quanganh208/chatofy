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
  private readonly bySession = new Map<string, MeetingMinutes>();

  get(sessionId: string): Promise<MeetingMinutes | null> {
    return Promise.resolve(this.bySession.get(sessionId) ?? null);
  }

  put(minutes: MeetingMinutes): Promise<MeetingMinutes> {
    this.bySession.set(minutes.sessionId, minutes);
    return Promise.resolve(minutes);
  }
}
