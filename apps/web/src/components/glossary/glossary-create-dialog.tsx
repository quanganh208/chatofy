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
import type { LanguageCode, SaveGlossaryRequest } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';
import { GlossaryLanguageSelect } from './glossary-language-select';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Store the glossary; rejects when the server refused, keeping the dialog open. */
  onCreate: (body: SaveGlossaryRequest) => Promise<void>;
}

/**
 * New glossary: name, description and source language, in a dialog opened from the
 * topbar. A refusal stays inside the dialog with what was typed — the dialog is
 * still open, so pressing Create again is the retry; the success is the caller's
 * toast. Create is the dialog's one accent-filled control: the topbar's New
 * glossary under it is outline.
 */
export function GlossaryCreateDialog({ open, onOpenChange, onCreate }: Props) {
  const t = useTranslate();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('web.chrome.close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('web.glossary.createTitle')}</DialogTitle>
          <DialogDescription>{t('web.glossary.createDescription')}</DialogDescription>
        </DialogHeader>
        <CreateForm onCreate={onCreate} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({
  onCreate,
  onCancel,
}: {
  onCreate: (body: SaveGlossaryRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceLang, setSourceLang] = useState<LanguageCode>(LANGUAGE_CODES[0]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const ids = { name: useId(), description: useId(), lang: useId() };

  const valid = name.trim().length > 0;

  const save = () => {
    if (!valid || saving) return;
    setSaving(true);
    setFailed(false);
    onCreate({ name: name.trim(), description: description.trim() || null, sourceLang }).catch(
      () => {
        setSaving(false);
        setFailed(true);
      },
    );
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.name}>{t('web.glossary.nameLabel')}</Label>
        <Input
          id={ids.name}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={GLOSSARY_LIMITS.MAX_NAME_CHARS}
          readOnly={saving}
          autoFocus
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.description}>{t('web.glossary.descriptionLabel')}</Label>
        <Textarea
          id={ids.description}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={GLOSSARY_LIMITS.MAX_DESCRIPTION_CHARS}
          readOnly={saving}
          rows={2}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.lang}>{t('web.glossary.sourceLangLabel')}</Label>
        <GlossaryLanguageSelect
          id={ids.lang}
          value={sourceLang}
          onChange={setSourceLang}
          disabled={saving}
        />
      </div>
      {failed ? (
        <p role="alert" className="text-destructive text-hint">
          {t('web.glossary.createFailed')}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {t('web.glossary.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!valid || saving}>
          {saving ? t('web.glossary.creating') : t('web.glossary.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}
