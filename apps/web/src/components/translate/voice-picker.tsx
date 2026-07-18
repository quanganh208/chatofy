'use client';

import { VIENEU_VOICES } from '@chatofy/types';

interface VoicePickerProps {
  value: string;
  disabled?: boolean;
  onChange: (voice: string) => void;
}

/** VieNeu preset voice picker — only shown for en→vi output. */
export function VoicePicker({ value, disabled, onChange }: VoicePickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="vieneu-voice" className="text-sm">
        Vietnamese voice
      </label>
      <select
        id="vieneu-voice"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
      >
        {VIENEU_VOICES.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}
