import {
  normalizeForSearch,
  type Conversation,
  type ConversationSummary,
} from '@chatofy/types';
import type {
  ConversationPage,
  ConversationStore,
  ConversationWrite,
  ListConversationsQuery,
} from '../../src/modules/conversations/interfaces/conversation-store.interface';
import {
  conversationKind,
  speakersOf,
} from '../../src/modules/conversations/stores/conversation-display-facts';

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
  /**
   * Recording keys, separate from the conversation.
   *
   * `Conversation` deliberately carries `hasRecording` and not the key — the
   * object name is not part of the contract — so a double that has to answer
   * `findAudioKey` needs somewhere else to keep it.
   */
  private readonly audioKeys = new Map<string, string>();
  /** The mode each conversation was last saved with, as the durable column. */
  private readonly modes = new Map<string, string>();

  save(
    ownerId: string,
    conversationId: string,
    conversation: ConversationWrite,
  ): Promise<ConversationSummary> {
    // A save carries no fields that say an OBJECT exists — it is a full
    // replacement that re-fires on every speaker rename, so carrying them would
    // clear a stored recording on a transcript edit. They are carried over from
    // the previous revision instead, which is what the durable store does by
    // omitting the columns from its update. `audioOffsetMs` is carried when the
    // body measured one and inherited when it did not, which is what the durable
    // store does by writing that column only when it is present.
    const previous = this.byOwnerClient.get(key(ownerId, conversationId));
    const turns = conversation.turns.map((turn) => ({ ...turn }));
    const k = key(ownerId, conversationId);
    // Written only when sent, as the durable store spreads it.
    if (conversation.mode !== undefined) this.modes.set(k, conversation.mode);
    const stored: Conversation = {
      conversationId,
      languages: conversation.languages,
      startedAt: conversation.startedAt,
      endedAt: conversation.endedAt,
      turnCount: turns.length,
      preview: previewOf(turns),
      hasMinutes: previous?.hasMinutes ?? false,
      // Never lowered by a later save, mirroring the durable store.
      pausedMs: Math.max(previous?.pausedMs ?? 0, conversation.pausedMs),
      turns,
      hasRecording: previous?.hasRecording ?? false,
      audioOffsetMs:
        conversation.audioOffsetMs ?? previous?.audioOffsetMs ?? null,
      audioDurationMs: previous?.audioDurationMs ?? null,
      // Never written by a save, so a re-save keeps the title it had.
      title: previous?.title ?? null,
      kind: conversationKind(
        conversation.languages,
        this.modes.get(k) ?? null,
        turns.map((turn) => turn.speakerRole),
      ),
      ...speakersOf(
        turns.map((turn) => ({
          speakerRole: turn.speakerRole,
          speakerLabel: turn.speakerLabel,
          firstPosition: turn.position,
        })),
      ),
    };
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
          (stored.title !== null &&
            normalizeForSearch(stored.title).includes(term)) ||
          stored.turns.some((turn) =>
            // Every translation, as `PrismaConversationStore` folds them.
            normalizeForSearch(
              [
                turn.displayText ?? '',
                turn.sourceText,
                ...Object.values(turn.translations),
              ].join(' '),
            ).includes(term),
          ),
      )
      .slice(0, query.limit);
    return Promise.resolve({
      conversations: mine.map(summaryOf),
      nextCursor: null,
    });
  }

  findAudioKey(
    ownerId: string,
    conversationId: string,
  ): Promise<string | null> {
    return Promise.resolve(
      this.audioKeys.get(key(ownerId, conversationId)) ?? null,
    );
  }

  /**
   * Compare-and-swap on `audioKeys`, matching the durable store's conditional
   * `updateMany`: a candidate is only claimed when the caller owns a row and
   * no key is set yet, and a caller that loses the race reads back whichever
   * key already won rather than overwriting it.
   */
  claimAudioKey(
    ownerId: string,
    conversationId: string,
    candidate: string,
  ): Promise<string | null> {
    const k = key(ownerId, conversationId);
    if (!this.byOwnerClient.has(k)) return Promise.resolve(null);
    const existing = this.audioKeys.get(k);
    if (existing) return Promise.resolve(existing);
    this.audioKeys.set(k, candidate);
    return Promise.resolve(candidate);
  }

  setAudio(
    ownerId: string,
    conversationId: string,
    audio: { key: string; offsetMs: number; durationMs: number },
  ): Promise<boolean> {
    const k = key(ownerId, conversationId);
    const stored = this.byOwnerClient.get(k);
    if (!stored) return Promise.resolve(false);
    this.audioKeys.set(k, audio.key);
    stored.audioOffsetMs = audio.offsetMs;
    stored.audioDurationMs = audio.durationMs;
    // Derived from the duration, not set unconditionally, so this double
    // agrees with the durable store: a key can be CLAIMED (above) before any
    // bytes exist, and `hasRecording` must not go true until this — the write
    // that follows a successful PUT — actually lands.
    stored.hasRecording = stored.audioDurationMs !== null;
    return Promise.resolve(true);
  }

  /**
   * Reads the recording key and removes the row in one call, mirroring the
   * durable store's atomic `removeReturningAudioKey` — a caller here can rely
   * on the returned key being accurate at the moment of removal without a
   * separate find-then-delete step racing anything else.
   */
  removeReturningAudioKey(
    ownerId: string,
    conversationId: string,
  ): Promise<{ removed: boolean; audioKey: string | null }> {
    const k = key(ownerId, conversationId);
    const audioKey = this.audioKeys.get(k) ?? null;
    const existed = this.byOwnerClient.delete(k);
    if (existed) this.order.splice(this.order.indexOf(k), 1);
    this.audioKeys.delete(k);
    return Promise.resolve({ removed: existed, audioKey });
  }

  setTitleIfEmpty(
    ownerId: string,
    conversationId: string,
    title: string,
  ): Promise<boolean> {
    const stored = this.byOwnerClient.get(key(ownerId, conversationId));
    if (!stored || stored.title !== null) return Promise.resolve(false);
    stored.title = title;
    return Promise.resolve(true);
  }

  /** Unconditional, as the durable store's rename; null for a foreign or absent id. */
  rename(
    ownerId: string,
    conversationId: string,
    title: string,
  ): Promise<ConversationSummary | null> {
    const stored = this.byOwnerClient.get(key(ownerId, conversationId));
    if (!stored) return Promise.resolve(null);
    stored.title = title;
    return Promise.resolve(summaryOf(stored));
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
    languages: stored.languages,
    startedAt: stored.startedAt,
    endedAt: stored.endedAt,
    turnCount: stored.turnCount,
    preview: stored.preview,
    hasMinutes: stored.hasMinutes,
    pausedMs: stored.pausedMs,
    title: stored.title,
    kind: stored.kind,
    hasRecording: stored.hasRecording,
    speakerCount: stored.speakerCount,
    speakers: stored.speakers,
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
