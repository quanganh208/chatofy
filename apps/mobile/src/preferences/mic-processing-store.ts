/**
 * The microphone chain this phone opens with. It describes this device's hardware
 * and OS, so it stays on the device rather than following the account.
 *
 * It used to live inside the old `chatofy.translate.settings` value. The first
 * read carries it over to its own key and removes the old key, so the phone keeps
 * its microphone setup while every other old value is dropped for the account's.
 */

import * as SecureStore from 'expo-secure-store';
import { DEFAULT_MIC_PROCESSING, type MicProcessing } from '@chatofy/types';
import { parseTranslateSettings } from '../translate/translate-settings';

const KEY = 'chatofy.translate.mic';
const LEGACY_SETTINGS_KEY = 'chatofy.translate.settings';

const DEFAULTS: MicProcessing = { ...DEFAULT_MIC_PROCESSING };

export async function loadMicProcessing(): Promise<MicProcessing> {
  try {
    const own = await SecureStore.getItemAsync(KEY);
    if (own) return parseTranslateSettings({ micProcessing: JSON.parse(own) }).micProcessing;

    const legacy = await SecureStore.getItemAsync(LEGACY_SETTINGS_KEY);
    if (legacy) {
      const mic = parseTranslateSettings(JSON.parse(legacy)).micProcessing;
      await SecureStore.setItemAsync(KEY, JSON.stringify(mic));
      return mic;
    }
    return DEFAULTS;
  } catch {
    // An unreadable value is a first launch, not a crash.
    return DEFAULTS;
  } finally {
    // The old key held the values the account now owns; nothing reads it again.
    void SecureStore.deleteItemAsync(LEGACY_SETTINGS_KEY).catch(() => undefined);
  }
}

export async function saveMicProcessing(mic: MicProcessing): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(mic));
  } catch {
    // Losing a preference must never interrupt a conversation.
  }
}
