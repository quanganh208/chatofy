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
   */
  save(
    ownerId: string,
    conversationId: string,
    conversation: Omit<
      Conversation,
      'conversationId' | 'turnCount' | 'preview' | 'hasMinutes'
    >,
  ): Promise<ConversationSummary>;
  /** One conversation with its turns, or null when the caller has no such row. */
  get(ownerId: string, conversationId: string): Promise<Conversation | null>;
  /** The caller's conversations, newest first. */
  list(
    ownerId: string,
    query: ListConversationsQuery,
  ): Promise<ConversationPage>;
  /** Remove it and its turns. False when the caller has no such row. */
  remove(ownerId: string, conversationId: string): Promise<boolean>;
}
