'use client';

import type { VoiceGender } from '@chatofy/types';
import { SegmentedControl } from '@/components/ui/segmented-control';

interface VoiceGenderToggleProps {
  value: VoiceGender;
  disabled?: boolean;
  onChange: (voiceGender: VoiceGender) => void;
}

const OPTIONS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
] as const satisfies ReadonlyArray<{ value: VoiceGender; label: string }>;

/**
 * Picks the voice the translation is spoken in.
 *
 * Not gated on direction: both output languages have a voice for each gender,
 * so the choice means the same thing whichever way the conversation runs.
 */
export function VoiceGenderToggle({ value, disabled, onChange }: VoiceGenderToggleProps) {
  return (
    <SegmentedControl
      label="Voice"
      value={value}
      options={OPTIONS}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
