'use client';

import { createContext, useContext } from 'react';
import type { ConversationSummary } from '@chatofy/types';

/**
 * What the History layout shares with the page rendered in its reading pane.
 *
 * The list lives in the layout so it survives moving between conversations; the
 * pages below it still need three facts from it — which conversation is newest
 * (what `/history` opens on a wide screen), whether the screen is wide at all, and
 * a way to drop a row once its conversation has been deleted.
 */
export interface HistoryPanes {
  /** The rows loaded so far, newest first. */
  conversations: readonly ConversationSummary[];
  /** The first page has not arrived yet. */
  loading: boolean;
  /** The content area holds both panes side by side. */
  wide: boolean;
  /** Where "back" and a finished delete go: the list, keeping the search term. */
  listHref: string;
  /** Remove a deleted conversation from the list without refetching it. */
  forget: (conversationId: string) => void;
}

const HistoryPanesContext = createContext<HistoryPanes | null>(null);

export const HistoryPanesProvider = HistoryPanesContext.Provider;

/**
 * The layout's facts, or `null` outside it. A detail rendered on its own — a spec,
 * a future embed — behaves as the narrow, two-page layout: a back link, no list.
 */
export function useHistoryPanes(): HistoryPanes | null {
  return useContext(HistoryPanesContext);
}
