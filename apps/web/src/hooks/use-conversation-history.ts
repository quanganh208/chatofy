'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SEARCH_LIMITS, type ConversationSummary } from '@chatofy/types';
import { listConversations } from '@/clients/api-client';

const SEARCH_MIN_CHARS = SEARCH_LIMITS.MIN_CHARS;

export interface UseConversationHistory {
  conversations: ConversationSummary[];
  /** The first page has not arrived yet. Distinct from "there are none". */
  loading: boolean;
  /** A further page is in flight. */
  loadingMore: boolean;
  /** The first page failed, so there is nothing on screen. */
  error: boolean;
  /** A further page failed. What is already loaded is still valid. */
  loadMoreError: boolean;
  /** Another page exists. */
  hasMore: boolean;
  loadMore: () => void;
  /** Re-fetch from the first page. */
  reload: () => void;
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
 * The two failures are separate state because they cost different things. A
 * first page that fails leaves an empty screen and a "try again"; a later page
 * that fails must leave the rows already read exactly where they are, because
 * collapsing the two would replace ninety loaded conversations with an error
 * card and restart the reader at page one.
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
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);

  // Bumped to re-run the first-page effect. A plain `reload()` that called the
  // fetch directly would race the effect on mount in StrictMode's double-invoke.
  const [generation, setGeneration] = useState(0);

  // Below the minimum the API refuses the term, so a half-typed word lists
  // everything rather than flashing an error the reader cannot act on.
  const searchable = q.trim().length >= SEARCH_MIN_CHARS ? q.trim() : '';

  // Which list is on screen. A reload bumps the generation, and a new search
  // term is a DIFFERENT list at the same generation — so the key carries both.
  // Keyed on the reload alone, a page fetched against the unfiltered list would
  // pass the guard below and append rows that do not match what is being
  // searched for, under a cursor belonging to the other list.
  const listKey = `${generation}:${searchable}`;
  const activeList = useRef(listKey);

  useEffect(() => {
    activeList.current = listKey;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setLoadMoreError(false);
    // A cursor belongs to ONE list. Holding the previous one across a term change
    // let `loadMore` fetch the old keyset under the new query — the `activeList`
    // guard below cannot catch that, because the ref is already the new key by the
    // time the click happens. Clearing it also drops `hasMore`, so the control that
    // would trip this is not on screen while the first page is in flight.
    setCursor(null);

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
  }, [listKey, searchable]);

  const loadMore = useCallback(() => {
    if (!cursor) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    const requested = activeList.current;
    listConversations({ cursor, q: searchable })
      .then((page) => {
        // Dropped if the list changed meanwhile: appending a page fetched
        // against the old one would duplicate or mismatch rows.
        if (activeList.current !== requested) return;
        setConversations((current) => [...current, ...page.conversations]);
        setCursor(page.nextCursor);
      })
      .catch(() => {
        if (activeList.current === requested) setLoadMoreError(true);
      })
      .finally(() => setLoadingMore(false));
  }, [cursor, searchable]);

  const reload = useCallback(() => setGeneration((n) => n + 1), []);

  return {
    conversations,
    loading,
    loadingMore,
    error,
    loadMoreError,
    searching: searchable !== '',
    hasMore: cursor !== null,
    loadMore,
    reload,
  };
}
