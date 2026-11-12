'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { MEASURE } from '@/components/layout/measures';
import { useConversationHistory } from '@/hooks/use-conversation-history';
import { useStoredWidth } from '@/hooks/use-stored-width';
import { cn } from '@/lib/utils';
import { ConversationDetail } from './conversation-detail';
import { ConversationDetailLoading } from './conversation-detail-states';
import { HistoryListPane, LIST_WIDTH_MAX, LIST_WIDTH_MIN } from './history-list-pane';
import { HistoryPanesProvider, type HistoryPanes } from './history-panes-context';
import { useContainerWide, WIDE_PROBE_CLASS } from './use-container-wide';
import { useHistorySearch } from './use-history-search';
import { useHistoryRowActions } from './use-history-row-actions';
import { useHistorySelection } from './use-history-selection';

const LIST_WIDTH_KEY = 'chatofy.history-list-width';
const LIST_WIDTH_DEFAULT = 360;

/**
 * History as one screen: the list on the left, the open conversation on the right.
 *
 * Rendered by `app/(app)/history/layout.tsx`, so it does NOT remount when the reader
 * moves between conversations — the search term, every page loaded so far and the
 * list's scroll position all survive a click on a row.
 *
 * **The conversation is rendered HERE, not by the pages**, keyed by the selected id.
 * `/history` (the newest, opened by default) and `/history/<newest-id>` (its row,
 * clicked) are different pages showing the same conversation; rendered by each page
 * they were two elements, so the most natural click on the screen refetched what was
 * already open, reset its tab and stopped its audio. Keyed here, they are one. The
 * pages render nothing and exist for their URLs and metadata.
 *
 * ## Two panes from a 64rem CONTENT width, one page below it
 *
 * Measured on this element (`@container`, `@5xl:`), not the viewport, so a collapsed
 * sidebar counts. Below it the routes are two pages: `/history` is the list and
 * `/history/[id]` the conversation with a back link. From it both panes are drawn
 * and each scrolls on its own; the frame pins itself to the viewport
 * (`app-chrome.tsx`) so the page itself does not scroll. A probe carrying the same
 * container query tells JavaScript which layout CSS chose (`useContainerWide`).
 *
 * ## The accent budget
 *
 * The list spends none: its job is finding. Whatever the reading pane spends is the
 * screen's.
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
  const params = useParams<{ conversationId?: string }>();
  const openId = params?.conversationId;

  const frame = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const listRegion = useRef<HTMLDivElement>(null);
  const wide = useContainerWide(frame, probe);
  const search = useHistorySearch();
  const history = useConversationHistory(search.debounced);
  const listWidth = useStoredWidth(
    LIST_WIDTH_KEY,
    LIST_WIDTH_DEFAULT,
    LIST_WIDTH_MIN,
    LIST_WIDTH_MAX,
  );
  const { selectedId, unpin } = useHistorySelection(openId, wide, history.conversations);

  // Read off `debounced`, NOT `term`: the moment a reader backspaces their query
  // away both are empty, but `loading` only goes true when the debounce fires — so
  // keyed on `term` the field would disable itself mid-gesture over the empty
  // result of the query being cleared, and a disabled input is blurred.
  const nothingToSearch =
    search.debounced.trim() === '' &&
    !history.loading &&
    !history.error &&
    history.conversations.length === 0;

  // An account with nothing stored is one column even on a wide screen — unless a
  // URL names a conversation, which must still get its answer ("no longer here")
  // rather than a list pane that is hidden on a phone and silent on a desktop.
  const solo = nothingToSearch && !openId;

  // A new conversation starts at its top. The pane is the layout's, so it would
  // otherwise keep the scroll offset of whichever conversation was read before.
  useEffect(() => {
    detail.current?.scrollTo?.({ top: 0 });
  }, [selectedId]);

  // A deep link's row, brought into the list's view once the first page is in.
  // `nearest`, so a row already on screen does not move.
  const revealed = useRef(false);
  useEffect(() => {
    if (revealed.current || !openId || history.loading) return;
    revealed.current = true;
    listRegion.current
      ?.querySelector('a[aria-current="page"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [openId, history.loading]);

  // Focus after a delete: the control that had it is gone. The conversation that
  // opens next takes it (see `takeFocusRequest`); when none does — a phone, or the
  // last conversation deleted — the list does.
  const focusRequested = useRef(false);
  useEffect(() => {
    if (!focusRequested.current || selectedId || history.loading) return;
    focusRequested.current = false;
    listRegion.current?.focus();
  }, [selectedId, history.loading]);

  const { forget: forgetRow } = history;
  const forget = useCallback(
    (conversationId: string) => {
      focusRequested.current = true;
      forgetRow(conversationId);
      unpin(conversationId);
    },
    [forgetRow, unpin],
  );
  const takeFocusRequest = useCallback(() => {
    const requested = focusRequested.current;
    focusRequested.current = false;
    return requested;
  }, []);

  const listHref = `/history${search.querySuffix}`;
  const rows = useHistoryRowActions({
    history,
    search,
    selectedId,
    forget,
    listHref,
    listRegion,
  });

  const panes = useMemo<HistoryPanes>(
    () => ({
      listHref,
      forget,
      takeFocusRequest,
      ...rows,
    }),
    [listHref, forget, takeFocusRequest, rows],
  );

  return (
    <HistoryPanesProvider value={panes}>
      <div ref={frame} className="@container flex min-h-0 flex-1 flex-col">
        <div ref={probe} aria-hidden className={WIDE_PROBE_CLASS} />
        <div className="flex min-h-0 flex-1">
          <HistoryListPane
            search={search}
            history={history}
            selectedId={selectedId}
            hasOpenId={openId !== undefined}
            solo={solo}
            resizable={wide && !solo && listWidth.ready}
            nothingToSearch={nothingToSearch}
            listWidth={listWidth}
            regionRef={listRegion}
          />

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
                {selectedId ? (
                  <ConversationDetail key={selectedId} conversationId={selectedId} />
                ) : wide && history.loading ? (
                  <ConversationDetailLoading />
                ) : null}
                {children}
              </div>
            </div>
          )}
        </div>
      </div>
    </HistoryPanesProvider>
  );
}
