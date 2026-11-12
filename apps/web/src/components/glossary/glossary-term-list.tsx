'use client';

import { useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button, Input, Skeleton } from '@chatofy/ui/react';
import { LANGUAGES } from '@chatofy/types';
import type { GlossaryItem } from '@chatofy/types';
import { ConfirmDeleteButton } from '@/components/layout/confirm-delete-button';
import { useTranslate } from '@/i18n/provider';

interface Props {
  items: GlossaryItem[];
  status: 'idle' | 'loading' | 'ready' | 'failed';
  onEdit: (item: GlossaryItem) => void;
  /** Rejects when the server refused; the confirm dialog says so and stays open. */
  onRemove: (item: GlossaryItem) => Promise<void>;
}

/**
 * The open glossary's terms: a filter, then one row per term between hairlines on
 * the page ground — no box around the list. Each row carries Edit (a dialog) and
 * Delete (the shared AlertDialog confirm), both ghost.
 */
export function GlossaryTermList({ items, status, onEdit, onRemove }: Props) {
  const t = useTranslate();
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.original.toLowerCase().includes(q) || item.translation.toLowerCase().includes(q),
    );
  }, [items, filter]);

  return (
    <div className="flex flex-col gap-3">
      {status === 'ready' && items.length > 0 ? (
        <Input
          aria-label={t('web.glossary.filterTerms')}
          placeholder={t('web.glossary.filterTerms')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="max-w-sm"
        />
      ) : null}

      {status === 'loading' ? (
        <div aria-busy className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : null}

      {status === 'failed' ? (
        <p role="alert" className="text-body text-destructive">
          {t('web.glossary.loadTermsFailed')}
        </p>
      ) : null}

      {status === 'ready' && filtered.length === 0 ? (
        <p className="text-body text-muted-foreground">
          {filter ? t('web.glossary.noTermsMatch') : t('web.glossary.noTerms')}
        </p>
      ) : null}

      {status === 'ready' && filtered.length > 0 ? (
        <ul className="divide-hairline border-hairline divide-y border-y">
          {filtered.map((item) => {
            const lang = LANGUAGES[item.targetLang]?.label ?? item.targetLang;
            return (
              <li
                key={item.id}
                data-slot="glossary-term"
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
              >
                <div className="min-w-0 flex-[1_1_16rem]">
                  <p className="text-body flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-medium">{item.original}</span>
                    <span aria-hidden className="text-muted-foreground text-hint">
                      →
                    </span>
                    <span className="sr-only">{t('web.glossary.translatesTo')}</span>
                    <span>{item.translation}</span>
                    <span className="text-hint text-muted-foreground">({lang})</span>
                  </p>
                  {item.notes ? (
                    <p className="text-hint text-muted-foreground truncate">{item.notes}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('web.glossary.editTermNamed', { term: item.original })}
                    onClick={() => onEdit(item)}
                  >
                    <Pencil aria-hidden />
                    {t('web.glossary.editTerm')}
                  </Button>
                  <ConfirmDeleteButton
                    triggerVariant="ghost"
                    name={item.original}
                    labels={{
                      action: t('web.glossary.delete'),
                      pending: t('web.glossary.deleting'),
                      cancel: t('web.glossary.cancel'),
                      failed: t('web.glossary.termDeleteFailed'),
                    }}
                    onConfirm={() => onRemove(item)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
