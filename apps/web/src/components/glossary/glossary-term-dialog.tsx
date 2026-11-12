'use client';

import { useId, useState } from 'react';
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
  Textarea,
} from '@chatofy/ui/react';
import { GLOSSARY_LIMITS, LANGUAGE_CODES } from '@chatofy/types';
import type { GlossaryItem, LanguageCode, SaveGlossaryItemRequest } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';
import { GlossaryLanguageSelect } from './glossary-language-select';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The term being edited, or `null` to add a new one. */
  editing: GlossaryItem | null;
  /** Store the term; rejects when the server refused, keeping the dialog open. */
  onSubmit: (body: SaveGlossaryItemRequest) => Promise<void>;
}

/**
 * Add a term, or edit one — the same four fields either way, so the two cannot
 * drift apart. A refusal stays in the dialog with what was typed; the success is
 * the caller's toast. The submit is the dialog's one accent-filled control: Add
 * term on the page under it is outline.
 */
export function GlossaryTermDialog({ open, onOpenChange, editing, onSubmit }: Props) {
  const t = useTranslate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('web.chrome.close')} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? t('web.glossary.editTermTitle') : t('web.glossary.addTerm')}
          </DialogTitle>
          <DialogDescription>{t('web.glossary.termDescription')}</DialogDescription>
        </DialogHeader>
        <TermForm
          // A fresh form per term, so editing a second term never shows the first.
          key={editing?.id ?? 'new'}
          editing={editing}
          onSubmit={onSubmit}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function TermForm({
  editing,
  onSubmit,
  onCancel,
}: {
  editing: GlossaryItem | null;
  onSubmit: (body: SaveGlossaryItemRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslate();
  const [original, setOriginal] = useState(editing?.original ?? '');
  const [translation, setTranslation] = useState(editing?.translation ?? '');
  const [targetLang, setTargetLang] = useState<LanguageCode>(
    editing?.targetLang ?? LANGUAGE_CODES[0],
  );
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const ids = { original: useId(), translation: useId(), lang: useId(), notes: useId() };

  const valid = original.trim().length > 0 && translation.trim().length > 0;

  const save = () => {
    if (!valid || saving) return;
    setSaving(true);
    setFailed(false);
    onSubmit({
      // A new client id every time: an edit is stored as a new term that replaces
      // the old one, and a reused id would hand back the old row unchanged.
      clientId: crypto.randomUUID(),
      original: original.trim(),
      translation: translation.trim(),
      targetLang,
      notes: notes.trim() || null,
    }).catch(() => {
      setSaving(false);
      setFailed(true);
    });
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.original}>{t('web.glossary.originalLabel')}</Label>
          <Input
            id={ids.original}
            value={original}
            onChange={(event) => setOriginal(event.target.value)}
            maxLength={GLOSSARY_LIMITS.MAX_ITEM_ORIGINAL_CHARS}
            readOnly={saving}
            autoFocus
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.translation}>{t('web.glossary.translationLabel')}</Label>
          <Input
            id={ids.translation}
            value={translation}
            onChange={(event) => setTranslation(event.target.value)}
            maxLength={GLOSSARY_LIMITS.MAX_ITEM_TRANSLATION_CHARS}
            readOnly={saving}
            required
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.lang}>{t('web.glossary.targetLangLabel')}</Label>
        <GlossaryLanguageSelect
          id={ids.lang}
          value={targetLang}
          onChange={setTargetLang}
          disabled={saving}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.notes}>{t('web.glossary.notesLabel')}</Label>
        <Textarea
          id={ids.notes}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={GLOSSARY_LIMITS.MAX_ITEM_NOTES_CHARS}
          placeholder={t('web.glossary.notesPlaceholder')}
          readOnly={saving}
          rows={2}
        />
      </div>
      {failed ? (
        <p role="alert" className="text-destructive text-hint">
          {editing ? t('web.glossary.updateTermFailed') : t('web.glossary.addTermFailed')}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {t('web.glossary.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!valid || saving}>
          {editing
            ? saving
              ? t('web.glossary.saving')
              : t('web.glossary.save')
            : saving
              ? t('web.glossary.adding')
              : t('web.glossary.addTerm')}
        </Button>
      </DialogFooter>
    </form>
  );
}
