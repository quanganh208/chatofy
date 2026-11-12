'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { Ellipsis, Trash2 } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@chatofy/ui/react';
import { ConfirmDeleteButton } from '@/components/layout/confirm-delete-button';
import { useTranslate } from '@/i18n/provider';

interface ConversationActionsProps {
  /** Delete the conversation; rejects when the server refused. */
  onDelete: () => Promise<void>;
  /** Drawn before the menu, on the same row — the recording controls. */
  leading?: ReactNode;
}

/**
 * The `⋯` menu and, once Delete is chosen from it, the confirmation under the header.
 *
 * ## Still two steps, and the sentence still comes first
 *
 * Choosing Delete in the menu deletes nothing: it is the quiet first press. It opens
 * a strip stating what deleting costs, with the destructive press and Cancel beside
 * it — so the consequence is on screen before the only press that acts, which is the
 * property the old delete zone at the foot of the page had.
 *
 * The strip is an `alertdialog`, non-modal: focus moves into it (onto Cancel, see
 * `ConfirmDeleteButton`) and its description — the sentence — is read on arrival,
 * where an inserted plain paragraph would be silent. Escape and Cancel both close it
 * and put focus back on the `⋯` that opened it.
 *
 * Delete is `destructive`, which fills with `live-fill` rather than the accent, so
 * none of this spends the screen's one accent-filled control.
 */
export function ConversationActions({ onDelete, leading }: ConversationActionsProps) {
  const t = useTranslate();
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Set by the menu item, acted on once the menu has CLOSED. Opening the strip from
  // the item itself raced the menu's focus trap: Cancel was focused while the menu
  // was still mounted, the trap pulled focus back into it, and its unmount then
  // dropped focus on `<body>`. After close there is no trap, and preventing the
  // menu's own return-to-trigger leaves focus where the strip puts it.
  const opening = useRef(false);
  const consequence = useId();

  const close = () => {
    setConfirming(false);
    trigger.current?.focus();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {leading}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={trigger}
              variant="outline"
              size="icon"
              aria-label={t('web.history.moreActions')}
            >
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              if (!opening.current) return;
              opening.current = false;
              event.preventDefault();
              setConfirming(true);
            }}
          >
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                opening.current = true;
              }}
            >
              <Trash2 aria-hidden />
              {t('web.history.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {confirming ? (
        <div
          role="alertdialog"
          aria-label={t('web.history.delete')}
          aria-describedby={consequence}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            close();
          }}
          className="border-hairline flex basis-full flex-wrap items-center justify-between gap-3 border-y py-3"
        >
          <p id={consequence} className="text-hint max-w-[48ch]">
            {t('web.history.deleteConfirm')}
          </p>
          <ConfirmDeleteButton
            startConfirming
            describedBy={consequence}
            onCancel={close}
            labels={{
              action: t('web.history.delete'),
              pending: t('web.history.deleting'),
              cancel: t('web.history.cancel'),
              failed: t('web.history.deleteFailed'),
            }}
            onConfirm={onDelete}
          />
        </div>
      ) : null}
    </>
  );
}
