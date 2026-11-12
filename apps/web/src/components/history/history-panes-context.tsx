'use client';

import { createContext, useContext } from 'react';
import type { ConversationSummary } from '@chatofy/types';
import type { ConversationCache } from './conversation-cache';

/**
 * What the History layout shares with the conversation it renders in its pane.
 *
 * The layout owns the list and the selection. The detail needs where to go after
 * a delete, how to take the deleted row out of the list or put a renamed one back,
 * and whether the layout asked it to take focus. The rows' menus need the actions
 * that only the layout can carry out — deleting one that may be the one open.
 */
export interface HistoryPanes {
  /** Where "back" and a finished delete go: the list, keeping the search term. */
  listHref: string;
  /**
   * Remove a deleted conversation from the list without refetching it, and ask
   * whatever opens next to take focus — the delete removed the control that had it.
   */
  forget: (conversationId: string) => void;
  /**
   * `true` once, if a delete asked for focus and it has not been taken yet. The
   * conversation that opens after a delete calls this when it has loaded.
   */
  takeFocusRequest: () => boolean;
  /** Full conversations already held, for copy and downloads from a row. */
  cache: ConversationCache;
  /** A rename landed: the list row and the cache take the stored summary. */
  renamed: (conversation: ConversationSummary) => void;
  /**
   * The last rename stored, from the topbar or from any row. The open
   * conversation folds it into its title when it is the one renamed, so a row's
   * rename of the open conversation renames its crumb too.
   */
  latestRename: ConversationSummary | null;
  /**
   * Delete chosen on a row, after its confirmation. The open conversation goes the
   * way the header's delete goes; any other row leaves focus on its neighbour.
   */
  deleteFromList: (conversationId: string) => Promise<void>;
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
