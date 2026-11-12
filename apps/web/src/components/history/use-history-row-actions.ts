'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { ConversationSummary } from '@chatofy/types';
import { deleteConversation } from '@/clients/api-client';
import type { UseConversationHistory } from '@/hooks/use-conversation-history';
import { createConversationCache } from './conversation-cache';
import type { HistoryPanes } from './history-panes-context';
import type { useHistorySearch } from './use-history-search';

interface RowActionsInput {
  history: UseConversationHistory;
  search: ReturnType<typeof useHistorySearch>;
  /** The conversation in the reading pane, if any. */
  selectedId: string | undefined;
  /** The layout's delete bookkeeping: drop the row, ask what opens next for focus. */
  forget: (conversationId: string) => void;
  listHref: string;
  /** Where focus lands when a delete leaves no row to land on. */
  listRegion: RefObject<HTMLDivElement | null>;
}

type RowActions = Pick<
  HistoryPanes,
  'cache' | 'renamed' | 'renameFromList' | 'renameRequest' | 'takeRenameRequest' | 'deleteFromList'
>;

/**
 * What the History layout does for a list row's `⋯` menu — the parts a row cannot
 * do from inside itself, because they change the pane beside it.
 */
export function useHistoryRowActions({
  history,
  search,
  selectedId,
  forget,
  listHref,
  listRegion,
}: RowActionsInput): RowActions {
  const router = useRouter();
  const { forget: forgetRow, update: updateRow, conversations } = history;

  // Read through a ref by the callbacks below, so they stay the same functions
  // while the list and the selection change. The panes value is built from them,
  // and a panes value that changed with every list update re-ran the open detail's
  // focus effect — which then took a focus request meant for whatever opens NEXT.
  const { beginNavigation, rowQuerySuffix } = search;
  const latest = useRef({ conversations, selectedId, beginNavigation, rowQuerySuffix });
  useEffect(() => {
    latest.current = { conversations, selectedId, beginNavigation, rowQuerySuffix };
  }, [conversations, selectedId, beginNavigation, rowQuerySuffix]);

  // Created once per layout: the conversations a row's copy or download fetched,
  // and the one open in the pane, for as long as the reader stays in History.
  const [cache] = useState(createConversationCache);

  const renamed = useCallback(
    (conversation: ConversationSummary) => {
      updateRow(conversation);
      cache.update(conversation);
    },
    [updateRow, cache],
  );

  // Rename from a row hands over to the conversation's header. Navigating is
  // skipped only when that conversation is already the one in the pane.
  const [renameRequest, setRenameRequest] = useState<string | null>(null);
  const renameFromList = useCallback(
    (conversationId: string) => {
      setRenameRequest(conversationId);
      const current = latest.current;
      if (conversationId === current.selectedId) return;
      const pathname = `/history/${conversationId}`;
      current.beginNavigation(pathname);
      router.push(`${pathname}${current.rowQuerySuffix}` as Route);
    },
    [router],
  );
  const takeRenameRequest = useCallback(() => setRenameRequest(null), []);
  // Dropped when the reader ends up somewhere else before it was taken — another
  // conversation, or back on the list — so it can never open an editor later,
  // unasked. Adjusted during render, so no frame draws the stale request.
  const [requestSeenAt, setRequestSeenAt] = useState(selectedId);
  if (requestSeenAt !== selectedId) {
    setRequestSeenAt(selectedId);
    if (renameRequest !== null && selectedId !== renameRequest) setRenameRequest(null);
  }

  // A row deleted that was NOT open: nothing in the pane changes, so focus — which
  // was on that row's strip — goes to the row that took its place, or the list.
  const focusAfterRowDelete = useRef<{ next: string | undefined } | null>(null);
  useEffect(() => {
    const pending = focusAfterRowDelete.current;
    if (!pending) return;
    focusAfterRowDelete.current = null;
    const row = pending.next
      ? listRegion.current?.querySelector<HTMLElement>(`a[href^="/history/${pending.next}"]`)
      : null;
    (row ?? listRegion.current)?.focus();
  }, [conversations, listRegion]);

  const deleteFromList = useCallback(
    async (conversationId: string) => {
      await deleteConversation(conversationId);
      cache.forget(conversationId);
      const { conversations: rows, selectedId: open } = latest.current;
      if (conversationId === open) {
        // The open one: exactly the header's delete — out of the list, focus to
        // whatever opens next (or the list), and `replace` so Back cannot return.
        forget(conversationId);
        router.replace(listHref as Route);
        return;
      }
      const at = rows.findIndex((c) => c.conversationId === conversationId);
      const next = rows[at + 1] ?? rows[at - 1];
      focusAfterRowDelete.current = { next: next?.conversationId };
      forgetRow(conversationId);
    },
    [cache, forget, router, listHref, forgetRow],
  );

  return useMemo(
    () => ({ cache, renamed, renameFromList, renameRequest, takeRenameRequest, deleteFromList }),
    [cache, renamed, renameFromList, renameRequest, takeRenameRequest, deleteFromList],
  );
}
