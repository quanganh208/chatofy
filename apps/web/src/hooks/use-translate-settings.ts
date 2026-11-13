'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { usePreferences } from '@/hooks/use-preferences';
import {
  loadMicProcessing,
  saveMicProcessing,
  subscribeMicProcessing,
} from '@/lib/mic-processing-store';
import { activePreferences } from '@/lib/preferences/active-preferences';
import { DEFAULT_TRANSLATE_SETTINGS, type TranslateSettings } from '@/lib/translate-settings';
import {
  currentTranslateSettings,
  preferencesPatchFromTranslateSettings,
  translateSettingsOf,
} from '@/lib/translate-settings-preferences';

export interface UseTranslateSettings {
  settings: TranslateSettings;
  /**
   * False until the reader's own setup has been read — from this browser's copy of
   * the account's preferences, or failing that from the server.
   *
   * The server has neither, so the server render and the hydrating render show
   * defaults. A control rendered against those defaults and then corrected a frame
   * later reads as the UI changing its own mind, so callers wait on this instead.
   */
  ready: boolean;
  /** Merge a patch into the settings. State updates now; the account settles. */
  set: (patch: Partial<TranslateSettings>) => void;
  /**
   * The current settings, readable from a closure that outlives a render.
   *
   * This exists for one specific consumer: `useStreamingTranslate` builds its
   * `ConversationSession` ONCE, on first render, which is before the preferences
   * are ready. Anything that closure captures by value is frozen at the defaults
   * for the lifetime of the page — the same trap the access token has, and solved
   * the same way, by handing over a reader instead of a value.
   */
  current: () => TranslateSettings;
}

/**
 * The translator's settings, read from the account's preferences.
 *
 * Every owner reads the same store, so the translate page and the Settings dialog
 * opened over it cannot hold diverging copies: a change made in one is in the
 * other's next render, and in every other tab of this browser through the store's
 * channel. The save is debounced inside the store, so a dragged slider is one
 * request, not one per frame.
 */
export function useTranslateSettings(): UseTranslateSettings {
  const { preferences, ready } = usePreferences();
  const mic = useSyncExternalStore(
    subscribeMicProcessing,
    loadMicProcessing,
    () => DEFAULT_TRANSLATE_SETTINGS.micProcessing,
  );
  const settings = useMemo(
    () => (ready ? translateSettingsOf(preferences, mic) : DEFAULT_TRANSLATE_SETTINGS),
    [ready, preferences, mic],
  );

  const set = useCallback((patch: Partial<TranslateSettings>) => {
    if (patch.micProcessing) saveMicProcessing(patch.micProcessing);
    const documentPatch = preferencesPatchFromTranslateSettings(patch);
    if (Object.keys(documentPatch).length > 0) activePreferences().update(documentPatch);
  }, []);

  const current = useCallback(() => currentTranslateSettings(), []);

  return { settings, ready, set, current };
}
