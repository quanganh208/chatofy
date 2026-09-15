// Backend-agnostic store for a user's conversation history, mirroring the
// MINUTES_STORE seam: the interface is what lets a test substitute an in-memory
// double without a Postgres, and what keeps the service free of Prisma types.
import type { Conversation, ConversationSummary } from '@chatofy/types';

/** DI injection token for the conversation store. */
export const CONVERSATION_STORE = Symbol('CONVERSATION_STORE');

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
   * The derived fields are not the caller's to supply: `turnCount` and `preview`
   * are computed from the turns, and `hasMinutes` is read from the relation — a
   * caller-supplied value there could disagree with what is stored.
   *
   * The recording fields are excluded for a different reason. They are written by
   * {@link ConversationStore.setAudio} alone, because a save is a FULL
   * REPLACEMENT that re-fires on every post-end transcript edit — a rename would
   * otherwise clear a stored recording.
   */
  save(
    ownerId: string,
    conversationId: string,
    conversation: Omit<
      Conversation,
      | 'conversationId'
      | 'turnCount'
      | 'preview'
      | 'hasMinutes'
      | 'hasRecording'
      | 'audioOffsetMs'
      | 'audioDurationMs'
    >,
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
