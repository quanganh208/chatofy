'use client';

import { useId, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { ConfirmDeleteInlineActions } from './confirm-delete-inline-actions';
import { useConfirmRequest } from './use-confirm-request';

/** The four strings a confirmation needs, supplied by whatever is being deleted. */
interface ConfirmDeleteLabels {
  /** The verb, on both the trigger and the button that acts. */
  action: string;
  /** The verb while the request is out. */
  pending: string;
  cancel: string;
  /** Said out loud when the request comes back refused. */
  failed: string;
}

interface ConfirmDeleteButtonProps {
  onConfirm: () => Promise<void>;
  labels: ConfirmDeleteLabels;
  /**
   * Id of an element on the page stating what deleting costs. Attached to the trigger
   * and to the dialog, so the sentence is read with both even when the reader never
   * sees the two side by side.
   */
  describedBy?: string;
  /**
   * The consequence, said inside the dialog. Falls back to a plain "cannot be undone"
   * line, so the dialog never opens on a title alone.
   */
  description?: string;
  /**
   * What this one deletes: appended to every button's accessible name and quoted in
   * the dialog title. In a LIST it is the whole difference between "Delete, Delete,
   * Delete" and knowing which row is about to go.
   */
  name?: string;
  /** The quiet variant for the first press. `outline` unless the row is denser. */
  triggerVariant?: 'outline' | 'ghost';
  /** The trash icon, which a dense list generally does not want. */
  withIcon?: boolean;
  /**
   * Skip the first step: draw only Delete and Cancel, in place, with focus on Cancel.
   * For a caller whose FIRST step lives somewhere else — a menu item that says
   * "Delete" — and which draws its own confirmation strip (`role="alertdialog"` with
   * the consequence sentence), so a modal on top would ask the same question twice.
   */
  startConfirming?: boolean;
  /**
   * Called when the reader backs out (Cancel or Escape). A caller that started
   * confirming has no trigger here for focus to return to: it removes this component
   * and puts focus back on whatever opened it.
   */
  onCancel?: () => void;
}

/**
 * Delete, behind a confirmation dialog — or, with `startConfirming`, the second step
 * alone, inline (see `ConfirmDeleteInlineActions`).
 *
 * The first press is quiet and deletes nothing: it opens an `alertdialog` naming what
 * goes and what it costs. The press that does is `destructive`, which fills with
 * `live-fill` rather than `primary`, so it costs nothing against a screen's one-accent
 * budget.
 *
 * **Focus lands on Cancel, not on the irreversible press.** Radix's AlertDialog does
 * that by default, and it is the reason this is an AlertDialog rather than a Dialog:
 * the press that opens it is as often a keyboard Enter as a click, and a key held a
 * beat too long repeats — focus on Delete would let one keystroke take both steps.
 * Closing returns focus to the trigger, which the primitive also does.
 *
 * **The dialog stays open while the request is out, and after it fails.** A caller that
 * navigates away or drops the row on success leaves nothing on screen, so silence after
 * a press that failed reads exactly like a delete that worked. `useConfirmRequest`
 * holds the failure and puts focus back on the re-enabled Delete.
 */
export function ConfirmDeleteButton({
  onConfirm,
  labels,
  describedBy,
  description,
  name,
  triggerVariant = 'outline',
  withIcon = true,
  startConfirming = false,
  onCancel,
}: ConfirmDeleteButtonProps) {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const { deleting, failed, setFailed, run, confirmRef } = useConfirmRequest(onConfirm, () =>
    setOpen(false),
  );

  /** The visible word plus what it acts on, for a reader who has only the name. */
  const label = (text: string) => (name ? `${text} ${name}` : undefined);

  if (startConfirming) {
    return (
      <ConfirmDeleteInlineActions
        onConfirm={onConfirm}
        onCancel={onCancel}
        labels={labels}
        describedBy={describedBy}
        label={label}
      />
    );
  }

  const changeOpen = (next: boolean) => {
    // Nothing closes the dialog under a request in flight: its outcome has to be
    // seen, and Escape mid-delete would hide a failure behind a closed dialog.
    if (deleting) return;
    setOpen(next);
    if (next) setFailed(false);
    else onCancel?.();
  };

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size="sm"
          aria-describedby={describedBy}
          aria-label={label(labels.action)}
        >
          {/* No literal space between the two: `Button` already spaces its icon with
                `gap-2`, and a space text node would survive an absent icon and read
                " Delete" in the accessible name. */}
          {withIcon ? <Trash2 aria-hidden /> : null}
          {labels.action}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        aria-describedby={describedBy ? `${descriptionId} ${describedBy}` : descriptionId}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {name
              ? t('web.chrome.confirmTitleNamed', { action: labels.action, name })
              : t('web.chrome.confirmTitle', { action: labels.action })}
          </AlertDialogTitle>
          <AlertDialogDescription id={descriptionId}>
            {description ?? t('web.chrome.confirmIrreversible')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failed ? (
          <p role="alert" className="text-destructive text-hint">
            {labels.failed}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel size="sm" disabled={deleting} aria-label={label(labels.cancel)}>
            {labels.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            ref={confirmRef}
            variant="destructive"
            size="sm"
            disabled={deleting}
            aria-label={label(labels.action)}
            onClick={(event) => {
              // The primitive closes on Action by default; this one closes only once
              // the request has answered.
              event.preventDefault();
              run();
            }}
          >
            {deleting ? labels.pending : labels.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
