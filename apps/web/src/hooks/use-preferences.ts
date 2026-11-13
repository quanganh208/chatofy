'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  defaultUserPreferences,
  type ThemeChoice,
  type UserPreferencesPatch,
} from '@chatofy/types';
import {
  activePreferences,
  activePreferencesSnapshot,
  subscribeActivePreferences,
} from '@/lib/preferences/active-preferences';
import type { PreferencesSnapshot } from '@/lib/preferences/preferences-holders';
import { applyChoice } from '@/lib/theme';

/**
 * The server has no account and no storage, so it renders the defaults, not ready
 * — and so does the hydrating render, which must match it. The stored setup
 * arrives the render after.
 */
const SERVER_SNAPSHOT: PreferencesSnapshot = Object.freeze({
  preferences: defaultUserPreferences('en'),
  status: 'idle',
  ready: false,
  synced: false,
});

export interface UsePreferences extends PreferencesSnapshot {
  update: (patch: UserPreferencesPatch) => void;
  reset: () => Promise<void>;
}

/** The tab's preferences: an account's when signed in, a visitor's otherwise. */
export function usePreferences(): UsePreferences {
  const snapshot = useSyncExternalStore(
    subscribeActivePreferences,
    activePreferencesSnapshot,
    () => SERVER_SNAPSHOT,
  );
  const update = useCallback(
    (patch: UserPreferencesPatch) => activePreferences().update(patch),
    [],
  );
  const reset = useCallback(() => activePreferences().reset(), []);
  return { ...snapshot, update, reset };
}

/**
 * Keep remote changes out for as long as `active` is true and the caller is
 * mounted: a voice changed on the phone takes effect at the next conversation or
 * call, never halfway through a sentence. Local changes still apply.
 */
export function usePreferencesHold(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const holder = activePreferences();
    holder.hold();
    return () => holder.release();
  }, [active]);
}

export interface UseThemeChoice {
  /** Undefined until the stored choice is known, so nothing is marked rather than the wrong one. */
  choice: ThemeChoice | undefined;
  /** Picks, paints the document at once, and saves. */
  setChoice: (next: ThemeChoice) => void;
}

export function useThemeChoice(): UseThemeChoice {
  const { preferences, ready, update } = usePreferences();
  const setChoice = useCallback(
    (next: ThemeChoice) => {
      applyChoice(next);
      update({ theme: next });
    },
    [update],
  );
  return { choice: ready ? preferences.theme : undefined, setChoice };
}
