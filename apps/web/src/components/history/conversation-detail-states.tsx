'use client';

import { FileX2 } from 'lucide-react';
import { Skeleton } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

/**
 * The first load, in the shape of what it becomes: a title, a meta line, the tab
 * row, and transcript blocks on the page ground.
 *
 * Not a sentence in a box: the loading and the not-found states used to be the
 * same paragraph two branches apart, so for the first frame a conversation that
 * was gone looked exactly like one that was arriving. The sentence is still said,
 * to screen readers, where `aria-busy` alone would leave a blank silence.
 */
export function ConversationDetailLoading() {
  const t = useTranslate();

  return (
    <div aria-busy className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {t('web.history.loading')}
      </p>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-full max-w-[24ch]" />
        <Skeleton className="h-3 w-full max-w-[40ch]" />
      </div>
      <Skeleton className="h-6 w-40" />
      <ul className="flex flex-col gap-4">
        {[0, 1, 2].map((turn) => (
          <li key={turn} className="border-hairline flex flex-col gap-1.5 border-l-2 pl-4">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-3.5 w-full max-w-[40ch]" />
            <Skeleton className="h-4 w-full max-w-[34ch]" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A foreign or deleted id. A state of the pane, not an object on it — so it is drawn
 * on the ground. One message for every failure: a foreign id and an absent one
 * answer identically by design, so the screen must not claim to tell them apart.
 */
export function ConversationDetailMissing() {
  const t = useTranslate();

  return (
    <div className="flex flex-col items-center gap-3 px-2 pt-8 pb-6 text-center">
      <FileX2 aria-hidden className="text-border-strong size-16" strokeWidth={1.25} />
      <p className="text-body font-semibold">{t('web.history.notFound')}</p>
      <p className="text-muted-foreground text-prose max-w-[46ch]">
        {t('web.history.notFoundBody')}
      </p>
    </div>
  );
}
