'use client';

import type { VoiceGender } from '@chatofy/types';
import { SegmentedControl } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

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
 *
 * The options are built here rather than hoisted to a module constant, and that
 * is the point: as a constant they carried English labels written inline, so a
 * Vietnamese reader saw English on a screen that was otherwise translated.
 * `web.translate.voiceFemale` and `voiceMale` existed the whole time and were
 * read by nothing — which `tsc` cannot see, because a key that exists and is
 * never used is not a type error.
 *
 * The label is `voiceGender`, not `voice`. `translate-settings-panel.tsx` uses
 * `voice` for the picker that chooses a specific voice, and the two controls sit
 * next to each other; sharing one key printed the same word over both.
 */
export function VoiceGenderToggle({ value, disabled, onChange }: VoiceGenderToggleProps) {
  const t = useTranslate();
  const options: ReadonlyArray<{ value: VoiceGender; label: string }> = [
    { value: 'female', label: t('web.translate.voiceFemale') },
    { value: 'male', label: t('web.translate.voiceMale') },
  ];

  return (
    <SegmentedControl
      label={t('web.translate.voiceGender')}
      value={value}
      options={options}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
