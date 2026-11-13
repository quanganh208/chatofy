/**
 * The translate settings as screen state. Everything but the microphone chain
 * comes from the signed-in account's preferences (synced with web and the
 * extension); the microphone chain is this phone's own and lives in
 * `mic-processing-store.ts`. Every change is applied at once and saved behind it.
 *
 * One value shared by every screen that uses it. The translate tab and Settings
 * stay mounted side by side, so both read the same store instead of a copy each.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { DEFAULT_MIC_PROCESSING, type MicProcessing } from '@chatofy/types';
import { loadMicProcessing, saveMicProcessing } from '@/preferences/mic-processing-store';
import { updateAccountPreferences, useAccountPreferences } from '@/preferences/account-preferences';
import {
  patchFromSettings,
  settingsFromPreferences,
} from '@/preferences/translate-preferences-mapping';
import type { TranslateSettings } from './translate-settings';

let mic: MicProcessing = { ...DEFAULT_MIC_PROCESSING };
/** Flips once: when the stored value is read, or when a change lands before it. */
let micLoaded = false;
let micLoading: Promise<void> | null = null;
const micListeners = new Set<() => void>();

function notifyMic(): void {
  for (const listener of micListeners) listener();
}

function subscribeMic(listener: () => void): () => void {
  micListeners.add(listener);
  return () => micListeners.delete(listener);
}

/** One read per launch, however many screens ask for it. */
function ensureMicLoaded(): void {
  if (micLoaded || micLoading) return;
  micLoading = loadMicProcessing().then((stored) => {
    // A change made before the read was made on the defaults and is kept.
    if (!micLoaded) {
      mic = stored;
      micLoaded = true;
      notifyMic();
    }
  });
}

function changeMic(next: MicProcessing): void {
  mic = next;
  micLoaded = true;
  void saveMicProcessing(next);
  notifyMic();
}

export function useTranslateSettings(): {
  settings: TranslateSettings;
  /** The microphone choice has been read, so a switch on it is safe to offer. */
  loaded: boolean;
  update: (change: (current: TranslateSettings) => TranslateSettings) => void;
} {
  const account = useAccountPreferences();
  const micProcessing = useSyncExternalStore(subscribeMic, () => mic);
  const loaded = useSyncExternalStore(subscribeMic, () => micLoaded);

  useEffect(ensureMicLoaded, []);

  const settings = useMemo(
    () => settingsFromPreferences(account.preferences, micProcessing),
    [account.preferences, micProcessing],
  );

  const update = useCallback(
    (next: (current: TranslateSettings) => TranslateSettings) => {
      const changed = next(settings);
      if (changed.micProcessing !== settings.micProcessing) changeMic(changed.micProcessing);
      const patch = patchFromSettings(settings, changed);
      if (patch) updateAccountPreferences(patch);
    },
    [settings],
  );

  return { settings, loaded, update };
}
