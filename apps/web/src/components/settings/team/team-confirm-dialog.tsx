'use client';

import { useState } from 'react';
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

/**
 * A destructive-outline trigger and the AlertDialog it opens, for an act that cannot
 * be undone (delete a team, leave one). The trigger is the outline button with its
 * label in the destructive colour, not a fill: a filled red would compete with the
 * screen's one accent. Its hover is the destructive tint, as on a destructive menu
 * item: the outline's own `hover:bg-border` drops the red label under 4.5:1 in dark
 * (4.33), where `live-subtle` keeps it at 4.74 (5.55 in light). The dialog's action is the filled destructive one, inside a
 * dialog that has no other. It stays open while the request runs and says so inline
 * when it fails.
 */
export function TeamConfirmDialog({
  slot,
  trigger,
  title,
  body,
  action,
  ready = true,
  onConfirm,
  children,
}: {
  /** Names the trigger for specs and the gate: `data-team-confirm`. */
  slot: 'delete' | 'leave';
  trigger: string;
  title: string;
  body: string;
  action: string;
  /** False keeps the action disabled, e.g. until the typed name matches. */
  ready?: boolean;
  onConfirm: () => Promise<void>;
  children?: React.ReactNode;
}) {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        setFailed(false);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          className="text-destructive hover:bg-live-subtle"
          data-team-confirm={slot}
        >
          {trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {failed && (
          <p role="alert" className="text-destructive text-hint">
            {t('web.team.actionFailed')}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('web.team.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || !ready}
            onClick={(event) => {
              event.preventDefault();
              setBusy(true);
              setFailed(false);
              onConfirm().then(
                () => {
                  setBusy(false);
                  setOpen(false);
                },
                () => {
                  setBusy(false);
                  setFailed(true);
                },
              );
            }}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
