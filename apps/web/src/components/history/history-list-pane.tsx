'use client';

import type { CSSProperties, RefObject } from 'react';
import { ResizeHandle } from '@chatofy/ui/react';
import { MEASURE } from '@/components/layout/measures';
import type { UseConversationHistory } from '@/hooks/use-conversation-history';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import { HistoryList } from './history-list';
import { HistorySearchInput } from './history-search-input';
import type { useHistorySearch } from './use-history-search';

export const LIST_WIDTH_MIN = 280;
// Leaves the reading pane at least ~540px at the 64rem content width the layout
// starts at — enough for a transcript turn at a readable measure.
export const LIST_WIDTH_MAX = 480;

interface HistoryListPaneProps {
  search: ReturnType<typeof useHistorySearch>;
  history: UseConversationHistory;
  selectedId?: string;
  /** A conversation is named in the URL: below 64rem this pane gives way to it. */
  hasOpenId: boolean;
  /** The whole width, with no reading pane beside it. */
  solo: boolean;
  /** Drawn beside the reading pane, so its width can be dragged. */
  resizable: boolean;
  nothingToSearch: boolean;
  listWidth: { width: number; setWidth: (width: number) => void; reset: () => void };
  /** Focus lands here when a delete leaves no conversation to open. */
  regionRef: RefObject<HTMLDivElement | null>;
}

/**
 * The left pane: the search field and the list, and the handle that sizes them.
 *
 * Its own scroller, so the list keeps its place while the conversation beside it
 * scrolls — and, because the layout never remounts, while the reader moves between
 * conversations. The field is pinned to the top of the pane where the list scrolls
 * on its own; in the one-page layout it scrolls away with the page.
 */
export function HistoryListPane({
  search,
  history,
  selectedId,
  hasOpenId,
  solo,
  resizable,
  nothingToSearch,
  listWidth,
  regionRef,
}: HistoryListPaneProps) {
  const t = useTranslate();

  return (
    <div
      ref={regionRef}
      role="region"
      aria-label={t('web.chrome.navHistory')}
      tabIndex={-1}
      style={{ '--history-list-width': `${listWidth.width}px` } as CSSProperties}
      className={cn(
        'relative min-h-0 w-full min-w-0 flex-col outline-none',
        hasOpenId ? 'hidden @5xl:flex' : 'flex',
        !solo && 'border-hairline @5xl:w-(--history-list-width) @5xl:shrink-0 @5xl:border-r',
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            'mx-auto flex w-full flex-col gap-6 px-6 py-8',
            MEASURE.wide,
            !solo && '@5xl:max-w-none @5xl:gap-4 @5xl:px-3 @5xl:py-4',
          )}
        >
          <div className={cn(!solo && 'bg-background @5xl:sticky @5xl:top-0 @5xl:z-20 @5xl:px-1')}>
            <HistorySearchInput
              value={search.term}
              onChange={search.setTerm}
              disabled={nothingToSearch}
            />
          </div>
          <HistoryList
            conversations={history.conversations}
            loading={history.loading}
            loadingMore={history.loadingMore}
            error={history.error}
            loadMoreError={history.loadMoreError}
            searching={history.searching}
            hasMore={history.hasMore}
            onLoadMore={history.loadMore}
            onRetry={history.reload}
            onClearSearch={search.clear}
            selectedId={selectedId}
            querySuffix={search.rowQuerySuffix}
            onOpen={search.beginNavigation}
          />
        </div>
      </div>
      {resizable ? (
        <ResizeHandle
          label={t('web.history.listWidth')}
          value={listWidth.width}
          min={LIST_WIDTH_MIN}
          max={LIST_WIDTH_MAX}
          grow="right"
          onChange={listWidth.setWidth}
          onReset={listWidth.reset}
          className="-right-1.5"
        />
      ) : null}
    </div>
  );
}
