'use client';

import { MessagesSquare, SearchX } from 'lucide-react';
import { Button, Skeleton } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

/**
 * The list's states other than rows. Each is a state of the whole list, so each is
 * a region on the page ground, never a card.
 */

/** The first page failed: a notice and a retry. Outline — the reader did not cause it. */
export function HistoryListFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslate();
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

/**
 * "Nothing matched" — drawn where row one would be, directly under the field still
 * being typed in, with the one way back that needs no editing.
 */
export function HistoryListNoMatch({ onClearSearch }: { onClearSearch: () => void }) {
  const t = useTranslate();
  return (
    <div className="border-hairline -mx-2 flex flex-wrap items-center gap-3 border-y px-2 py-3.5">
      <SearchX aria-hidden className="text-muted-foreground size-[18px] shrink-0" />
      <p className="text-muted-foreground text-body flex-1 basis-50">
        {t('web.history.searchNoResults')}
      </p>
      <Button variant="ghost" size="sm" onClick={onClearSearch}>
        {t('web.history.clearSearch')}
      </Button>
    </div>
  );
}

/** Never having had a conversation: the whole page, and where history is explained. */
export function HistoryListEmpty() {
  const t = useTranslate();
  return (
    <div className="flex flex-col items-center gap-3 px-2 pt-8 pb-6 text-center">
      <MessagesSquare aria-hidden className="text-border-strong size-16" strokeWidth={1.25} />
      <p className="text-body font-semibold">{t('web.history.empty')}</p>
      <p className="text-muted-foreground text-prose max-w-[46ch]">{t('web.history.emptyBody')}</p>
    </div>
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
export function HistoryListLoading() {
  const t = useTranslate();
  return (
    <div className="flex flex-col gap-1">
      <p role="status" className="sr-only">
        {t('web.history.loading')}
      </p>
      {[0, 1].map((group) => (
        <section key={group} className="mt-5 first:mt-0">
          <Skeleton className="mb-1.5 h-[11px] w-18" />
          <ul aria-busy className="flex flex-col">
            {[0, 1, 2].map((row) => (
              <li key={row} className="flex flex-col gap-1.5 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-3.5 max-w-[28ch] flex-1" />
                  <Skeleton className="h-3 w-12 shrink-0" />
                </div>
                <Skeleton className="h-3 w-full max-w-[36ch]" />
                <Skeleton className="h-3 w-40" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
