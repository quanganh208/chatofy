import {
  defaultUserPreferences,
  languagePairOf,
  mergePreferences,
  type UserPreferences,
  type UserPreferencesPatch,
} from '@chatofy/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_PREFERENCES_KEY, PREFERENCES_KEY } from './preferences-cache';
import { createExtensionPreferences, saveSyncedFields } from './preferences-store';
import { loadTheme } from './theme';

const store = new Map<string, unknown>();
const requests: { method: string; body?: unknown }[] = [];

beforeEach(() => {
  store.clear();
  requests.length = 0;
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: (key: string) => Promise.resolve(store.has(key) ? { [key]: store.get(key) } : {}),
        set: (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          for (const key of [keys].flat()) store.delete(key);
          return Promise.resolve();
        },
      },
    },
  };
  // The account's server copy; PATCH merges into it like the API does.
  let server: UserPreferences = {
    ...defaultUserPreferences('en'),
    pairs: { ...defaultUserPreferences('en').pairs, extension: languagePairOf('en', 'vi') },
  };
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = (init?.body ? JSON.parse(init.body as string) : undefined) as
      { preferences: UserPreferencesPatch } | undefined;
    requests.push({ method, body });
    if (method === 'PATCH' && body) server = mergePreferences(server, body.preferences);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          success: true,
          data: { preferences: server, updatedAt: null },
          meta: { requestId: 'r', timestamp: 't' },
        }),
        { status: 200 },
      ),
    );
  });
});

describe('saveSyncedFields', () => {
  it('does nothing when signed out', async () => {
    await saveSyncedFields('http://api.test', { languagePair: languagePairOf('vi', 'en') });
    expect(requests).toEqual([]);
    expect(store.has(PREFERENCES_KEY)).toBe(false);
  });

  it('patches the account and leaves the new value in the cache a capture reads', async () => {
    store.set('chatofy.accessToken', 'token');
    await saveSyncedFields('http://api.test', {
      languagePair: languagePairOf('vi', 'en'),
      voiceGender: 'male',
    });
    const patch = requests.find((r) => r.method === 'PATCH');
    expect(patch?.body).toEqual({
      preferences: {
        pairs: { extension: { source: 'vi', target: 'en' } },
        voices: { en: { gender: 'male' } },
      },
    });
    expect(store.get(PREFERENCES_KEY)).toMatchObject({
      pairs: { extension: { source: 'vi', target: 'en' } },
      voices: { en: { gender: 'male' } },
    });
  });

  it('sends nothing when the account already holds the value', async () => {
    store.set('chatofy.accessToken', 'token');
    await saveSyncedFields('http://api.test', { languagePair: languagePairOf('en', 'vi') });
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false);
  });
});

describe('a save the worker could not finish', () => {
  it('is kept and sent by the next store that starts', async () => {
    store.set('chatofy.accessToken', 'token');
    const healthy = globalThis.fetch;
    // The API is down for the worker's write.
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PATCH') return Promise.reject(new Error('offline'));
      return healthy(_url, init);
    });
    await saveSyncedFields('http://api.test', { languagePair: languagePairOf('vi', 'en') });
    expect(store.get(PENDING_PREFERENCES_KEY)).toEqual({
      pairs: { extension: { source: 'vi', target: 'en' } },
    });

    // The API is back; the popup's store re-applies it and sends it.
    vi.stubGlobal('fetch', healthy);
    requests.length = 0;
    const popup = createExtensionPreferences('http://api.test');
    await popup.start();
    await popup.flush();
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({
      preferences: { pairs: { extension: { source: 'vi', target: 'en' } } },
    });
    expect(popup.getState().preferences.pairs.extension).toEqual({ source: 'vi', target: 'en' });
    expect(store.has(PENDING_PREFERENCES_KEY)).toBe(false);
    await popup.dispose();
  });

  it('is dropped with the session, so it cannot be sent under another account', async () => {
    store.set(PENDING_PREFERENCES_KEY, { theme: 'dark' });
    store.set(PREFERENCES_KEY, defaultUserPreferences('en'));
    const { clearTokens } = await import('./token-storage');
    await clearTokens();
    expect(store.has(PENDING_PREFERENCES_KEY)).toBe(false);
    expect(store.has(PREFERENCES_KEY)).toBe(false);
  });
});

describe('loadTheme', () => {
  it('reads the cached account theme and is system without one', async () => {
    expect(await loadTheme()).toBe('system');
    store.set(PREFERENCES_KEY, { ...defaultUserPreferences('en'), theme: 'dark' });
    expect(await loadTheme()).toBe('dark');
  });
});
