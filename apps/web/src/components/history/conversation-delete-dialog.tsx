'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@chatofy/ui/react';
import { useConfirmRequest } from '@/components/layout/use-confirm-request';
import { useTranslate } from '@/i18n/provider';

interface ConversationDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The conversation's visible name, quoted in the title. */
  name: string;
  /** Delete the conversation; rejects when the server refused. */
  onDelete: () => Promise<void>;
  /** Where focus goes on Cancel: a menu item opened this, not a trigger. */
  restoreFocus: () => void;
}

/**
 * Delete's second step for a conversation, opened from a `⋯` menu — the topbar's
 * or a list row's, one dialog for both.
 *
 * The same AlertDialog `ConfirmDeleteButton` draws, controlled rather than
 * triggered: the first step here is a menu item, which cannot be the dialog's
 * trigger. Focus starts on Cancel (Radix's default for an AlertDialog), the dialog
 * cannot be dismissed while the request is out, and a refusal is said inside it
 * with focus back on Delete — `useConfirmRequest` is shared for exactly that.
 * Delete is `destructive`, which fills with `live-fill`, not the accent.
 */
export function ConversationDeleteDialog({
  open,
  onOpenChange,
  name,
  onDelete,
  restoreFocus,
}: ConversationDeleteDialogProps) {
  const t = useTranslate();
  const { deleting, failed, setFailed, run, confirmRef } = useConfirmRequest(onDelete, () =>
    onOpenChange(false),
  );

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return;
        if (next) setFailed(false);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('web.chrome.confirmTitleNamed', { action: t('web.history.delete'), name })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('web.history.deleteConfirm')}</AlertDialogDescription>
        </AlertDialogHeader>
        {failed ? (
          <p role="alert" className="text-destructive text-hint">
            {t('web.history.deleteFailed')}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel size="sm" disabled={deleting}>
            {t('web.history.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            ref={confirmRef}
            variant="destructive"
            size="sm"
            disabled={deleting}
            onClick={(event) => {
              // Closed only once the request has answered.
              event.preventDefault();
              run();
            }}
          >
            {deleting ? t('web.history.deleting') : t('web.history.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
