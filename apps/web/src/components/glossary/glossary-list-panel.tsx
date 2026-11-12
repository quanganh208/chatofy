'use client';

import { BookOpen } from 'lucide-react';
import { dawn } from '@chatofy/ui';
import { Button, Skeleton } from '@chatofy/ui/react';
import { LANGUAGES } from '@chatofy/types';
import type { Glossary } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

interface Props {
  glossaries: Glossary[];
  status: 'loading' | 'ready' | 'failed';
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Try loading again; shown beside the failure message. */
  onRetry: () => void;
  className?: string;
}

/**
 * The left pane: one row per glossary, on the page ground — History's list
 * grammar, so the two Library screens read alike. A row is one button that opens
 * the glossary beside it (or, on a phone, in its place); what you DO to a glossary
 * is in the detail pane, so a row carries no buttons of its own.
 *
 * Selected is the muted fill plus the sidebar's dawn bar, as on History's rows;
 * `aria-current` is what says it.
 */
export function GlossaryListPanel({
  glossaries,
  status,
  selectedId,
  onSelect,
  onRetry,
  className,
}: Props) {
  const t = useTranslate();

  return (
    <nav aria-label={t('web.glossary.title')} className={cn('flex flex-col gap-1', className)}>
      {status === 'loading' ? (
        <div aria-busy className="flex flex-col gap-2 px-3 py-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : null}

      {status === 'failed' ? (
        <div role="alert" className="flex flex-col items-start gap-2 px-3 py-2">
          <p className="text-body text-destructive">{t('web.glossary.loadFailed')}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('web.error.retry')}
          </Button>
        </div>
      ) : null}

      {status === 'ready' && glossaries.length === 0 ? (
        // The same shape as History's empty list: an icon, a bold title, one sentence.
        <div
          data-slot="glossary-empty"
          className="flex flex-col items-center gap-3 px-2 pt-6 pb-4 text-center"
        >
          <BookOpen aria-hidden className="text-border-strong size-12" strokeWidth={1.25} />
          <p className="text-body font-semibold">{t('web.glossary.emptyTitle')}</p>
          <p className="text-muted-foreground text-body">{t('web.glossary.emptyList')}</p>
        </div>
      ) : null}

      {status === 'ready' && glossaries.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {glossaries.map((glossary) => {
            const selected = glossary.id === selectedId;
            const lang = LANGUAGES[glossary.sourceLang]?.label ?? glossary.sourceLang;
            return (
              <li key={glossary.id}>
                <button
                  type="button"
                  data-slot="glossary-row"
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(glossary.id)}
                  className={cn(
                    'relative flex w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left',
                    'hover:bg-muted focus-visible:bg-muted focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none',
                    'duration-fast ease-standard transition-colors motion-reduce:transition-none',
                    selected && 'bg-muted',
                  )}
                >
                  {selected ? (
                    <span
                      aria-hidden
                      className="absolute inset-y-1.5 -left-1 w-1 rounded-full"
                      style={{
                        backgroundImage: `linear-gradient(180deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`,
                      }}
                    />
                  ) : null}
                  <span className="text-body truncate font-medium">{glossary.name}</span>
                  <span className="text-hint text-muted-foreground truncate">
                    {[
                      lang,
                      t('web.glossary.termCount', { count: glossary.itemCount }),
                      glossary.isActive ? null : t('web.glossary.badgeInactive'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </nav>
  );
}
