'use client';

import type { VoiceGender } from '@chatofy/types';
import { SegmentedControl } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

/**
 * Which voices the picker below it lists.
 *
 * **It was a gender preference, and that made it inert.** It named the default
 * voice — the one the engine speaks with when no voice is named — while the
 * picker beside it listed every voice there was. Name a voice and the engine
 * drops the gender default for it, so pressing this changed nothing anyone could
 * hear: two adjacent controls, one of them dead, both reading as "the voice".
 *
 * As a scope it always does something. On a gender it narrows the list to that
 * gender's voices under that gender's default; `all` lists every voice the
 * backend published, grouped, each group under its own default. `all` is where
 * this opens, which is only defensible because both defaults are reachable from
 * it — a starting scope that could not express the starting state would push
 * that state into a greyed-out placeholder, which is exactly where it went the
 * first time this was built.
 */

/** A gender's voices, or every voice the backend published. */
export type VoiceScope = VoiceGender | 'all';

interface VoiceScopeToggleProps {
  value: VoiceScope;
  disabled?: boolean;
  onChange: (scope: VoiceScope) => void;
}

export function VoiceScopeToggle({ value, disabled, onChange }: VoiceScopeToggleProps) {
  const t = useTranslate();
  // Built here rather than hoisted to a module constant, and that is the point:
  // as a constant they carried English labels written inline, so a Vietnamese
  // reader saw English on a screen that was otherwise translated.
  const options: ReadonlyArray<{ value: VoiceScope; label: string }> = [
    { value: 'all', label: t('web.translate.voiceAll') },
    { value: 'female', label: t('web.translate.voiceFemale') },
    { value: 'male', label: t('web.translate.voiceMale') },
  ];

  return (
    // The label is `voiceGender`, not `voice`: the picker under it uses `voice`,
    // the two controls sit against each other, and sharing one key printed the
    // same word over both. It still names the axis being narrowed, which is what
    // the reader is choosing along even at `all`.
    <SegmentedControl
      label={t('web.translate.voiceGender')}
      // The same padding as the speed row under it. Two chip sizes in one
      // popover reads as two levels of importance, and these are peers.
      density="compact"
      // And the same full-width row. Between a picker and a speed strip that
      // both span the popover, a group hugging its own three words reads as
      // half-finished rather than as a narrower control — three segments of one
      // width is the same strip, divided.
      equalWidth
      value={value}
      options={options}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
