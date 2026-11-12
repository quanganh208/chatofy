'use client';

import { useId } from 'react';
import { Plus } from 'lucide-react';
import { Button, Label, Switch } from '@chatofy/ui/react';
import { GLOSSARY_LIMITS, LANGUAGES } from '@chatofy/types';
import type { Glossary } from '@chatofy/types';
import { ConfirmDeleteButton } from '@/components/layout/confirm-delete-button';
import { useTranslate } from '@/i18n/provider';

interface Props {
  glossary: Glossary;
  /** Terms loaded so far, for the ceiling on Add term. */
  termCount: number;
  onAddTerm: () => void;
  onToggleActive: (active: boolean) => void;
  /** Rejects when the server refused; the dialog says so and stays open. */
  onDelete: () => Promise<void>;
}

/**
 * The open glossary's facts and controls, on the page ground. Its name is the
 * topbar's last crumb and the screen's `<h1>`, so it is not repeated here.
 *
 * Add term is outline: the glossary screen spends no accent until a dialog opens,
 * and the dialog's submit is then the one. Delete is the shared AlertDialog
 * confirm, ghost so it reads quieter than the action you came for.
 */
export function GlossaryDetailHeader({
  glossary,
  termCount,
  onAddTerm,
  onToggleActive,
  onDelete,
}: Props) {
  const t = useTranslate();
  const switchId = useId();
  const lang = LANGUAGES[glossary.sourceLang]?.label ?? glossary.sourceLang;
  const atLimit = termCount >= GLOSSARY_LIMITS.MAX_ITEMS_PER_GLOSSARY;

  return (
    <div data-slot="glossary-detail-header" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-hint text-muted-foreground">{lang}</p>
        {glossary.description ? (
          <p className="text-body text-muted-foreground max-w-[60ch]">{glossary.description}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <Switch id={switchId} checked={glossary.isActive} onCheckedChange={onToggleActive} />
          <Label htmlFor={switchId} className="text-body font-normal">
            {t('web.glossary.activeLabel')}
          </Label>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ConfirmDeleteButton
            triggerVariant="ghost"
            name={glossary.name}
            description={t('web.glossary.deleteConsequence')}
            labels={{
              action: t('web.glossary.delete'),
              pending: t('web.glossary.deleting'),
              cancel: t('web.glossary.cancel'),
              failed: t('web.glossary.deleteFailed'),
            }}
            onConfirm={onDelete}
          />
          {atLimit ? null : (
            <Button variant="outline" size="sm" onClick={onAddTerm}>
              <Plus aria-hidden />
              {t('web.glossary.addTerm')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
