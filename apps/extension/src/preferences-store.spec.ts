import {
  defaultUserPreferences,
  languagePairOf,
  mergePreferences,
  type UserPreferences,
  type UserPreferencesPatch,
} from '@chatofy/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_PREFERENCES_KEY, PREFERENCES_KEY } from './preferences-cache';
import {
  createExtensionPreferences,
  recordSyncedFields,
  sendPendingPreferences,
} from './preferences-store';
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
  let server: UserPreferences = defaultUserPreferences('en');
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

const save = async (change: Parameters<typeof recordSyncedFields>[0]) => {
  const recorded = await recordSyncedFields(change);
  if (recorded) await sendPendingPreferences('http://api.test');
  return recorded;
};

describe('recording and sending synced fields', () => {
  it('does nothing when signed out', async () => {
    expect(await save({ languagePair: languagePairOf('vi', 'en') })).toBe(false);
    expect(requests).toEqual([]);
    expect(store.has(PREFERENCES_KEY)).toBe(false);
  });

  it('patches the account and leaves the new value in the cache a capture reads', async () => {
    store.set('chatofy.accessToken', 'token');
    await save({ languagePair: languagePairOf('en', 'zh'), voiceGender: 'male' });
    const patch = requests.find((r) => r.method === 'PATCH');
    expect(patch?.body).toEqual({
      preferences: {
        pairs: { extension: { source: 'en', target: 'zh' } },
        voices: { zh: { gender: 'male' } },
      },
    });
    expect(store.get(PREFERENCES_KEY)).toMatchObject({
      pairs: { extension: { source: 'en', target: 'zh' } },
      voices: { zh: { gender: 'male' } },
    });
    expect(store.has(PENDING_PREFERENCES_KEY)).toBe(false);
  });

  it('sends nothing when the account already holds the value', async () => {
    store.set('chatofy.accessToken', 'token');
    store.set(PREFERENCES_KEY, defaultUserPreferences('en'));
    expect(await save({ languagePair: defaultUserPreferences('en').pairs.extension })).toBe(false);
    expect(requests).toEqual([]);
  });

  it('records locally with no request, so a capture can reopen before the network answers', async () => {
    store.set('chatofy.accessToken', 'token');
    store.set(PREFERENCES_KEY, defaultUserPreferences('en'));
    expect(await recordSyncedFields({ languagePair: languagePairOf('en', 'zh') })).toBe(true);
    // Nothing has gone over the wire, yet the cache a capture reads and the
    // pending entry a dead worker's successor would send are both written.
    expect(requests).toEqual([]);
    expect(store.get(PREFERENCES_KEY)).toMatchObject({
      pairs: { extension: { source: 'en', target: 'zh' } },
    });
    expect(store.get(PENDING_PREFERENCES_KEY)).toEqual({
      contexts: { worker: { pairs: { extension: { source: 'en', target: 'zh' } } } },
    });
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
    await save({ languagePair: languagePairOf('en', 'zh') });
    // The failed store took the worker's entry over as its own; either way it is kept.
    const slot = store.get(PENDING_PREFERENCES_KEY) as { contexts: Record<string, unknown> };
    expect(Object.values(slot.contexts)).toEqual([
      { pairs: { extension: { source: 'en', target: 'zh' } } },
    ]);

    // The API is back; the popup's store re-applies it and sends it.
    vi.stubGlobal('fetch', healthy);
    requests.length = 0;
    const popup = createExtensionPreferences('http://api.test');
    await popup.start();
    await popup.flush();
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({
      preferences: { pairs: { extension: { source: 'en', target: 'zh' } } },
    });
    expect(popup.getState().preferences.pairs.extension).toEqual({ source: 'en', target: 'zh' });
    expect(store.has(PENDING_PREFERENCES_KEY)).toBe(false);
    await popup.dispose();
  });

  it('is dropped with the session, so it cannot be sent under another account', async () => {
    store.set(PENDING_PREFERENCES_KEY, { contexts: { worker: { theme: 'dark' } } });
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

describe('extensionDefaults', () => {
  it('equals the server default for the browser language', async () => {
    vi.stubGlobal('navigator', { language: 'vi-VN' });
    const { extensionDefaults } = await import('./preferences-cache');
    expect(extensionDefaults()).toEqual(defaultUserPreferences('vi'));
    vi.unstubAllGlobals();
  });
});
