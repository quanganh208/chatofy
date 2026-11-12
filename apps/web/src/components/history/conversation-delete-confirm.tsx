'use client';

import { useId } from 'react';
import { ConfirmDeleteButton } from '@/components/layout/confirm-delete-button';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

interface ConversationDeleteConfirmProps {
  /** Delete the conversation; rejects when the server refused. */
  onDelete: () => Promise<void>;
  /** Cancel or Escape: the caller removes this and returns focus to its `⋯`. */
  onClose: () => void;
  /**
   * The conversation's name, for a strip under a list ROW: it is appended to the
   * buttons' accessible names, so "Delete" says which of twenty rows goes.
   */
  name?: string;
  className?: string;
}

/**
 * The second step of Delete: the sentence stating what deleting costs, with the
 * destructive press and Cancel beside it — so the consequence is on screen before
 * the only press that acts.
 *
 * An `alertdialog`, non-modal: focus moves into it (onto Cancel, see
 * `ConfirmDeleteButton`) and its description — the sentence — is read on arrival,
 * where an inserted plain paragraph would be silent. Escape and Cancel both close
 * it. A region between hairlines on the page ground rather than a dialog over it,
 * under the header or under the row it was chosen on: the decision is one sentence
 * deep, and a strip costs no elevated surface. Delete is `destructive`, which fills
 * with `live-fill` rather than the accent, so it spends no accent either.
 */
export function ConversationDeleteConfirm({
  onDelete,
  onClose,
  name,
  className,
}: ConversationDeleteConfirmProps) {
  const t = useTranslate();
  const consequence = useId();

  return (
    <div
      role="alertdialog"
      aria-label={name ? t('web.history.deleteNamed', { title: name }) : t('web.history.delete')}
      aria-describedby={consequence}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
      className={cn(
        'border-hairline flex flex-wrap items-center justify-between gap-3 border-y py-3',
        className,
      )}
    >
      <p id={consequence} className="text-hint max-w-[48ch]">
        {t('web.history.deleteConfirm')}
      </p>
      <ConfirmDeleteButton
        startConfirming
        describedBy={consequence}
        name={name}
        onCancel={onClose}
        labels={{
          action: t('web.history.delete'),
          pending: t('web.history.deleting'),
          cancel: t('web.history.cancel'),
          failed: t('web.history.deleteFailed'),
        }}
        onConfirm={onDelete}
      />
    </div>
  );
}
