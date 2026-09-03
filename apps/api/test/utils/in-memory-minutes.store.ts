import { NotFoundException } from '@nestjs/common';
import type { MeetingMinutes } from '@chatofy/types';
import type { MinutesStore } from '../../src/modules/minutes/interfaces/minutes-store.interface';
import type { InMemoryConversationStore } from './in-memory-conversation.store';

/**
 * A MinutesStore that keeps artifacts in a Map.
 *
 * Lives under `test/` rather than beside the Postgres store, the way
 * `in-memory-user.repository.ts` does: it is a test double exercised end to end
 * through `overrideProvider(MINUTES_STORE)`, not a backend a deployment can
 * select. It used to be a shipped implementation chosen by an env var that
 * defaulted to it — which is how the minutes feature came to keep nothing in
 * production.
 *
 * It enforces the SAME ownership rule the durable store does, and that is the
 * point of it: a double that skipped the two-step resolution would let the fast
 * suite pass with an ownership bug the db suite alone could catch.
 */
export class InMemoryMinutesStore implements MinutesStore {
  private readonly byOwnerConversation = new Map<string, MeetingMinutes>();

  constructor(private readonly conversations: InMemoryConversationStore) {}

  async get(
    ownerId: string,
    conversationId: string,
  ): Promise<MeetingMinutes | null> {
    if (!(await this.conversations.get(ownerId, conversationId))) return null;
    return this.byOwnerConversation.get(key(ownerId, conversationId)) ?? null;
  }

  async put(ownerId: string, minutes: MeetingMinutes): Promise<MeetingMinutes> {
    if (!(await this.conversations.get(ownerId, minutes.conversationId))) {
      throw new NotFoundException(`no conversation ${minutes.conversationId}`);
    }
    this.byOwnerConversation.set(key(ownerId, minutes.conversationId), minutes);
    // Mirrors the FK the durable store relies on, so `hasMinutes` is true for
    // the same reason it is true in Postgres: a minutes row exists.
    this.conversations.markMinutes(ownerId, minutes.conversationId);
    return minutes;
  }
}

/**
 * Composite map key. A newline separates the two ids because it cannot appear in
 * a user id or a conversation id, so `(a, b\nc)` and `(a\nb, c)` cannot collide.
 */
function key(ownerId: string, conversationId: string): string {
  return `${ownerId}\n${conversationId}`;
}
