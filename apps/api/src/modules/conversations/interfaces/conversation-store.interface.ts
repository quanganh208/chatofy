// Backend-agnostic store for a user's conversation history, mirroring the
// MINUTES_STORE seam: the interface is what lets a test substitute an in-memory
// double without a Postgres, and what keeps the service free of Prisma types.
import type {
  Conversation,
  ConversationSummary,
  LanguageCode,
  SpeakerRole,
} from '@chatofy/types';

/** DI injection token for the conversation store. */
export const CONVERSATION_STORE = Symbol('CONVERSATION_STORE');

/**
 * One turn as the store WRITES it — always the language-keyed shape, never the
 * legacy `targetText`.
 *
 * `SaveConversationTurn` (`@chatofy/types`) cannot serve this job unchanged: it
 * still carries the legacy `targetText`, which Postgres has no column for.
 * `sourceLanguages`/`translations` are REQUIRED on both types today — a body's
 * `saveConversationRequestSchema` preprocess already fills them from
 * `speakerRole`/`targetText` before the service ever sees it — so the only
 * narrowing left for `ConversationsService`'s write conversion to do is
 * dropping `targetText` itself, which nothing downstream of it should still be
 * reaching for.
 */
export interface ConversationTurnWrite {
  position: number;
  speakerRole: SpeakerRole;
  speakerLabel: string | null;
  sourceText: string;
  displayText: string | null;
  sourceLanguages: LanguageCode[];
  translations: Partial<Record<LanguageCode, string>>;
  offsetMs: number | null;
}

/**
 * A conversation as the store WRITES it — see {@link ConversationTurnWrite} for
 * why this is not `SaveConversationRequest` itself.
 */
export interface ConversationWrite {
  languages: LanguageCode[];
  startedAt: string;
  endedAt: string;
  turns: ConversationTurnWrite[];
  audioOffsetMs: number | null;
}

/** One page of the caller's history, newest first. */
export interface ConversationPage {
  conversations: ConversationSummary[];
  /** Opaque keyset cursor for the next page; null when this is the last. */
  nextCursor: string | null;
}

/** What the list route may narrow by. */
export interface ListConversationsQuery {
  limit: number;
  cursor?: string;
  /**
   * A search term, already trimmed and length-checked at the boundary.
   *
   * Narrowing only — never a second way in. `ownerId` is still the first filter
   * on the query, so a term that matches another user's conversation returns an
   * empty list rather than theirs.
   */
  q?: string;
}

/**
 * Every method is scoped by `ownerId` — the authenticated caller's user id, read
 * from the verified token, never from the request path or body. That is the
 * store-level half of the ownership guarantee: a `conversationId` guessed or
 * copied from another user resolves to `null` here rather than to their
 * transcript, so a foreign id and an absent one are indistinguishable to the
 * caller.
 *
 * `conversationId` throughout is the CLIENT-minted id that appears in URLs, not
 * the row's server cuid. The two are different values and conflating them is how
 * an ownership check gets skipped — see `PrismaConversationStore`.
 */
