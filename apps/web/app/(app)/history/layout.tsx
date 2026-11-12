import type { ReactNode } from 'react';
import { HistoryMasterDetail } from '@/components/history/history-master-detail';

/**
 * The list half of History, shared by `/history` and `/history/[conversationId]`.
 *
 * A layout rather than a component each page renders, because a layout is NOT
 * remounted when navigation stays beneath it: moving from one conversation to
 * another keeps the search term, the pages already loaded and the list's scroll
 * position, and fetches nothing for the list. Each page fills the reading pane.
 */
export default function HistoryLayout({ children }: { children: ReactNode }) {
  return <HistoryMasterDetail>{children}</HistoryMasterDetail>;
}
