'use client';

import { useState } from 'react';
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
}

export function GlossaryListPanel({
  glossaries,
  status,
  selectedId,
  onSelect,
  onSave,
  onToggleActive,
  onDelete,
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
    <div className="flex flex-col w-72 shrink-0 border-r h-full">
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
          <p className="text-body text-destructive px-1">{t('web.glossary.loadFailed')}</p>
        )}

        {status === 'ready' && glossaries.length === 0 && !creating && (
          <p className="text-body text-muted-foreground px-1">{t('web.glossary.emptyList')}</p>
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
