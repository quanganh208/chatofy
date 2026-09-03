import {
  normalizeForSearch,
  type Conversation,
  type ConversationSummary,
} from '@chatofy/types';
import type {
  ConversationPage,
  ConversationStore,
  ListConversationsQuery,
} from '../../src/modules/conversations/interfaces/conversation-store.interface';

/**
 * A ConversationStore that keeps conversations in a Map.
 *
 * Exists so the fast e2e suite can boot with no Postgres now that minutes are
 * generated from a STORED transcript: `MinutesService` reads through
 * `CONVERSATION_STORE`, which is bound to the Prisma implementation, so without
 * this every minutes case would throw on `prisma.conversation`.
 *
 * Owner-scoped exactly like the durable store — a conversation is addressed by
 * `(ownerId, clientId)` and never by id alone, so a suite cannot pass with an
 * ownership shortcut this double quietly tolerated.
 */
export class InMemoryConversationStore implements ConversationStore {
  private readonly byOwnerClient = new Map<string, Conversation>();
  /** Insertion order, so `list` can answer newest-first. */
  private readonly order: string[] = [];

  save(
    ownerId: string,
    conversationId: string,
    conversation: Omit<
      Conversation,
      'conversationId' | 'turnCount' | 'preview' | 'hasMinutes'
    >,
  ): Promise<ConversationSummary> {
    const stored: Conversation = {
      conversationId,
      direction: conversation.direction,
      startedAt: conversation.startedAt,
      endedAt: conversation.endedAt,
      turnCount: conversation.turns.length,
      preview: previewOf(conversation.turns),
      hasMinutes:
        this.byOwnerClient.get(key(ownerId, conversationId))?.hasMinutes ??
        false,
      turns: conversation.turns,
    };
    const k = key(ownerId, conversationId);
    if (!this.byOwnerClient.has(k)) this.order.unshift(k);
    this.byOwnerClient.set(k, stored);
    return Promise.resolve(summaryOf(stored));
  }

  get(ownerId: string, conversationId: string): Promise<Conversation | null> {
    return Promise.resolve(
      this.byOwnerClient.get(key(ownerId, conversationId)) ?? null,
    );
  }

  list(
    ownerId: string,
    query: ListConversationsQuery,
  ): Promise<ConversationPage> {
    // The SAME fold the durable store applies on both sides, so a suite cannot
    // pass here while diacritic-insensitive matching is broken there.
    const term = query.q ? normalizeForSearch(query.q) : undefined;
    const mine = this.order
      .filter((k) => k.startsWith(`${ownerId}\n`))
      .flatMap((k) => {
        const stored = this.byOwnerClient.get(k);
        return stored ? [stored] : [];
      })
      .filter(
        (stored) =>
          !term ||
          stored.turns.some((turn) =>
            normalizeForSearch(
              [turn.displayText ?? '', turn.sourceText, turn.targetText].join(
                ' ',
              ),
            ).includes(term),
          ),
      )
      .slice(0, query.limit);
    return Promise.resolve({
      conversations: mine.map(summaryOf),
      nextCursor: null,
    });
  }

  remove(ownerId: string, conversationId: string): Promise<boolean> {
    const k = key(ownerId, conversationId);
    const existed = this.byOwnerClient.delete(k);
    if (existed) this.order.splice(this.order.indexOf(k), 1);
    return Promise.resolve(existed);
  }

  /** Marks a conversation as having minutes, for a `hasMinutes` assertion. */
  markMinutes(ownerId: string, conversationId: string): void {
    const stored = this.byOwnerClient.get(key(ownerId, conversationId));
    if (stored) stored.hasMinutes = true;
  }
}

function summaryOf(stored: Conversation): ConversationSummary {
  return {
    conversationId: stored.conversationId,
    direction: stored.direction,
    startedAt: stored.startedAt,
    endedAt: stored.endedAt,
    turnCount: stored.turnCount,
    preview: stored.preview,
    hasMinutes: stored.hasMinutes,
  };
}

function previewOf(
  turns: readonly { sourceText: string; displayText: string | null }[],
): string {
  const first = turns[0];
  return first ? (first.displayText ?? first.sourceText) : '';
}

function key(ownerId: string, conversationId: string): string {
  return `${ownerId}\n${conversationId}`;
}
