'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { ChevronRight, MessagesSquare, SearchX } from 'lucide-react';
import type { ConversationSummary } from '@chatofy/types';
import { Badge, Button, Skeleton } from '@chatofy/ui/react';
import { useLocale, useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import { durationMinutes, formatTime, groupByDay } from './conversation-formatting';
import { DirectionLabel } from './direction-label';

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
}

/**
 * Past conversations, newest first — rows on the page ground.
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
}: HistoryListProps) {
  const t = useTranslate();
  const locale = useLocale();

  if (error) {
    return (
      <div
        role="alert"
        className="border-hairline -mx-2 flex flex-wrap items-center gap-3 border-y px-2 py-3.5"
      >
        <p className="text-destructive text-body flex-1 basis-60">{t('web.history.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('web.history.retry')}
        </Button>
      </div>
    );
  }

  // Only when there is nothing to keep. A search term is part of the list key, so
  // `loading` goes true on every debounced keystroke — showing the skeleton here
  // unconditionally replaced the rows the reader was looking at, once per
  // character typed. Rows that briefly belong to the previous query are the
  // better trade; they dim, and `aria-busy` says so without moving anything.
  if (loading && conversations.length === 0) {
    return <LoadingRows label={t('web.history.loading')} />;
  }

  if (conversations.length === 0) {
    // "Nothing matched" and "you have no history" are different facts, and they
    // are drawn at different sizes rather than only worded differently. The
    // search result belongs where row one would be, directly under the field
    // still being typed in; never having had a conversation is the whole page.
    return searching ? (
      <div className="border-hairline -mx-2 flex flex-wrap items-center gap-3 border-y px-2 py-3.5">
        <SearchX aria-hidden className="text-muted-foreground size-[18px] shrink-0" />
        <p className="text-muted-foreground text-body flex-1 basis-50">
          {t('web.history.searchNoResults')}
        </p>
        <Button variant="ghost" size="sm" onClick={onClearSearch}>
          {t('web.history.clearSearch')}
        </Button>
      </div>
    ) : (
      <div className="flex flex-col items-center gap-3 px-2 pt-8 pb-6 text-center">
        <MessagesSquare aria-hidden className="text-border-strong size-16" strokeWidth={1.25} />
        <p className="text-body font-semibold">{t('web.history.empty')}</p>
        <p className="text-muted-foreground text-prose max-w-[46ch]">
          {t('web.history.emptyBody')}
        </p>
      </div>
    );
  }

  const groups = groupByDay(conversations, locale);

  return (
    <div className="flex flex-col gap-1">
      {groups.map((group) => (
        <section key={group.key} className="mt-5 first:mt-0">
          <h2 className="text-label text-muted-foreground pb-1.5 uppercase">{group.label}</h2>
          <ul
            aria-busy={loading}
            className={cn(
              'border-hairline divide-hairline duration-base ease-standard divide-y border-y transition-opacity motion-reduce:transition-none',
              // Retained under a search that is in flight, and dimmed to say so.
              // The row you can still see is still the row you wanted.
              loading && 'opacity-55',
            )}
          >
            {group.conversations.map((conversation) => (
              <li key={conversation.conversationId}>
                <Row conversation={conversation} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {hasMore ? (
        <div className="flex flex-wrap items-center gap-3 pt-2">
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

/**
 * One conversation.
 *
 * The whole row is the link and therefore one tab stop — someone scanning does
 * not want to hunt for the few characters of date text that happened to be
 * anchored. **It does not lift on hover.** Lifting is what a button does, and
 * the control vocabulary rests on that asymmetry; a row that lifted would make
 * eight objects out of eight regions. Hover and focus are one step up the
 * neutral scale, and nothing moves.
 */
function Row({ conversation }: { conversation: ConversationSummary }) {
  const t = useTranslate();
  const locale = useLocale();

  return (
    <Link
      href={`/history/${conversation.conversationId}` as Route}
      className="hover:bg-muted focus-visible:bg-muted focus-visible:ring-ring/50 -mx-2 grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 rounded-md px-2 py-2.5 duration-fast ease-standard transition-colors motion-reduce:transition-none focus-visible:ring-[3px] focus-visible:outline-none max-[460px]:grid-cols-[minmax(0,1fr)_auto]"
    >
      <time
        dateTime={conversation.startedAt}
        className="text-hint text-muted-foreground col-start-1 row-start-1 pt-px text-right tabular-nums whitespace-nowrap max-[460px]:text-left"
      >
        {formatTime(conversation.startedAt, locale)}
      </time>

      <div className="col-start-2 row-start-1 min-w-0 max-[460px]:col-start-1 max-[460px]:col-end-3 max-[460px]:row-start-2">
        {/* The preview is what IDENTIFIES a conversation, so it is the ink line;
            the time only orders them. One line, not two: two lines times eight
            rows is sixteen lines of grey. */}
        <p className="text-body truncate">{conversation.preview}</p>
        <p className="text-hint text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="text-foreground font-medium">
            <DirectionLabel direction={conversation.direction} />
          </span>
          <Dot />
          {t('web.history.turnCount', { count: conversation.turnCount })}
          <Dot />
          {t('web.history.duration', { minutes: durationMinutes(conversation) })}
        </p>
      </div>

      <span className="col-start-3 row-start-1 flex items-center gap-2 pt-px max-[460px]:col-start-2">
        {/* Only when minutes actually exist — the field is read from the
            relation, so this cannot claim a summary nobody ran. On the right
            edge, so their presence reads down one column instead of being
            hunted inside eight meta lines. */}
        {conversation.hasMinutes ? (
          <Badge variant="secondary">{t('web.history.minutesReady')}</Badge>
        ) : null}
        <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
      </span>
    </Link>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-border-strong">
      ·
    </span>
  );
}

/**
 * The first load, in the geometry of the list it becomes.
 *
 * Not the word "Loading" in a box: the first paint and the loaded paint are then
 * the same shape and nothing jumps. Six rows rather than three, because density
 * is the point of this screen and a skeleton showing less than a screenful
 * teaches the reader to expect less than one.
 *
 * The sentence is still said, to screen readers, where `aria-busy` alone would
 * leave a blank silence.
 */
function LoadingRows({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p role="status" className="sr-only">
        {label}
      </p>
      {[0, 1].map((group) => (
        <section key={group} className="mt-5 first:mt-0">
          <Skeleton className="mb-1.5 h-[11px] w-18" />
          <ul aria-busy className="border-hairline divide-hairline divide-y border-y">
            {[0, 1, 2].map((row) => (
              <li key={row} className="flex items-start gap-3 px-0 py-2.5">
                <Skeleton className="mt-px h-3 w-9 shrink-0" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-full max-w-[34ch]" />
                  <Skeleton className="mt-1.5 h-3 w-32" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
