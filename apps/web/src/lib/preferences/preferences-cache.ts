/**
 * The one local copy of the account's preferences.
 *
 * ONE key, `{ userId, preferences }`. The copy is what makes a returning visit
 * right on first paint — the blocking script in `app/layout.tsx` reads the theme
 * from it before anything renders — and what the page serves offline. The server
 * document is the truth; this is a cache of it.
 *
 * **Owned by one user.** A copy whose `userId` is not the signed-in account's is
 * ignored rather than shown: on a shared browser, the last person's voices and
 * pairs are not the next person's. Signing out forgets the account's copy.
 *
 * **Signed-out visitors keep one thing here: the theme**, under `userId: null`. A
 * marketing or sign-in page has no account to sync with, and the only preference
 * it renders is the ground it is drawn on. Kept through sign-out for the same
 * reason — the page someone was just reading should not flash to another theme as
 * they leave — and never imported into an account, which reads its own.
 *
 * Every storage touch is wrapped: a private window or a disabled-storage policy
 * throws on access, and the cache is never worth a broken page.
 */
import { themeChoiceSchema, type ThemeChoice, type UserPreferences } from '@chatofy/types';
import type { PreferencesCache } from '@chatofy/api-client';
import { carryLegacyMicProcessing } from '@/lib/mic-processing-store';

export const PREFERENCES_CACHE_KEY = 'chatofy.preferences';

/**
 * Where preferences lived before they moved to the account, one key per setting
 * group. Removed — never imported — once the account store is in use.
 */
export const LEGACY_PREFERENCE_KEYS = [
  'chatofy.translate-settings',
  'chatofy.theme',
  'chatofy.translate-mode',
  'chatofy.call-preferences',
  'chatofy.conference.language',
] as const;

interface CacheEntry {
  userId: string | null;
  preferences: unknown;
}

export function readCacheEntry(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(PREFERENCES_CACHE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { userId, preferences } = value as Record<string, unknown>;
    return { userId: typeof userId === 'string' ? userId : null, preferences };
  } catch {
    return null;
  }
}

function writeCacheEntry(entry: CacheEntry): void {
  try {
    localStorage.setItem(PREFERENCES_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Full or refused: the page keeps its in-memory copy, and the server its own.
  }
}

/** The theme the cache holds, whoever it belongs to — what the pre-paint script reads. */
export function readCachedTheme(): ThemeChoice {
  const preferences = readCacheEntry()?.preferences;
  const theme =
    typeof preferences === 'object' && preferences !== null
      ? (preferences as Record<string, unknown>).theme
      : undefined;
  const parsed = themeChoiceSchema.safeParse(theme);
  return parsed.success ? parsed.data : 'system';
}

/** The signed-in user id the cache was written for, or null. */
export function cachedUserId(): string | null {
  return readCacheEntry()?.userId ?? null;
}

/** A signed-out visitor's theme, replacing whatever the cache held. */
export function writeVisitorTheme(theme: ThemeChoice): void {
  writeCacheEntry({ userId: null, preferences: { theme } });
}

/**
 * Forget the account's copy and keep its theme as the visitor's. Called on
 * sign-out and whenever the browser turns out to be signed out under a copy that
 * still names an account.
 */
export function forgetAccountPreferences(): void {
  const entry = readCacheEntry();
  if (!entry || entry.userId === null) return;
  writeVisitorTheme(readCachedTheme());
}

/** The cache the shared sync store reads and writes, scoped to one account. */
export function accountPreferencesCache(userId: string): PreferencesCache {
  return {
    read: () => {
      const entry = readCacheEntry();
      return entry?.userId === userId ? entry.preferences : null;
    },
    write: (preferences: UserPreferences) => writeCacheEntry({ userId, preferences }),
    clear: () => forgetAccountPreferences(),
  };
}

/**
 * Remove the pre-account keys. One small, idempotent sweep, run whenever an
 * account store starts: nothing is imported from them (the account's document is
 * the reader's setup now), except the microphone chain, which stays on the device
 * and is carried to its own key first.
 */
export function removeLegacyPreferenceKeys(): void {
  carryLegacyMicProcessing();
  for (const key of LEGACY_PREFERENCE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage refused: the next start tries again.
    }
  }
}
