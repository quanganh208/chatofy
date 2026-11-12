'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import type { Glossary, GlossaryItem, SaveGlossaryItemRequest } from '@chatofy/types';
import { TopbarCrumb } from '@/components/layout/chrome-slots';
import { useGlossaryItems } from '@/hooks/use-glossary-items';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';
import { GlossaryDetailHeader } from './glossary-detail-header';
import { GlossaryTermDialog } from './glossary-term-dialog';
import { GlossaryTermList } from './glossary-term-list';

interface Props {
  glossary: Glossary | null;
  /** Back to the list — drawn only where the list gives way to this (one pane). */
  onBack: () => void;
  onToggleActive: (active: boolean) => void;
  onDelete: () => Promise<void>;
  className?: string;
}

/**
 * The right pane: the open glossary — its name as the topbar's crumb, its facts
 * and controls, then its terms. Every outcome is a toast; a refusal inside a
 * dialog stays in the dialog.
 *
 * ## Editing a term
 *
 * The API stores and deletes terms but has no update, so an edit adds the new
 * version FIRST and then deletes the old one. If the add fails nothing changed and
 * the dialog says so. If only the delete fails, the new version is stored and the
 * old one is still listed — the toast says exactly that and its Retry deletes the
 * old one, so a failure can duplicate a term but never lose one.
 */
export function GlossaryDetailPanel({
  glossary,
  onBack,
  onToggleActive,
  onDelete,
  className,
}: Props) {
  const t = useTranslate();
  const { items, status, addItem, removeItem } = useGlossaryItems(glossary?.id ?? null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GlossaryItem | null>(null);

  if (glossary === null) {
    return (
      <div className={className}>
        <p className="text-body text-muted-foreground pt-6 text-center @3xl:pt-16">
          {t('web.glossary.selectGlossary')}
        </p>
      </div>
    );
  }

  const openDialog = (item: GlossaryItem | null) => {
    setEditing(item);
    setDialogOpen(true);
  };

  const removeOld = (item: GlossaryItem): Promise<void> =>
    removeItem(item.id).catch(() => {
      notify.error(t('web.glossary.oldTermKept', { term: item.original }), {
        id: `glossary-term-${item.id}`,
        retry: () => void removeOld(item),
      });
    });

  const submit = async (body: SaveGlossaryItemRequest) => {
    await addItem(body);
    setDialogOpen(false);
    if (!editing) {
      notify.success(t('web.glossary.termAdded', { term: body.original }));
      return;
    }
    const old = editing;
    notify.success(t('web.glossary.termUpdated', { term: body.original }), {
      id: `glossary-term-${old.id}`,
    });
    await removeOld(old);
  };

  const remove = async (item: GlossaryItem) => {
    await removeItem(item.id);
    notify.success(t('web.glossary.termDeleted', { term: item.original }));
  };

  return (
    <section aria-label={glossary.name} className={className}>
      <TopbarCrumb>{glossary.name}</TopbarCrumb>
      <div className="flex flex-col gap-6">
        <Button variant="ghost" size="sm" className="self-start @3xl:hidden" onClick={onBack}>
          <ArrowLeft aria-hidden />
          {t('web.glossary.back')}
        </Button>

        <GlossaryDetailHeader
          glossary={glossary}
          termCount={items.length}
          onAddTerm={() => openDialog(null)}
          onToggleActive={onToggleActive}
          onDelete={onDelete}
        />

        <div className="flex flex-col gap-3">
          <h2 className="text-body font-medium">
            {t('web.glossary.termsHeading')}
            {status === 'ready' ? (
              <span className="text-muted-foreground ml-1.5 font-normal">({items.length})</span>
            ) : null}
          </h2>
          <GlossaryTermList
            items={items}
            status={status}
            onEdit={(item) => openDialog(item)}
            onRemove={remove}
          />
        </div>
      </div>

      <GlossaryTermDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSubmit={submit}
      />
    </section>
  );
}
