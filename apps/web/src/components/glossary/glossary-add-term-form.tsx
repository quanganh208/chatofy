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
import type { LanguageCode, SaveGlossaryItemRequest } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

interface Props {
  onAdd: (body: SaveGlossaryItemRequest) => Promise<void>;
  onCancel: () => void;
}

export function GlossaryAddTermForm({ onAdd, onCancel }: Props) {
  const t = useTranslate();
  const [original, setOriginal] = useState('');
  const [translation, setTranslation] = useState('');
  const [targetLang, setTargetLang] = useState<LanguageCode>(LANGUAGE_CODES[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const valid = original.trim().length > 0 && translation.trim().length > 0;

  async function handleAdd() {
    if (!valid) return;
    setSaving(true);
    setFailed(false);
    try {
      await onAdd({
        clientId: crypto.randomUUID(),
        original: original.trim(),
        translation: translation.trim(),
        targetLang,
        notes: notes.trim() || null,
      });
    } catch {
      setSaving(false);
      setFailed(true);
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="term-original">{t('web.glossary.originalLabel')}</Label>
          <Input
            id="term-original"
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
            maxLength={GLOSSARY_LIMITS.MAX_ITEM_ORIGINAL_CHARS}
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="term-translation">{t('web.glossary.translationLabel')}</Label>
          <Input
            id="term-translation"
            value={translation}
            onChange={(e) => setTranslation(e.target.value)}
            maxLength={GLOSSARY_LIMITS.MAX_ITEM_TRANSLATION_CHARS}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>{t('web.glossary.targetLangLabel')}</Label>
        <Select value={targetLang} onValueChange={(v) => setTargetLang(v as LanguageCode)}>
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
      <div className="space-y-1">
        <Label htmlFor="term-notes">{t('web.glossary.notesLabel')}</Label>
        <Textarea
          id="term-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={GLOSSARY_LIMITS.MAX_ITEM_NOTES_CHARS}
          placeholder={t('web.glossary.notesPlaceholder')}
          rows={2}
        />
      </div>
      {failed && <p className="text-sm text-destructive">{t('web.glossary.addTermFailed')}</p>}
      <div className="flex gap-2">
        <Button
          onClick={() => void handleAdd()}
          disabled={!valid || saving}
          className="bg-primary text-primary-foreground"
        >
          {saving ? t('web.glossary.adding') : t('web.glossary.addTerm')}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t('web.glossary.cancel')}
        </Button>
      </div>
    </div>
  );
}
