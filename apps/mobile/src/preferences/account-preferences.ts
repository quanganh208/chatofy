/**
 * The signed-in account's preferences as app state: one sync store per account,
 * created when someone signs in and disposed (cache cleared) when they sign out.
 *
 * Screens never hold the store; they read this module through
 * `useAccountPreferences`, which survives the store being replaced by a different
 * account. Until someone is bound every reader sees the defaults and writes go
 * nowhere, which is right: nothing is stored for nobody.
 */

import { useSyncExternalStore } from 'react';
import {
  createPreferencesSync,
  type PreferencesSync,
  type PreferencesSyncState,
} from '@chatofy/api-client';
import { defaultUserPreferences, type UserPreferencesPatch } from '@chatofy/types';
import { getPreferences, resetPreferences, updatePreferences } from '@/clients/api-client';
import { createPreferencesCache } from './preferences-cache';

/**
 * The sync state plus `hydrated`: true once the preferences are the account's own
 * — the phone's cached copy was found, the server answered, or someone changed a
 * setting here. Before that they are defaults, which a reader such as the theme
 * must not act on. Other publishes (an orphaned change taken over, a status
 * change) do not count.
 */
export interface AccountPreferencesState extends PreferencesSyncState {
  hydrated: boolean;
}

const UNBOUND: AccountPreferencesState = {
  preferences: defaultUserPreferences(),
  status: 'idle',
  loaded: false,
  hydrated: false,
};

let sync: PreferencesSync | null = null;
let unsubscribeSync: (() => void) | null = null;
let snapshot: AccountPreferencesState = UNBOUND;
/** Set by a change made on this phone, which is the account's own choice. */
let edited = false;
const listeners = new Set<() => void>();

function setSnapshot(next: AccountPreferencesState): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Start syncing for `userId`; `locale` seeds the defaults a brand-new account gets. */
export function bindAccountPreferences(userId: string, locale?: string | null): void {
  void unbindAccountPreferences(false);
  edited = false;
  const cache = createPreferencesCache(userId);
  let cacheFound = false;
  const store = createPreferencesSync({
    transport: { load: getPreferences, save: updatePreferences, reset: resetPreferences },
    cache: {
      ...cache,
      async read() {
        const cached = await cache.read();
        if (cached !== null && cached !== undefined) cacheFound = true;
        return cached;
      },
    },
    defaults: defaultUserPreferences(locale),
  });
  sync = store;
  unsubscribeSync = store.subscribe((state) =>
    setSnapshot({ ...state, hydrated: snapshot.hydrated || cacheFound || state.loaded || edited }),
  );
  setSnapshot({ ...store.getState(), hydrated: false });
  void store.start();
}

/** Sign-out passes `true`, so the next person on this phone finds no cache. */
export async function unbindAccountPreferences(clearCache: boolean): Promise<void> {
  const store = sync;
  unsubscribeSync?.();
  sync = null;
  unsubscribeSync = null;
  setSnapshot(UNBOUND);
  await store?.dispose(clearCache);
}

export function updateAccountPreferences(patch: UserPreferencesPatch): void {
  if (sync) edited = true;
  sync?.update(patch);
}

/** Back to the defaults on every device. Rejects when the server cannot be reached. */
export async function resetAccountPreferences(): Promise<void> {
  await sync?.reset();
}

/** Read the server copy and send anything pending; for the app coming to the foreground. */
export function refreshAccountPreferences(): void {
  void sync?.flush();
  void sync?.refresh();
}

/** Send anything pending now; for the app leaving the foreground. */
export function flushAccountPreferences(): void {
  void sync?.flush();
}

/**
 * Defer remote changes while a conversation or call runs. Returns the release,
 * which acts on the store that was held even if the account changed meanwhile.
 */
export function holdAccountPreferences(): () => void {
  const store = sync;
  store?.hold();
  return () => store?.release();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAccountPreferences(): AccountPreferencesState {
  return useSyncExternalStore(subscribe, () => snapshot);
}
