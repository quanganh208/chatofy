'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@chatofy/ui/react';
import { LANGUAGE_CODES, LANGUAGES } from '@chatofy/types';
import type { LanguageCode } from '@chatofy/types';

interface Props {
  /** The id a `<Label htmlFor>` points at, so the trigger is named by its label. */
  id: string;
  value: LanguageCode;
  onChange: (value: LanguageCode) => void;
  disabled?: boolean;
}

/** One language from the supported list — a glossary's source, or a term's target. */
export function GlossaryLanguageSelect({ id, value, onChange, disabled }: Props) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as LanguageCode)}>
      <SelectTrigger id={id} className="w-full" disabled={disabled}>
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
  );
}
