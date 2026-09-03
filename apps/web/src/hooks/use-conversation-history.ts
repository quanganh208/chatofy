'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SEARCH_LIMITS, type ConversationSummary } from '@chatofy/types';
import { deleteConversation, listConversations } from '@/clients/api-client';

const SEARCH_MIN_CHARS = SEARCH_LIMITS.MIN_CHARS;

export interface UseConversationHistory {
  conversations: ConversationSummary[];
  /** The first page has not arrived yet. Distinct from "there are none". */
  loading: boolean;
  /** A further page is in flight. */
  loadingMore: boolean;
  /** The last list request failed. */
  error: boolean;
  /** Another page exists. */
  hasMore: boolean;
  loadMore: () => void;
  /** Re-fetch from the first page. */
  reload: () => void;
  /** Delete one, and drop it from the list on success. */
  remove: (conversationId: string) => Promise<void>;
  /** The term actually sent — empty while one is too short to be searched. */
  searching: boolean;
}

/**
 * The caller's history list.
 *
 * Paging is keyset: each page carries the cursor for the next one, so "load
 * more" cannot skip or repeat a row when a conversation is added or deleted
 * between requests — which a page-number offset would.
 *
 * A delete is applied locally on success rather than triggering a re-fetch. The
 * server has already agreed the row is gone, and re-listing would move every
 * later row up by one under the reader's cursor.
 *
 * `q` narrows the list. It is passed already debounced — this hook re-fetches
 * the FIRST page whenever it changes, so a keystroke-per-request caller would
 * spend one round trip per character.
 */
export function useConversationHistory(q = ''): UseConversationHistory {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);

  // Bumped to re-run the first-page effect. A plain `reload()` that called the
  // fetch directly would race the effect on mount in StrictMode's double-invoke.
  const [generation, setGeneration] = useState(0);
  // Guards a late first-page response from a superseded generation overwriting a
  // newer one.
  const activeGeneration = useRef(generation);

  // Below the minimum the API refuses the term, so a half-typed word lists
  // everything rather than flashing an error the reader cannot act on.
  const searchable = q.trim().length >= SEARCH_MIN_CHARS ? q.trim() : '';

  useEffect(() => {
    activeGeneration.current = generation;
    let cancelled = false;
    setLoading(true);
    setError(false);

    listConversations({ q: searchable })
      .then((page) => {
        if (cancelled) return;
        setConversations(page.conversations);
        setCursor(page.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [generation, searchable]);

  const loadMore = useCallback(() => {
    if (!cursor) return;
    setLoadingMore(true);
    const requested = activeGeneration.current;
    listConversations({ cursor, q: searchable })
      .then((page) => {
        // Dropped if the list was reloaded meanwhile: appending a page fetched
        // against the old list would duplicate rows.
        if (activeGeneration.current !== requested) return;
        setConversations((current) => [...current, ...page.conversations]);
        setCursor(page.nextCursor);
      })
      .catch(() => setError(true))
      .finally(() => setLoadingMore(false));
  }, [cursor, searchable]);

  const reload = useCallback(() => setGeneration((n) => n + 1), []);

  const remove = useCallback(async (conversationId: string): Promise<void> => {
    await deleteConversation(conversationId);
    setConversations((current) => current.filter((c) => c.conversationId !== conversationId));
  }, []);

  return {
    conversations,
    loading,
    loadingMore,
    error,
    searching: searchable !== '',
    hasMore: cursor !== null,
    loadMore,
    reload,
    remove,
  };
}
