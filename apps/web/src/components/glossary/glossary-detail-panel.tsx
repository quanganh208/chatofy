'use client';

import { useState } from 'react';
import { Button } from '@chatofy/ui/react';
import { GLOSSARY_LIMITS } from '@chatofy/types';
import type { Glossary, PatchGlossaryRequest, SaveGlossaryItemRequest } from '@chatofy/types';
import { useGlossaryItems } from '@/hooks/use-glossary-items';
import { useTranslate } from '@/i18n/provider';
import { GlossaryAddTermForm } from './glossary-add-term-form';
import { GlossaryDetailHeader } from './glossary-detail-header';
import { GlossaryTermList } from './glossary-term-list';

interface Props {
  glossary: Glossary | null;
  onPatch: (glossaryId: string, body: PatchGlossaryRequest) => Promise<void>;
}

export function GlossaryDetailPanel({ glossary, onPatch }: Props) {
  const t = useTranslate();
  const { items, status, addItem, removeItem } = useGlossaryItems(glossary?.id ?? null);
  const [addingTerm, setAddingTerm] = useState(false);
  const atLimit = items.length >= GLOSSARY_LIMITS.MAX_ITEMS_PER_GLOSSARY;

  if (glossary === null) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-body text-muted-foreground">{t('web.glossary.selectGlossary')}</p>
      </div>
    );
  }

  async function handleAddTerm(body: SaveGlossaryItemRequest) {
    await addItem(body);
    setAddingTerm(false);
  }

  async function handleSetDefault(isDefault: boolean) {
    await onPatch(glossary!.id, { isDefault });
  }

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      <GlossaryDetailHeader glossary={glossary} onSetDefault={handleSetDefault} />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-body font-medium">
            {t('web.glossary.termsHeading')}
            {status === 'ready' && (
              <span className="ml-1.5 text-muted-foreground font-normal">({items.length})</span>
            )}
          </h4>
          {!addingTerm && !atLimit && (
            <Button variant="outline" size="sm" onClick={() => setAddingTerm(true)}>
              {t('web.glossary.addTerm')}
            </Button>
          )}
        </div>

        {addingTerm && (
          <GlossaryAddTermForm onAdd={handleAddTerm} onCancel={() => setAddingTerm(false)} />
        )}

        <GlossaryTermList items={items} status={status} onRemove={removeItem} />
      </div>
    </div>
  );
}
