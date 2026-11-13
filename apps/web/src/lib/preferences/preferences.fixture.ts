/**
 * Specs only: an account's preferences behind an in-memory server.
 *
 * The transport answers the way `/me/preferences` does — PATCH merges and returns
 * the stored document, DELETE returns the defaults — so a spec exercises the real
 * sync store and the real holder, and asserts on what reached "the server".
 */
import type { PreferencesTransport } from '@chatofy/api-client';
import {
  defaultUserPreferences,
  mergePreferences,
  type PreferencesResponse,
  type UserPreferences,
  type UserPreferencesPatch,
} from '@chatofy/types';
import { setActivePreferences } from './active-preferences';
import { createAccountHolder, type AccountHolder } from './preferences-holders';

export interface FakePreferencesServer {
  transport: PreferencesTransport;
  /** Every PATCH body, in order. */
  saves: UserPreferencesPatch[];
  stored(): UserPreferences;
  /** Replace the stored document, as another device's save would. */
  setStored(next: UserPreferences): void;
  /** While true every request rejects, as offline would. */
  failing: boolean;
}

export function fakePreferencesServer(initial: UserPreferencesPatch = {}): FakePreferencesServer {
  let stored = mergePreferences(defaultUserPreferences('en'), initial);
  const saves: UserPreferencesPatch[] = [];
  const server: FakePreferencesServer = {
    saves,
    stored: () => stored,
    setStored: (next) => {
      stored = next;
    },
    failing: false,
    transport: {
      load: () => answer(() => stored),
      save: (patch) =>
        answer(() => {
          saves.push(patch);
          stored = mergePreferences(stored, patch);
          return stored;
        }),
      reset: () =>
        answer(() => {
          stored = defaultUserPreferences('en');
          return stored;
        }),
    },
  };
  function answer(run: () => UserPreferences): Promise<PreferencesResponse> {
    if (server.failing) return Promise.reject(new Error('offline'));
    return Promise.resolve({ preferences: structuredClone(run()), updatedAt: null });
  }
  return server;
}

/**
 * Make a signed-in account the tab's preferences, confirmed, and return it. Call
 * `await settle()` afterwards (or advance fake timers) for the first load to land.
 */
export function signInPreferences(
  server: FakePreferencesServer,
  options: { userId?: string; debounceMs?: number } = {},
): AccountHolder {
  const holder = createAccountHolder({
    userId: options.userId ?? 'user-1',
    locale: 'en',
    transport: server.transport,
    debounceMs: options.debounceMs ?? 50,
  });
  holder.confirm();
  setActivePreferences(holder);
  return holder;
}
