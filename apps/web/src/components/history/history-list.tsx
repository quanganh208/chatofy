'use client';

import type { ConversationSummary } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { useLocale, useTranslate } from '@/i18n/provider';
import { groupByDay } from './conversation-formatting';
import { HistoryListRow } from './history-list-row';
import {
  HistoryListEmpty,
  HistoryListFailed,
  HistoryListLoading,
  HistoryListNoMatch,
} from './history-list-states';

interface HistoryListProps {
  conversations: ConversationSummary[];
  loading: boolean;
  loadingMore: boolean;
  /** The first page failed, so there is nothing to show. */
  error: boolean;
  /** A further page failed. The rows already read stay on screen. */
  loadMoreError: boolean;
  /** A search term is in effect, so "nothing here" means "nothing matched". */
  searching: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  /** Empty the search box. The only way back to the full list without editing text. */
  onClearSearch: () => void;
  /** The conversation open beside the list, marked as the current one. */
  selectedId?: string;
  /** `?q=…` while searching, carried into every row's link. */
  querySuffix?: string;
  /** A row is being opened in place (a plain click, not a new tab). */
  onOpen?: () => void;
}

/**
 * Past conversations, newest first — rows on the page ground, one column whether
 * the list is the whole page or the pane beside an open conversation.
 *
 * ## Why nothing here is a card
 *
 * A card is for a thing you act on as a unit. Twenty conversations are twenty
 * ROWS: each one wrapped in its own elevated surface is the same failure
 * `conversation-transcript.tsx` names for turns, where identical bordered boxes
 * stack until none of them has any rhythm. Separation is a hairline and the day
 * heading. The loading, empty and failed states are states of the whole screen,
 * so they are regions on the ground too.
 *
 * The only shadowed things left are CONTROLS — "Load more", "Try again" — and a
 * control is an object on the surface rather than a surface. Elevated surfaces
 * on this screen: zero.
 *
 * ## The accent budget
 *
 * Zero accent-filled controls, which is under the ceiling rather than over it.
 * The screen's own action used to be a filled "Start a conversation" in the
 * header; it invited the same destination the sidebar's Translate entry does,
 * 200px away, on every app screen. This screen's job is finding.
 */
export function HistoryList({
  conversations,
  loading,
  loadingMore,
  error,
  loadMoreError,
  searching,
  hasMore,
  onLoadMore,
  onRetry,
  onClearSearch,
  selectedId,
  querySuffix = '',
  onOpen,
}: HistoryListProps) {
  const t = useTranslate();
  const locale = useLocale();

  if (error) return <HistoryListFailed onRetry={onRetry} />;

  // Only when there is nothing to keep. A search term is part of the list key, so
  // `loading` goes true on every debounced keystroke — showing the skeleton here
  // unconditionally replaced the rows the reader was looking at, once per
  // character typed. Rows that briefly belong to the previous query are the
  // better trade; they dim, and `aria-busy` says so without moving anything.
  if (loading && conversations.length === 0) {
    return <HistoryListLoading />;
  }

  if (conversations.length === 0) {
    // "Nothing matched" and "you have no history" are different facts, and they
    // are drawn at different sizes rather than only worded differently. The
    // search result belongs where row one would be, directly under the field
    // still being typed in; never having had a conversation is the whole page.
    return searching ? <HistoryListNoMatch onClearSearch={onClearSearch} /> : <HistoryListEmpty />;
  }

  const groups = groupByDay(conversations, locale);

  return (
    <div className="flex flex-col gap-1">
      {groups.map((group) => (
        <section key={group.id} className="mt-5 first:mt-0">
          <h2 className="text-label text-muted-foreground px-3 pb-1.5 uppercase">{group.label}</h2>
          <ul
            aria-busy={loading}
            // Retained under a search that is in flight, and NOT dimmed to say
            // so. The mockup drew the stale list at `opacity: .55`; measured
            // against the ground that composites the preview line — the ink line,
            // the one being read — down to 4.07:1 and the meta line to 2.17:1,
            // under the 4.5 floor `contrast-floors.spec.ts` holds every token to.
            // That spec checks tokens and cannot see a composited alpha, so this
            // would have passed every gate while breaking the rule they exist for.
            // `aria-busy` carries the same fact at no cost.
            className="flex flex-col"
          >
            {group.conversations.map((conversation) => (
              <li key={conversation.conversationId}>
                <HistoryListRow
                  conversation={conversation}
                  selected={conversation.conversationId === selectedId}
                  querySuffix={querySuffix}
                  onOpen={onOpen}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {hasMore ? (
        <div className="flex flex-wrap items-center gap-3 px-3 pt-2">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {t('web.history.loadMore')}
          </Button>
          {/* Beside the control that failed, and only there. A next page that
              did not arrive says nothing about the conversations above it, and
              replacing them with an error would lose everything read so far —
              pressing the button again is the whole recovery.

              `role="alert"` because the press changes nothing else a screen
              reader would notice: the list is the same length and focus has not
              moved, so without a live region a failed load is silent. */}
          {loadMoreError ? (
            <p role="alert" className="text-destructive text-hint">
              {t('web.history.loadMoreFailed')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