export interface ConversationStore {
  /**
   * Create or fully replace the caller's conversation under this client id.
   *
   * The parameter is {@link ConversationWrite}, not `SaveConversationRequest`
   * (`@chatofy/types`) and not `Conversation`. `SaveConversationRequest` is the
   * HTTP contract's shape and still carries the legacy `direction`/turn
   * `targetText` pair a caller may send instead of (or alongside) the
   * language-keyed fields; `ConversationsService.save` is where that resolves
   * into a write with no legacy pair left in it at all. `Conversation` keeps
   * BOTH the new fields and the legacy `direction`/`targetText` for a READER's
   * sake (see its own docblock); a write has no column for the legacy pair at
   * all, so carrying it here would be make-work with nowhere to put it.
   *
   * `turnCount`, `preview` and `hasMinutes` are not part of this type for the
   * same reason they were excluded before: they are computed from the turns or
   * read from the relation, never supplied.
   *
   * `hasRecording` and `audioDurationMs` are excluded for a different reason.
   * They say a playable object exists, which only {@link ConversationStore.setAudio}
   * can know, and a save is a FULL REPLACEMENT that re-fires on every post-end
   * transcript edit — carrying them would clear a stored recording on a rename.
   *
   * `audioOffsetMs` is the one recording field a save DOES carry, because it is
   * not about the object at all: it is the shift every stored timestamp is read
   * through, the client measured it while the conversation was on screen, and a
   * recording that is never stored must not change what those timestamps mean.
   * A null one leaves any stored value alone, so a client that does not send it
   * cannot clear what an upload wrote.
   */
  save(
    ownerId: string,
    conversationId: string,
    conversation: ConversationWrite,
  ): Promise<ConversationSummary>;
  /** One conversation with its turns, or null when the caller has no such row. */
  get(ownerId: string, conversationId: string): Promise<Conversation | null>;
  /** The caller's conversations, newest first. */
  list(
    ownerId: string,
    query: ListConversationsQuery,
  ): Promise<ConversationPage>;
  /**
   * This conversation's recording key, or null when there is none.
   *
   * The one caller left is `getAudio`: a stream read needs the key on its own,
   * with no other column, and it is owner-scoped like everything else here so a
   * foreign id reads as "no key" rather than as someone else's object name. A
   * delete no longer reads this separately — see `removeReturningAudioKey`,
   * which reads and deletes the row as one atomic step instead.
   */
  findAudioKey(ownerId: string, conversationId: string): Promise<string | null>;
  /**
   * Atomically claims a key for this conversation's recording, or hands back
   * whichever key a concurrent call already won.
   *
   * This is a compare-and-swap, not a read followed by a write: `audioKey`
   * only moves from null to a value, and only one caller's conditional update
   * can be the one that makes that move. Two overlapping FIRST uploads for one
   * conversation each mint their own candidate key and both call this; the
   * loser's write matches nothing, so it re-reads and gets the winner's key
   * back instead. That is what makes both requests store the SAME object,
   * where a plain read-then-write pair would let both believe there was no key
   * yet and each mint and store its own — stranding one of them, unreachable by
   * any later delete, on a PUBLIC-READ bucket.
   *
   * Null means the caller has no such row — the same "no such row or not mine"
   * answer everything else here gives, never a distinct signal.
   */
  claimAudioKey(
    ownerId: string,
    conversationId: string,
    candidate: string,
  ): Promise<string | null>;
  /**
   * Point the conversation at a stored recording. False when the caller has no
   * such row — which is what lets the route answer a foreign id exactly like an
   * absent one.
   */
  setAudio(
    ownerId: string,
    conversationId: string,
    audio: { key: string; offsetMs: number; durationMs: number },
  ): Promise<boolean>;
  /**
   * Deletes the row and its turns, and reports the recording key it had — read
   * and removed in one atomic step, not a find followed by a delete.
   *
   * That matters for the same reason `claimAudioKey` is one step rather than
   * two: an upload's key claim, object PUT and timing write can land at any
   * point relative to this call, and a separate find-then-delete would have a
   * window where the read sees no key yet, the delete removes the row anyway,
   * and the upload's object lands afterward with nothing left to point at it.
   * Reading the key as part of the SAME delete is what guarantees the value
   * returned is the one the row actually had at the moment it stopped existing
   * — whatever an upload finishes concurrently either lands before this delete
   * (so the key it wrote is the one returned here) or after it (so the row is
   * already gone and the upload's own write finds zero rows, which is what
   * makes its compensating cleanup in `setAudio` fire instead).
   *
   * `removed: false` when the caller has no such row; `audioKey` is only
   * meaningful when `removed` is true.
   */
  removeReturningAudioKey(
    ownerId: string,
    conversationId: string,
  ): Promise<{ removed: boolean; audioKey: string | null }>;
}
