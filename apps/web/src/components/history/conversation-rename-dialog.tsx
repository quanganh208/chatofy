'use client';

import { useId, useState } from 'react';
import { HISTORY_LIMITS, renameConversationRequestSchema } from '@chatofy/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

interface ConversationRenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stored title; null for an untitled conversation, which starts empty. */
  title: string | null;
  /** Store the new title; rejects when the server refused, keeping the dialog open. */
  onSave: (title: string) => Promise<void>;
  /** Where focus goes when it closes: it has no trigger of its own to return to. */
  restoreFocus: () => void;
}

const MAX = HISTORY_LIMITS.MAX_TITLE_CHARS;

/**
 * Rename, as a dialog: one field, Save and Cancel. Opened from the topbar's Rename
 * or from a list row's `⋯`, so both edit through exactly this.
 *
 * Validated by the request schema itself, so "empty once trimmed" and "over 120"
 * are refused here by exactly the rule the API applies. A refusal — the rule or the
 * server — is a line under the field tied to it by `aria-describedby`; the dialog
 * stays open with the typed title, and the success is the caller's toast.
 *
 * Save is `outline`, not the accent: on the Minutes tab Generate is the screen's
 * one accent-filled control and stays mounted behind the dialog, and a rename does
 * not outrank it.
 */
export function ConversationRenameDialog({
  open,
  onOpenChange,
  title,
  onSave,
  restoreFocus,
}: ConversationRenameDialogProps) {
  const t = useTranslate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t('web.chrome.close')}
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('web.history.renameTitle')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('web.history.renameHint', { max: MAX })}
          </DialogDescription>
        </DialogHeader>
        {/* The content mounts on each opening, so the form starts from the stored
            title, not from what was typed and abandoned last time. */}
        <RenameForm title={title} onSave={onSave} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  title,
  onSave,
  onCancel,
}: {
  title: string | null;
  onSave: (title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslate();
  const [value, setValue] = useState(title ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useId();
  const hint = useId();
  const problem = useId();

  const save = () => {
    if (saving) return;
    const parsed = renameConversationRequestSchema.safeParse({ title: value });
    if (!parsed.success) {
      setError(
        value.trim() === ''
          ? t('web.history.renameEmpty')
          : t('web.history.renameTooLong', { max: MAX }),
      );
      return;
    }
    setSaving(true);
    setError(null);
    onSave(parsed.data.title).catch(() => {
      setSaving(false);
      setError(t('web.history.renameFailed'));
    });
  };

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={field}>{t('web.history.renameLabel')}</Label>
        <Input
          id={field}
          value={value}
          // Text selected on arrival, so typing replaces the old title.
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          aria-describedby={error ? `${problem} ${hint}` : hint}
          aria-invalid={error ? true : undefined}
          readOnly={saving}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
        />
        {error ? (
          <p id={problem} role="alert" className="text-destructive text-hint">
            {error}
          </p>
        ) : null}
        <p id={hint} className="text-hint text-muted-foreground">
          {t('web.history.renameHint', { max: MAX })}
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          {t('web.history.cancel')}
        </Button>
        <Button type="submit" variant="outline" size="sm" disabled={saving}>
          {saving ? t('web.history.renameSaving') : t('web.history.renameSave')}
        </Button>
      </DialogFooter>
    </form>
  );
}
