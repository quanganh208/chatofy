'use client';

import { useId, useState, type FormEvent } from 'react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { parseRoomInput } from '../utils/parse-room-input';

interface JoinByCodeDialogProps {
  /** Lets the lobby hand its one accent to this dialog's Join while it is open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with a room id the code or link named; the lobby navigates. */
  onJoin: (roomId: string) => void;
  /** No join while a new meeting is being created. */
  disabled?: boolean;
}

/**
 * "Join with a code": a code or a pasted invite link, checked here before anything
 * navigates.
 *
 * A code that cannot name a room is said next to the field and the dialog stays
 * open — a malformed code is the reader's typo, not an outcome to toast. Whether
 * the room EXISTS is the room screen's answer, because only the server knows.
 *
 * Design budget: while this dialog is open, its Join is the screen's one
 * accent-filled control; the lobby turns "New meeting" outline behind the scrim.
 */
export function JoinByCodeDialog({ open, onOpenChange, onJoin, disabled }: JoinByCodeDialogProps) {
  const t = useTranslate();
  const errorId = useId();
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);

  function changeOpen(next: boolean) {
    // A reopened dialog starts clean rather than shouting the last attempt's error.
    if (!next) {
      setCode('');
      setInvalid(false);
    }
    onOpenChange(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const roomId = parseRoomInput(code);
    if (!roomId) {
      setInvalid(true);
      return;
    }
    onJoin(roomId);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled} data-join-by-code>
          {t('web.conference.joinWithCode')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('web.chrome.close')}>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('web.conference.joinDialogTitle')}</DialogTitle>
            <DialogDescription>{t('web.conference.joinDialogHint')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="conf-room">{t('web.conference.codeOrLink')}</Label>
            <Input
              id="conf-room"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                if (invalid) setInvalid(false);
              }}
              placeholder={t('web.conference.codeOrLinkPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
            />
            {invalid && (
              <p id={errorId} role="alert" className="text-destructive text-hint">
                {t('web.conference.codeInvalid')}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t('web.conference.cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={disabled || !code.trim()}>
              {t('web.conference.joinAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
