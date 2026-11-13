/**
 * The phone's copy of the account document, so Settings and the translate screen
 * open right offline and before the server answers.
 *
 * One value under one key, tagged with the account it belongs to: a phone handed
 * to someone else must not show the previous person's choices, so a cache written
 * for another account reads as empty.
 */

import * as SecureStore from 'expo-secure-store';
import type { UserPreferences } from '@chatofy/types';
import type { PreferencesCache } from '@chatofy/api-client';

const KEY = 'chatofy.preferences';

export function createPreferencesCache(userId: string): PreferencesCache {
  return {
    async read() {
      const raw = await SecureStore.getItemAsync(KEY);
      if (!raw) return null;
      const stored: unknown = JSON.parse(raw);
      if (typeof stored !== 'object' || stored === null) return null;
      const entry = stored as { userId?: unknown; preferences?: unknown };
      return entry.userId === userId ? (entry.preferences ?? null) : null;
    },

    async write(preferences: UserPreferences) {
      // `reading` is the web's transcript look and can be large; the phone never
      // renders it, and the server copy is what web reads, so it is not cached.
      const slim: UserPreferences = { ...preferences, reading: {} };
      await SecureStore.setItemAsync(KEY, JSON.stringify({ userId, preferences: slim }));
    },

    async clear() {
      await SecureStore.deleteItemAsync(KEY);
    },
  };
}
