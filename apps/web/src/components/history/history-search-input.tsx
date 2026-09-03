'use client';

import { Search } from 'lucide-react';
import { Input, Label } from '@chatofy/ui/react';
import { SEARCH_LIMITS } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

interface HistorySearchInputProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * The history search box.
 *
 * Deliberately NOT accent-filled and deliberately not a button: `/history`
 * spends its one accent on "Start a conversation", and a filled Search control
 * beside it would make two on a screen whose budget is one.
 *
 * Debouncing and the URL round-trip live in the screen, not here — this stays a
 * controlled input so its behaviour is one thing a reader can check.
 */
export function HistorySearchInput({ value, onChange }: HistorySearchInputProps) {
  const t = useTranslate();

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="history-search" className="sr-only">
        {t('web.history.searchLabel')}
      </Label>
      <div className="relative">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          id="history-search"
          type="search"
          className="pl-9"
          value={value}
          maxLength={SEARCH_LIMITS.MAX_CHARS}
          placeholder={t('web.history.searchPlaceholder')}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}
