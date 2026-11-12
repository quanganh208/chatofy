'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@chatofy/ui/react';
import { useConfirmRequest } from './use-confirm-request';

interface ConfirmDeleteInlineActionsProps {
  onConfirm: () => Promise<void>;
  onCancel?: () => void;
  labels: { action: string; pending: string; cancel: string; failed: string };
  describedBy?: string;
  /** Builds a button's accessible name from its visible word. */
  label: (text: string) => string | undefined;
}

/**
 * Delete and Cancel in place, for a caller that has already drawn the confirmation
 * surface itself — a strip with `role="alertdialog"` and the consequence sentence. A
 * modal on top of that would ask the same question twice.
 *
 * Focus lands on Cancel on arrival, not on the irreversible press: the press that
 * opened this is as often a keyboard Enter as a click, and a key held a beat too long
 * repeats.
 */
export function ConfirmDeleteInlineActions({
  onConfirm,
  onCancel,
  labels,
  describedBy,
  label,
}: ConfirmDeleteInlineActionsProps) {
  const { deleting, failed, run, confirmRef } = useConfirmRequest(onConfirm);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {failed ? (
        <p role="alert" className="text-destructive text-hint">
          {labels.failed}
        </p>
      ) : null}
      <Button
        ref={confirmRef}
        variant="destructive"
        size="sm"
        aria-describedby={describedBy}
        aria-label={label(labels.action)}
        disabled={deleting}
        onClick={run}
      >
        {deleting ? labels.pending : labels.action}
      </Button>
      <Button
        ref={cancel}
        variant="ghost"
        size="sm"
        aria-label={label(labels.cancel)}
        disabled={deleting}
        onClick={() => onCancel?.()}
      >
        {labels.cancel}
      </Button>
    </div>
  );
}
