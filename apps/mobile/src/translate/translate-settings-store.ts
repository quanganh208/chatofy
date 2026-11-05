/**
 * The device's store for {@link TranslateSettings}: one JSON value under one key.
 * Secure storage is what the app already depends on; the value is small and not a
 * secret, which is fine for it.
 */

import * as SecureStore from 'expo-secure-store';
import {
  DEFAULT_TRANSLATE_SETTINGS,
  parseTranslateSettings,
  type TranslateSettings,
} from './translate-settings';

const KEY = 'chatofy.translate.settings';

export async function loadTranslateSettings(): Promise<TranslateSettings> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? parseTranslateSettings(JSON.parse(raw)) : DEFAULT_TRANSLATE_SETTINGS;
  } catch {
    // An unreadable value is a first launch, not a crash.
    return DEFAULT_TRANSLATE_SETTINGS;
  }
}

export async function saveTranslateSettings(settings: TranslateSettings): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(settings));
  } catch {
    // Losing a preference must never interrupt a conversation.
  }
}
