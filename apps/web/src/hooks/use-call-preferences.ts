'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * What a person chose for reading and hearing a call, remembered in this browser.
 *
 * Captions (on or off) and their size follow Google Meet's caption settings; the original
 * voices' volume is Zoom's original-versus-translated balance, which here can only act on
 * the speakers' own audio (the translated voice is played by the call hook).
 *
 * It starts at the defaults on the server and on the first client render, then adopts the
 * stored choice. Storage is read, not trusted: each field is checked on its own, so one bad
 * value falls back to its default without throwing away the others.
 */
export type CaptionSize = 'sm' | 'md' | 'lg' | 'xl';

export interface CallPreferences {
  captions: boolean;
  captionSize: CaptionSize;
  /** 0 to 1: how loud the other people's own voices are. */
  originalVolume: number;
}

const KEY = 'chatofy.call-preferences';
const SIZES: readonly CaptionSize[] = ['sm', 'md', 'lg', 'xl'];

export const DEFAULT_CALL_PREFERENCES: CallPreferences = {
  captions: true,
  captionSize: 'md',
  originalVolume: 1,
};

const clampVolume = (value: number) => Math.min(1, Math.max(0, value));

function parse(raw: string | null): CallPreferences {
  if (!raw) return DEFAULT_CALL_PREFERENCES;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_CALL_PREFERENCES;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_CALL_PREFERENCES;
  const stored = value as Record<string, unknown>;
  return {
    captions:
      typeof stored.captions === 'boolean' ? stored.captions : DEFAULT_CALL_PREFERENCES.captions,
    captionSize: SIZES.includes(stored.captionSize as CaptionSize)
      ? (stored.captionSize as CaptionSize)
      : DEFAULT_CALL_PREFERENCES.captionSize,
    originalVolume:
      typeof stored.originalVolume === 'number' &&
      stored.originalVolume >= 0 &&
      stored.originalVolume <= 1
        ? stored.originalVolume
        : DEFAULT_CALL_PREFERENCES.originalVolume,
  };
}

export function useCallPreferences() {
  const [prefs, setPrefs] = useState<CallPreferences>(DEFAULT_CALL_PREFERENCES);

  useEffect(() => {
    try {
      // Read after mount so the server render and the first client paint agree.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrefs(parse(window.localStorage.getItem(KEY)));
    } catch {
      // Storage unavailable: the defaults stay.
    }
  }, []);

  const update = useCallback((patch: Partial<CallPreferences>) => {
    setPrefs((current) => {
      const next: CallPreferences = {
        ...current,
        ...patch,
        originalVolume: clampVolume(patch.originalVolume ?? current.originalVolume),
      };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Applied for this visit, not remembered.
      }
      return next;
    });
  }, []);

  return { prefs, update };
}
