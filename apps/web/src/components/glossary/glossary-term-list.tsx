'use client';

import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Input, Skeleton } from '@chatofy/ui/react';
import { LANGUAGES } from '@chatofy/types';
import type { GlossaryItem } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

interface Props {
  items: GlossaryItem[];
  status: 'idle' | 'loading' | 'ready' | 'failed';
  onRemove: (itemId: string) => Promise<void>;
}

export function GlossaryTermList({ items, status, onRemove }: Props) {
  const t = useTranslate();
  const [filter, setFilter] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.original.toLowerCase().includes(q) || item.translation.toLowerCase().includes(q),
    );
  }, [items, filter]);

  async function handleRemove(itemId: string) {
    setRemoving(itemId);
    try {
      await onRemove(itemId);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {(status === 'ready' || status === 'loading') && (
        <Input
          placeholder={t('web.glossary.filterTerms')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}

      {status === 'loading' && (
        <div className="space-y-2">
          <Skeleton className="h-10 rounded" />
          <Skeleton className="h-10 rounded" />
          <Skeleton className="h-10 rounded" />
        </div>
      )}

      {status === 'failed' && (
        <p className="text-sm text-destructive">{t('web.glossary.loadTermsFailed')}</p>
      )}

      {status === 'ready' && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {filter ? t('web.glossary.noTermsMatch') : t('web.glossary.noTerms')}
        </p>
      )}

      {status === 'ready' && filtered.length > 0 && (
        <div className="divide-y rounded-lg border overflow-hidden">
          {filtered.map((item) => {
            const langLabel =
              LANGUAGES[item.targetLang as keyof typeof LANGUAGES]?.label ?? item.targetLang;
            return (
              <div key={item.id} className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted/40">
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-medium text-sm">{item.original}</span>
                    <span className="text-muted-foreground text-xs">â†’</span>
                    <span className="text-sm">{item.translation}</span>
                    <span className="text-xs text-muted-foreground">({langLabel})</span>
                  </div>
                  {item.notes && (
                    <p className="text-xs text-muted-foreground truncate">{item.notes}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                  disabled={removing === item.id}
                  onClick={() => void handleRemove(item.id)}
                  title={t('web.glossary.removeTerm')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
