'use client';

import { useCallback } from 'react';
import type { CallPreferencesDocument, CaptionSizePreference } from '@chatofy/types';
import { usePreferences } from '@/hooks/use-preferences';

/**
 * What a person chose for reading and hearing a call — an account preference, so
 * captions set up on the laptop are the captions on the phone.
 *
 * Captions (on or off) and their size follow Google Meet's caption settings; the original
 * voices' volume is Zoom's original-versus-translated balance, which here can only act on
 * the speakers' own audio (the translated voice is played by the call hook).
 *
 * It starts at the defaults on the server and on the first client render, then adopts the
 * stored choice. The document is read field by field (`parseUserPreferences`), so one bad
 * value falls back to its default without throwing away the others.
 */
export type CaptionSize = CaptionSizePreference;
export type CallPreferences = CallPreferencesDocument;

export const DEFAULT_CALL_PREFERENCES: CallPreferences = Object.freeze({
  captions: true,
  captionSize: 'md',
  originalVolume: 1,
});

const clampVolume = (value: number) => Math.min(1, Math.max(0, value));

export function useCallPreferences() {
  const { preferences, ready, update: updatePreferences } = usePreferences();
  const prefs = ready ? preferences.call : DEFAULT_CALL_PREFERENCES;

  const update = useCallback(
    (patch: Partial<CallPreferences>) => {
      updatePreferences({
        call:
          patch.originalVolume === undefined
            ? patch
            : { ...patch, originalVolume: clampVolume(patch.originalVolume) },
      });
    },
    [updatePreferences],
  );

  return { prefs, update };
}
