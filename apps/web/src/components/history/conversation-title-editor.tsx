'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { HISTORY_LIMITS, renameConversationRequestSchema } from '@chatofy/types';
import { Button, Input } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

interface ConversationTitleEditorProps {
  /** The stored title; null for an untitled conversation, which starts empty. */
  title: string | null;
  /** Store the new title; rejects when the server refused, keeping the field. */
  onSave: (title: string) => Promise<void>;
  onCancel: () => void;
}

const MAX = HISTORY_LIMITS.MAX_TITLE_CHARS;

/**
 * The detail header's title, as a field — Rename's whole UI. Enter or Save saves,
 * Escape or Cancel cancels.
 *
 * Validated by the request schema itself, so "empty once trimmed" and "over 120"
 * are refused here by exactly the rule the API applies, not by a second copy of
 * it. A refusal is a line under the field, tied to it by `aria-describedby` and
 * `aria-invalid`; the hint beside it says the rule before anyone breaks it.
 *
 * Save is `outline`, not the accent: on the Minutes tab Generate is the screen's
 * one accent-filled control, and a rename does not outrank it.
 */
export function ConversationTitleEditor({ title, onSave, onCancel }: ConversationTitleEditorProps) {
  const t = useTranslate();
  const [value, setValue] = useState(title ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const hint = useId();
  const problem = useId();

  // Into the field on arrival, text selected, so typing replaces the old title.
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  // A failed save re-enables the field; a disabled element is blurred, so focus
  // goes back to it rather than staying on `<body>`.
  useEffect(() => {
    if (!saving && error) field.current?.focus();
  }, [saving, error]);

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
    onSave(parsed.data.title)
      .catch(() => setError(t('web.history.renameFailed')))
      .finally(() => setSaving(false));
  };

  return (
    <form
      className="flex min-w-0 flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Input
          ref={field}
          value={value}
          aria-label={t('web.history.renameLabel')}
          aria-describedby={error ? `${problem} ${hint}` : hint}
          aria-invalid={error ? true : undefined}
          disabled={saving}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            onCancel();
          }}
          className="font-display text-heading h-auto min-w-0 flex-[1_1_16rem] py-1"
        />
        <Button type="submit" variant="outline" size="sm" disabled={saving}>
          {saving ? t('web.history.renameSaving') : t('web.history.renameSave')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          {t('web.history.cancel')}
        </Button>
      </div>
      {error ? (
        <p id={problem} role="alert" className="text-destructive text-hint">
          {error}
        </p>
      ) : null}
      <p id={hint} className="text-hint text-muted-foreground">
        {t('web.history.renameHint', { max: MAX })}
      </p>
    </form>
  );
}
