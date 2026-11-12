'use client';

import { Suspense, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { ResizeHandle } from '@chatofy/ui/react';
import { MEASURE } from '@/components/layout/measures';
import { useConversationHistory } from '@/hooks/use-conversation-history';
import { useStoredWidth } from '@/hooks/use-stored-width';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import { HistoryList } from './history-list';
import { HistoryPanesProvider, type HistoryPanes } from './history-panes-context';
import { HistorySearchInput } from './history-search-input';
import { useContainerWide } from './use-container-wide';
import { useHistorySearch } from './use-history-search';

const LIST_WIDTH_KEY = 'chatofy.history-list-width';
const LIST_WIDTH_DEFAULT = 360;
const LIST_WIDTH_MIN = 280;
// Leaves the reading pane at least ~540px at the 1024px content width the layout
// starts at — enough for a transcript turn at a readable measure.
const LIST_WIDTH_MAX = 480;

/**
 * History as one screen: the list on the left, the open conversation on the right.
 *
 * Rendered by `app/(app)/history/layout.tsx`, so it does NOT remount when the reader
 * moves between conversations — the search term, every page loaded so far and the
 * list's scroll position all survive a click on a row. `children` is the page: the
 * conversation at `/history/[id]`, or the newest one at `/history`.
 *
 * ## Two panes from a 64rem CONTENT width, one page below it
 *
 * Measured on this element (`@container`, `@5xl:`), not the viewport, so a collapsed
 * sidebar counts. Below it the routes are two pages, exactly as before: `/history` is
 * the list and `/history/[id]` is the conversation with a back link. From it both
 * panes are drawn and each scrolls on its own; the frame pins itself to the viewport
 * (`app-chrome.tsx`) so the page itself does not scroll.
 *
 * The layout is CSS, so the first paint is already the right shape. JavaScript only
 * learns the width to decide what is worth fetching (`useContainerWide`).
 *
 * ## The accent budget
 *
 * The list spends none: its job is finding, and the sidebar already offers a new
 * conversation on every screen. Whatever the reading pane spends is the screen's.
 */
export function HistoryMasterDetail({ children }: { children: ReactNode }) {
  return (
    // `useSearchParams` needs one, for the reason /login and /verify-email give.
    <Suspense fallback={null}>
      <HistoryMasterDetailBody>{children}</HistoryMasterDetailBody>
    </Suspense>
  );
}

function HistoryMasterDetailBody({ children }: { children: ReactNode }) {
  const t = useTranslate();
  const params = useParams<{ conversationId?: string }>();
  const openId = params?.conversationId;

  const frame = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const wide = useContainerWide(frame);
  const search = useHistorySearch();
  const history = useConversationHistory(search.debounced);
  const listWidth = useStoredWidth(
    LIST_WIDTH_KEY,
    LIST_WIDTH_DEFAULT,
    LIST_WIDTH_MIN,
    LIST_WIDTH_MAX,
  );

  // Read off `debounced`, NOT `term`: the moment a reader backspaces their query
  // away both are empty, but `loading` only goes true when the debounce fires — so
  // keyed on `term` the field would disable itself mid-gesture over the empty
  // result of the query being cleared, and a disabled input is blurred.
  const nothingToSearch =
    search.debounced.trim() === '' &&
    !history.loading &&
    !history.error &&
    history.conversations.length === 0;

  // An account with nothing stored is one column even on a wide screen: there is
  // nothing to open, and the empty state is the whole page rather than a 360px strip.
  const solo = nothingToSearch;

  // On `/history` the newest row is the one open beside the list — but only where
  // the reading pane is drawn. On a phone `/history` is the list alone.
  const selectedId = openId ?? (wide ? history.conversations[0]?.conversationId : undefined);

  // A new conversation starts at its top. The pane is the layout's, so it would
  // otherwise keep the scroll offset of whichever conversation was read before.
  useEffect(() => {
    detail.current?.scrollTo?.({ top: 0 });
  }, [selectedId]);

  const panes = useMemo<HistoryPanes>(
    () => ({
      conversations: history.conversations,
      loading: history.loading,
      wide,
      listHref: `/history${search.querySuffix}`,
      forget: history.forget,
    }),
    [history.conversations, history.loading, wide, search.querySuffix, history.forget],
  );

  return (
    <HistoryPanesProvider value={panes}>
      <div ref={frame} className="@container flex min-h-0 flex-1 flex-col">
        <div
          className="flex min-h-0 flex-1"
          style={{ '--history-list-width': `${listWidth.width}px` } as CSSProperties}
        >
          <div
            className={cn(
              'relative min-h-0 w-full min-w-0 flex-col',
              openId ? 'hidden @5xl:flex' : 'flex',
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
                {/* Pinned to the top of the pane where the list scrolls on its own;
                    in the one-page layout the field scrolls away with the page. */}
                <div
                  className={cn(
                    !solo && 'bg-background @5xl:sticky @5xl:top-0 @5xl:z-20 @5xl:px-1',
                  )}
                >
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
                  querySuffix={search.querySuffix}
                />
              </div>
            </div>
            {wide && !solo && listWidth.ready ? (
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

          {solo ? null : (
            <div
              ref={detail}
              className={cn(
                'min-h-0 min-w-0 flex-1 overflow-y-auto',
                openId ? 'block' : 'hidden @5xl:block',
              )}
            >
              <div
                className={cn(
                  'mx-auto w-full px-6 py-8',
                  MEASURE.wide,
                  '@5xl:max-w-none @5xl:px-10 @5xl:py-6',
                )}
              >
                {children}
              </div>
            </div>
          )}
        </div>
      </div>
    </HistoryPanesProvider>
  );
}
