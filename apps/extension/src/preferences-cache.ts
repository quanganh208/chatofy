import { defaultUserPreferences, parseUserPreferences, type UserPreferences } from '@chatofy/types';
import type { PendingSlot, PreferencesCache } from '@chatofy/api-client';

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
 * The changes this machine has made that the API has not acknowledged, one
 * entry per context (popup, worker) so neither overwrites or clears the other's.
 *
 * Kept apart from the document so a context that dies mid-save (the service
 * worker, a dismissed popup) leaves its change where the next store's `start`
 * finds and sends it, instead of the refresh overwriting it. Like the document
 * it holds no user id and is cleared with it: `clearTokens` and `signIn` remove
 * both keys, so a pending change is never sent under another account.
 */
export const PENDING_PREFERENCES_KEY = 'chatofy.preferences.pending';

/**
 * What an empty cache means: exactly what the server would give a new account
 * with this browser's language. No client-side override, so the pair never flips
 * when the first fetch replaces the offline default with the stored document.
 */
export function extensionDefaults(): UserPreferences {
  return defaultUserPreferences(browserLanguage());
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
  clear: () => chrome.storage.local.remove([PREFERENCES_KEY, PENDING_PREFERENCES_KEY]),
  readPending: async () =>
    (await chrome.storage.local.get(PENDING_PREFERENCES_KEY))[PENDING_PREFERENCES_KEY],
  // Opaque: the store keeps one entry per context in the slot, stored as given.
  writePending: (slot: PendingSlot | null) =>
    slot === null
      ? chrome.storage.local.remove(PENDING_PREFERENCES_KEY)
      : chrome.storage.local.set({ [PENDING_PREFERENCES_KEY]: slot }),
};
