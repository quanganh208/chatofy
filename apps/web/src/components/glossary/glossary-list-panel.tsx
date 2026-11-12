'use client';

import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Button, Skeleton } from '@chatofy/ui/react';
import { GLOSSARY_LIMITS } from '@chatofy/types';
import type { Glossary, SaveGlossaryRequest } from '@chatofy/types';
import { GlossaryCard } from './glossary-card';
import { GlossaryCreateForm } from './glossary-create-form';
import { useTranslate } from '@/i18n/provider';

interface Props {
  glossaries: Glossary[];
  status: 'loading' | 'ready' | 'failed';
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSave: (glossaryId: string, body: SaveGlossaryRequest) => Promise<void>;
  onToggleActive: (glossaryId: string) => Promise<void>;
  onDelete: (glossaryId: string) => Promise<void>;
  /** Try loading again; shown beside the failure message. */
  onRetry: () => void;
}

export function GlossaryListPanel({
  glossaries,
  status,
  selectedId,
  onSelect,
  onSave,
  onToggleActive,
  onDelete,
  onRetry,
}: Props) {
  const t = useTranslate();
  const [creating, setCreating] = useState(false);
  const atLimit = glossaries.length >= GLOSSARY_LIMITS.MAX_GLOSSARIES_PER_OWNER;

  async function handleCreate(body: SaveGlossaryRequest) {
    const id = crypto.randomUUID();
    await onSave(id, body);
    setCreating(false);
  }

  return (
    <div className="flex flex-col w-full md:w-72 md:shrink-0 border-b md:border-b-0 md:border-r md:h-full max-h-72 md:max-h-none">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="font-semibold text-body">{t('web.glossary.title')}</h2>
        {!creating && !atLimit && (
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            {t('web.glossary.new')}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {creating && (
          <GlossaryCreateForm onSave={handleCreate} onCancel={() => setCreating(false)} />
        )}

        {status === 'loading' && (
          <>
            <Skeleton className="h-14 rounded-lg" />
            <Skeleton className="h-14 rounded-lg" />
          </>
        )}

        {status === 'failed' && (
          <div role="alert" className="flex flex-col items-start gap-2 px-1">
            <p className="text-body text-destructive">{t('web.glossary.loadFailed')}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t('web.error.retry')}
            </Button>
          </div>
        )}

        {status === 'ready' && glossaries.length === 0 && !creating && (
          // The same shape as History's empty list: an icon, a bold title, one sentence.
          <div
            data-slot="glossary-empty"
            className="flex flex-col items-center gap-3 px-2 pt-6 pb-4 text-center"
          >
            <BookOpen aria-hidden className="text-border-strong size-12" strokeWidth={1.25} />
            <p className="text-body font-semibold">{t('web.glossary.emptyTitle')}</p>
            <p className="text-muted-foreground text-body">{t('web.glossary.emptyList')}</p>
          </div>
        )}

        {status === 'ready' &&
          glossaries.map((g) => (
            <GlossaryCard
              key={g.id}
              glossary={g}
              isSelected={g.id === selectedId}
              onSelect={() => onSelect(g.id === selectedId ? null : g.id)}
              onToggleActive={() => onToggleActive(g.id)}
              onDelete={() => onDelete(g.id)}
            />
          ))}
      </div>
    </div>
  );
}
