'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import { GLOSSARY_LIMITS } from '@chatofy/types';
import type { SaveGlossaryRequest } from '@chatofy/types';
import { TopbarActions } from '@/components/layout/chrome-slots';
import { useGlossaries } from '@/hooks/use-glossaries';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { GlossaryCreateDialog } from './glossary-create-dialog';
import { GlossaryDetailPanel } from './glossary-detail-panel';
import { GlossaryListPanel } from './glossary-list-panel';

/**
 * Glossaries as History is laid out: the list on the left, the open glossary on the
 * right, a hairline between them, both on the page ground — no box around either.
 *
 * Below `md` it is one column at a time, as History is two pages: the list, or —
 * once a glossary is chosen — that glossary with a way back. From `md` both panes
 * show and the list stays in view (sticky) while a long term list scrolls.
 *
 * New glossary sits in the topbar and opens a dialog. Selection is local UI state;
 * the glossaries themselves are the shared provider's.
 *
 * ## The accent budget
 *
 * None spent on the screen itself: New glossary and Add term are outline. An open
 * dialog's submit is then the one accent-filled control, and the dialog the one
 * elevated surface (two while its language list is open).
 */
export function GlossaryPageContent() {
  const t = useTranslate();
  const { glossaries, status, save, patch, remove, retry } = useGlossaries();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selected = glossaries.find((g) => g.id === selectedId) ?? null;
  const atLimit = glossaries.length >= GLOSSARY_LIMITS.MAX_GLOSSARIES_PER_OWNER;

  const create = async (body: SaveGlossaryRequest) => {
    const id = crypto.randomUUID();
    await save(id, body);
    setCreating(false);
    setSelectedId(id);
    notify.success(t('web.glossary.created', { name: body.name }));
  };

  const setActive = (glossaryId: string, active: boolean, name: string) => {
    patch(glossaryId, { isActive: active }).then(
      () =>
        notify.success(
          active ? t('web.glossary.turnedOn', { name }) : t('web.glossary.turnedOff', { name }),
          { id: `glossary-active-${glossaryId}`, undo: () => setActive(glossaryId, !active, name) },
        ),
      () =>
        notify.error(t('web.glossary.toggleFailed', { name }), {
          id: `glossary-active-${glossaryId}`,
          retry: () => setActive(glossaryId, active, name),
        }),
    );
  };

  const deleteSelected = async () => {
    if (!selected) return;
    const { id, name } = selected;
    await remove(id);
    setSelectedId(null);
    notify.success(t('web.glossary.deleted', { name }));
  };

  return (
    <>
      {status === 'ready' && !atLimit ? (
        <TopbarActions>
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('web.glossary.new')}
          </Button>
        </TopbarActions>
      ) : null}

      <div className="flex flex-col md:flex-row md:items-start">
        <GlossaryListPanel
          glossaries={glossaries}
          status={status}
          onRetry={() => void retry()}
          selectedId={selectedId}
          onSelect={setSelectedId}
          className={cn(
            'w-full md:sticky md:top-4 md:w-72 md:shrink-0 md:pr-4',
            selected ? 'max-md:hidden' : undefined,
          )}
        />
        <div aria-hidden className="bg-hairline hidden w-px self-stretch md:block" />
        <GlossaryDetailPanel
          key={selected?.id ?? 'none'}
          glossary={selected}
          onBack={() => setSelectedId(null)}
          onToggleActive={(active) => selected && setActive(selected.id, active, selected.name)}
          onDelete={deleteSelected}
          className={cn('min-w-0 flex-1 md:pl-8', selected ? undefined : 'max-md:hidden')}
        />
      </div>

      <GlossaryCreateDialog open={creating} onOpenChange={setCreating} onCreate={create} />
    </>
  );
}
