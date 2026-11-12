'use client';

import { ConversationDetail } from './conversation-detail';
import { ConversationDetailLoading } from './conversation-detail-states';
import { useHistoryPanes } from './history-panes-context';

/**
 * What `/history` shows in the reading pane: the newest conversation, on a wide
 * screen only.
 *
 * **The URL stays `/history`.** Opening the newest is a default, not a navigation —
 * pushing `/history/<id>` would put an entry in the reader's history that they never
 * chose, and Back would land on the screen they just left. Clicking a row is what
 * navigates.
 *
 * Nothing on a narrow screen, where the reading pane is not drawn: fetching a
 * conversation and its minutes for a pane nobody can see is the cost this avoids.
 * Nothing either when there is nothing to open — an empty account or a search that
 * matched nothing — because the list beside it already says which.
 */
export function HistoryNewestDetail() {
  const panes = useHistoryPanes();
  if (!panes?.wide) return null;

  const newest = panes.conversations[0];
  if (!newest) return panes.loading ? <ConversationDetailLoading /> : null;

  // Keyed by id: when a delete or a new search changes which one is newest, the
  // detail starts fresh — its player, its minutes and its open tab with it.
  return <ConversationDetail key={newest.conversationId} conversationId={newest.conversationId} />;
}
