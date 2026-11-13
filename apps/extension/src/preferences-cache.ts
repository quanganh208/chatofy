import {
  defaultUserPreferences,
  languagePairOf,
  parseUserPreferences,
  type UserPreferences,
} from '@chatofy/types';
import type { PreferencesCache } from '@chatofy/api-client';

/**
 * Where the account's preferences are kept on this machine.
 *
 * ONE key in `chrome.storage.local`, shared by the popup, the service worker and
 * the offscreen document — they are separate contexts with no memory in common,
 * and this value is what they agree through. `local`, never `sync`: the account
 * already carries these to other devices, and Chrome's own sync would be a second
 * path doing the same thing under a different identity.
 *
 * The document is stored bare, with no user id beside it. The extension holds
 * one account at a time and every way that account changes — sign-out, a refresh
 * the API refuses, signing in as someone else — passes through the token
 * storage, which clears this key with the tokens (`token-storage.ts`). The cache
 * cannot outlive the session it was fetched under.
 */
export const PREFERENCES_KEY = 'chatofy.preferences';

/**
 * What an empty cache means: the account defaults for this browser's language,
 * with the extension's own opening pair (English into Vietnamese: the OTHER side
 * of a meeting is usually speaking English).
 */
export function extensionDefaults(): UserPreferences {
  const base = defaultUserPreferences(browserLanguage());
  return { ...base, pairs: { ...base.pairs, extension: languagePairOf('en', 'vi') } };
}

function browserLanguage(): string | null {
  const tag = typeof navigator === 'undefined' ? '' : navigator.language;
  return tag.split('-')[0] || null;
}

/** The cached document, or null when nothing is cached (signed out, first run). */
export async function readCachedPreferences(): Promise<UserPreferences | null> {
  const stored = await chrome.storage.local.get(PREFERENCES_KEY);
  const value = stored[PREFERENCES_KEY];
  if (value === undefined || value === null) return null;
  return parseUserPreferences(value, extensionDefaults());
}

export const preferencesCache: PreferencesCache = {
  read: readCachedPreferences,
  write: (preferences) => chrome.storage.local.set({ [PREFERENCES_KEY]: preferences }),
  clear: () => chrome.storage.local.remove(PREFERENCES_KEY),
};
