'use client';

import { useState } from 'react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@chatofy/ui/react';
import { GLOSSARY_LIMITS, LANGUAGE_CODES, LANGUAGES } from '@chatofy/types';
import type { LanguageCode, SaveGlossaryRequest } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

interface Props {
  onSave: (body: SaveGlossaryRequest) => Promise<void>;
  onCancel: () => void;
}

export function GlossaryCreateForm({ onSave, onCancel }: Props) {
  const t = useTranslate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sourceLang, setSourceLang] = useState<LanguageCode>(LANGUAGE_CODES[0]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const valid = name.trim().length > 0;

  async function handleSave() {
    if (!valid) return;
    setSaving(true);
    setFailed(false);
    try {
      await onSave({ name: name.trim(), description: description.trim() || null, sourceLang });
    } catch {
      setSaving(false);
      setFailed(true);
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="space-y-1">
        <Label htmlFor="glossary-name">{t('web.glossary.nameLabel')}</Label>
        <Input
          id="glossary-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={GLOSSARY_LIMITS.MAX_NAME_CHARS}
          placeholder={t('web.glossary.nameLabel')}
          autoFocus
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="glossary-description">{t('web.glossary.descriptionLabel')}</Label>
        <Textarea
          id="glossary-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={GLOSSARY_LIMITS.MAX_DESCRIPTION_CHARS}
          placeholder={t('web.glossary.descriptionLabel')}
          rows={2}
        />
      </div>
      <div className="space-y-1">
        <Label>{t('web.glossary.sourceLangLabel')}</Label>
        <Select value={sourceLang} onValueChange={(v) => setSourceLang(v as LanguageCode)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_CODES.map((code) => (
              <SelectItem key={code} value={code}>
                {LANGUAGES[code].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {failed && <p className="text-body text-destructive">{t('web.glossary.createFailed')}</p>}
      <div className="flex gap-2">
        <Button
          onClick={() => void handleSave()}
          disabled={!valid || saving}
          className="bg-primary text-primary-foreground"
        >
          {saving ? t('web.glossary.creating') : t('web.glossary.create')}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t('web.glossary.cancel')}
        </Button>
      </div>
    </div>
  );
}
