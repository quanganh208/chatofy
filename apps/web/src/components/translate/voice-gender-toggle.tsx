'use client';

import type { VoiceGender } from '@chatofy/types';
import { Button } from '@/components/ui/button';

interface VoiceGenderToggleProps {
  value: VoiceGender;
  disabled?: boolean;
  onChange: (voiceGender: VoiceGender) => void;
}

/**
 * Picks the voice the translation is spoken in.
 *
 * Not gated on direction: both output languages have a voice for each gender,
 * so the choice means the same thing whichever way the conversation runs.
 */
export function VoiceGenderToggle({ value, disabled, onChange }: VoiceGenderToggleProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm">Voice</span>
      <div className="flex gap-2">
        <Button
          variant={value === 'female' ? 'default' : 'outline'}
          onClick={() => onChange('female')}
          disabled={disabled}
        >
          Female
        </Button>
        <Button
          variant={value === 'male' ? 'default' : 'outline'}
          onClick={() => onChange('male')}
          disabled={disabled}
        >
          Male
        </Button>
      </div>
    </div>
  );
}
