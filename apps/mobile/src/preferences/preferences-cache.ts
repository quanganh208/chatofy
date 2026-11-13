/**
 * The phone's copy of the account document, so Settings and the translate screen
 * open right offline and before the server answers, plus the change not yet
 * acknowledged by the server, so one made offline survives the app being killed.
 *
 * Two keys, each tagged with the account it belongs to (see
 * `preferences-cache-entries.ts`); `clear()` removes both at sign-out.
 */

import * as SecureStore from 'expo-secure-store';
import type { UserPreferences } from '@chatofy/types';
import type { PendingSlot, PreferencesCache } from '@chatofy/api-client';
import {
  documentEntry,
  documentFromEntry,
  pendingEntry,
  pendingFromEntry,
} from './preferences-cache-entries';

const KEY = 'chatofy.preferences';
const PENDING_KEY = 'chatofy.preferences.pending';

export function createPreferencesCache(userId: string): PreferencesCache {
  return {
    async read() {
      return documentFromEntry(await SecureStore.getItemAsync(KEY), userId);
    },

    async write(preferences: UserPreferences) {
      // `reading` is the web's transcript look and can be large; the phone never
      // renders it, and the server copy is what web reads, so it is not cached.
      await SecureStore.setItemAsync(KEY, documentEntry(userId, { ...preferences, reading: {} }));
    },

    async readPending() {
      return pendingFromEntry(await SecureStore.getItemAsync(PENDING_KEY), userId);
    },

    async writePending(value: PendingSlot | null) {
      if (value === null) await SecureStore.deleteItemAsync(PENDING_KEY);
      else await SecureStore.setItemAsync(PENDING_KEY, pendingEntry(userId, value));
    },

    async clear() {
      await Promise.all([
        SecureStore.deleteItemAsync(KEY),
        SecureStore.deleteItemAsync(PENDING_KEY),
      ]);
    },
  };
}
