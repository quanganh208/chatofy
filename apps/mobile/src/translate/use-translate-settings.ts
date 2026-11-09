/**
 * The translate settings as screen state: read once per app launch, written
 * through on every change. Until the stored value is read every screen shows the
 * defaults, and a change made in that gap wins over the late read.
 *
 * One value shared by every screen that uses it. The translate tab and Settings
 * stay mounted side by side; with a copy each, a pair picked on the translate tab
 * would save that tab's stale microphone choice over the one just made in
 * Settings, and the next start would open the microphone the old way.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_TRANSLATE_SETTINGS, type TranslateSettings } from './translate-settings';
import { loadTranslateSettings, saveTranslateSettings } from './translate-settings-store';

let current: TranslateSettings = DEFAULT_TRANSLATE_SETTINGS;
/** Flips once: when the stored value is read, or when a change lands before it. */
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One read per launch, however many screens ask for it. */
function ensureLoaded(): void {
  if (loaded || loading) return;
  loading = loadTranslateSettings().then((stored) => {
    // A change made before the read was made on the defaults and is kept.
    if (!loaded) {
      current = stored;
      loaded = true;
      notify();
    }
  });
}

function change(next: (settings: TranslateSettings) => TranslateSettings): void {
  current = next(current);
  loaded = true;
  void saveTranslateSettings(current);
  notify();
}

export function useTranslateSettings(): {
  settings: TranslateSettings;
  loaded: boolean;
  update: (change: (current: TranslateSettings) => TranslateSettings) => void;
} {
  const settings = useSyncExternalStore(subscribe, () => current);
  const isLoaded = useSyncExternalStore(subscribe, () => loaded);

  useEffect(ensureLoaded, []);

  const update = useCallback(
    (next: (current: TranslateSettings) => TranslateSettings) => change(next),
    [],
  );

  return { settings, loaded: isLoaded, update };
}
