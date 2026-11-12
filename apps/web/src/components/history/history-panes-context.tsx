'use client';

import { createContext, useContext } from 'react';

/**
 * What the History layout shares with the conversation it renders in its pane.
 *
 * The layout owns the list and the selection; the detail needs only where to go
 * after a delete, how to take the deleted row out of the list, and whether the
 * layout asked it to take focus.
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
