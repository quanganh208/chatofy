'use client';

import Link from 'next/link';
import type { Route } from 'next';
import type { ConversationSummary } from '@chatofy/types';
import { Badge, Button, Card, CardContent } from '@chatofy/ui/react';
import { useLocale, useTranslate } from '@/i18n/provider';

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
}

/**
 * Past conversations, newest first.
 *
 * Every row is a plain link and the delete lives on the detail screen, so this
 * screen spends its single accent-filled control on the one action that starts
 * something — see the page.
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
}: HistoryListProps) {
  const t = useTranslate();
  const locale = useLocale();

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-destructive">{t('web.history.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('web.history.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Only when there is nothing to keep. A search term is part of the list key, so
  // `loading` goes true on every debounced keystroke — returning the loading card
  // here unconditionally replaced the rows the reader was looking at with the word
  // "Loading", once per character typed. The reasoning is the one already written
  // for `loadMoreError` below: replacing rows with a status loses everything read
  // so far. Rows that briefly belong to the previous query are the better trade,
  // and `aria-busy` on the list says so without moving anything.
  if (loading && conversations.length === 0) {
    return (
      <Card>
        <CardContent>
          <p className="text-muted-foreground">{t('web.history.loading')}</p>
        </CardContent>
      </Card>
    );
  }

  if (conversations.length === 0) {
    // "Nothing matched" and "you have no history" are different facts, and
    // telling a searching reader they have never had a conversation is the
    // more alarming of the two ways to be wrong.
    return (
      <Card>
        <CardContent className="flex flex-col gap-2">
          {searching ? (
            <p className="text-muted-foreground">{t('web.history.searchNoResults')}</p>
          ) : (
            <>
              <p className="text-body font-semibold">{t('web.history.empty')}</p>
              <p className="text-muted-foreground text-prose max-w-prose">
                {t('web.history.emptyBody')}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3" aria-busy={loading}>
        {conversations.map((conversation) => (
          <li key={conversation.conversationId}>
            <Card>
              <CardContent>
                <Link
                  href={`/history/${conversation.conversationId}` as Route}
                  className="focus-visible:ring-ring/50 flex flex-col gap-2 rounded-sm focus-visible:ring-[3px] focus-visible:outline-none"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-medium">
                      {formatDate(conversation.startedAt, locale)}
                    </span>
                    <Badge variant="outline">
                      {t(
                        conversation.direction === 'vi_to_en'
                          ? 'web.history.directionViToEn'
                          : 'web.history.directionEnToVi',
                      )}
                    </Badge>
                    <span className="text-muted-foreground text-hint">
                      {t('web.history.turnCount', { count: conversation.turnCount })}
                    </span>
                    <span className="text-muted-foreground text-hint">
                      {t('web.history.duration', {
                        minutes: durationMinutes(conversation),
                      })}
                    </span>
                    {/* Only when minutes actually exist — the field is read from
                        the relation, so this cannot claim a summary nobody ran. */}
                    {conversation.hasMinutes ? (
                      <Badge variant="secondary">{t('web.history.minutesReady')}</Badge>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-prose line-clamp-2 max-w-prose">
                    {conversation.preview}
                  </p>
                </Link>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {hasMore ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {t('web.history.loadMore')}
          </Button>
          {/* Beside the control that failed, and only there. A next page that
              did not arrive says nothing about the conversations above it, and
              replacing them with an error card would lose everything read so
              far — pressing the button again is the whole recovery.

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
 * Whole minutes, rounded up, so a 40-second conversation does not read "0 min".
 *
 * Both timestamps come from a browser clock, which is why the API bounds them at
 * the boundary — an unbounded pair could render a duration measured in years.
 */
function durationMinutes(conversation: ConversationSummary): number {
  const ms = Date.parse(conversation.endedAt) - Date.parse(conversation.startedAt);
  return Math.max(1, Math.round(ms / 60_000));
}

/** The reader's own locale formatting; no date library for one call site. */
function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
