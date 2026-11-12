import { ApiClientError } from '@chatofy/api-client';
import type { Conversation, ConversationSummary, MinutesContent } from '@chatofy/types';
import { getConversation, getMinutes } from '@/clients/api-client';

/**
 * Full conversations the History screen already holds, by id.
 *
 * A list row only has the summary; copying or downloading it needs the turns. Those
 * are fetched when the reader CHOOSES the action, never ahead of it — prefetching
 * every row's transcript to make a menu item instant would cost one request per
 * conversation on screen for an action most readers never take. Once fetched, or
 * once the open conversation has loaded in the pane beside the list, a second
 * action on the same conversation reads it from here.
 *
 * Scoped to one History layout (it lives in the layout's ref), so it goes when the
 * reader leaves History and can never answer for a later session's account.
 */
export interface ConversationCache {
  /** What is already held, without fetching. */
  peek: (conversationId: string) => Conversation | undefined;
  /** What is held, or one request for it — shared by callers that ask at once. */
  load: (conversationId: string) => Promise<Conversation>;
  /** Hold a conversation loaded elsewhere (the open detail). */
  remember: (conversation: Conversation) => void;
  /** Fold a newer summary (a rename) into the held copy, turns unchanged. */
  update: (summary: ConversationSummary) => void;
  /** Drop a deleted conversation. */
  forget: (conversationId: string) => void;
}

export function createConversationCache(): ConversationCache {
  const held = new Map<string, Conversation>();
  const inFlight = new Map<string, Promise<Conversation>>();

  return {
    peek: (id) => held.get(id),
    load(id) {
      const known = held.get(id);
      if (known) return Promise.resolve(known);
      const pending = inFlight.get(id);
      if (pending) return pending;
      const request = getConversation(id)
        .then(({ conversation }) => {
          held.set(id, conversation);
          return conversation;
        })
        .finally(() => inFlight.delete(id));
      inFlight.set(id, request);
      return request;
    },
    remember: (conversation) => held.set(conversation.conversationId, conversation),
    update(summary) {
      const known = held.get(summary.conversationId);
      if (known) held.set(summary.conversationId, { ...known, ...summary });
    },
    forget(id) {
      held.delete(id);
      inFlight.delete(id);
    },
  };
}

/**
 * A conversation's minutes for an export, or null when there are none.
 *
 * 404 is "none generated yet" — an ordinary state, as `useMinutes` reads it — so
 * the export simply has no Minutes section. Any other failure rejects: a Markdown
 * file that silently lost its minutes would look complete.
 */
export async function minutesOrNull(conversationId: string): Promise<MinutesContent | null> {
  try {
    const { minutes } = await getMinutes(conversationId);
    return minutes;
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) return null;
    throw err;
  }
}
