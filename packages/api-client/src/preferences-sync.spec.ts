import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultUserPreferences,
  mergePreferences,
  type PreferencesResponse,
  type UserPreferences,
  type UserPreferencesPatch,
} from '@chatofy/types';
import { createPreferencesSync, type PreferencesTransport } from './preferences-sync.js';

const defaults = defaultUserPreferences('en');

function fakeServer(initial: UserPreferences = defaults) {
  let stored = initial;
  const saves: UserPreferencesPatch[] = [];
  let failNext = 0;
  const transport: PreferencesTransport = {
    load: vi.fn(async (): Promise<PreferencesResponse> => ({
      preferences: stored,
      updatedAt: null,
    })),
    save: vi.fn(async (patch): Promise<PreferencesResponse> => {
      if (failNext > 0) {
        failNext -= 1;
        throw new Error('offline');
      }
      saves.push(patch);
      stored = mergePreferences(stored, patch);
      return { preferences: stored, updatedAt: 'now' };
    }),
    reset: vi.fn(async (): Promise<PreferencesResponse> => {
      stored = defaults;
      return { preferences: stored, updatedAt: null };
    }),
  };
  return {
    transport,
    saves,
    failTimes: (n: number) => {
      failNext = n;
    },
    set: (next: UserPreferences) => {
      stored = next;
    },
  };
}

function memoryCache(initial: unknown = null) {
  let value = initial;
  return {
    read: () => value,
    write: (next: UserPreferences) => {
      value = next;
    },
    clear: () => {
      value = null;
    },
    get value() {
      return value;
    },
  };
}

describe('createPreferencesSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('serves the cache first, then the server copy', async () => {
    const server = fakeServer(mergePreferences(defaults, { theme: 'dark' }));
    const cache = memoryCache(mergePreferences(defaults, { theme: 'light' }));
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    const seen: string[] = [];
    sync.subscribe((s) => seen.push(s.preferences.theme));
    await sync.start();
    expect(seen).toEqual(['light', 'dark']);
    expect(sync.getState().loaded).toBe(true);
  });

  it('applies updates at once and saves a debounced burst as one patch', async () => {
    const server = fakeServer();
    const cache = memoryCache();
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    await sync.start();
    sync.update({ voices: { en: { speed: 1.25 } } });
    sync.update({ voices: { en: { speed: 1.5 } } });
    expect(sync.getState().preferences.voices.en).toEqual({ speed: 1.5 });
    expect(server.saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(server.saves).toEqual([{ voices: { en: { speed: 1.5 } } }]);
    expect(sync.getState().status).toBe('idle');
  });

  it('retries a failed save with backoff and keeps changes made meanwhile', async () => {
    const server = fakeServer();
    const sync = createPreferencesSync({
      transport: server.transport,
      cache: memoryCache(),
      defaults,
    });
    await sync.start();
    server.failTimes(1);
    sync.update({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(600);
    expect(sync.getState().status).toBe('error');
    sync.update({ translateMode: 'two-way' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.saves).toEqual([{ theme: 'dark', translateMode: 'two-way' }]);
    expect(sync.getState().status).toBe('idle');
  });

  it('defers a remote change while held and lays pending local intent over it', async () => {
    const server = fakeServer();
    const sync = createPreferencesSync({
      transport: server.transport,
      cache: memoryCache(),
      defaults,
    });
    await sync.start();
    sync.hold();
    server.set(mergePreferences(defaults, { voices: { vi: { voice: 'mai' } }, theme: 'dark' }));
    await sync.refresh();
    expect(sync.getState().preferences.voices.vi).toBeUndefined();
    sync.update({ theme: 'light' });
    sync.release();
    expect(sync.getState().preferences.voices.vi).toEqual({ voice: 'mai' });
    expect(sync.getState().preferences.theme).toBe('light');
  });

  it('reset drops pending work and adopts the defaults', async () => {
    const server = fakeServer(mergePreferences(defaults, { theme: 'dark' }));
    const sync = createPreferencesSync({
      transport: server.transport,
      cache: memoryCache(),
      defaults,
    });
    await sync.start();
    sync.update({ theme: 'light' });
    await sync.reset();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.saves).toHaveLength(0);
    expect(sync.getState().preferences.theme).toBe('system');
  });

  it('broadcasts what it saved and adopts what another tab saved without re-saving', async () => {
    const server = fakeServer();
    const broadcast = vi.fn();
    const sync = createPreferencesSync({
      transport: server.transport,
      cache: memoryCache(),
      defaults,
      broadcast,
    });
    await sync.start();
    sync.update({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(600);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
    sync.receive(mergePreferences(defaults, { theme: 'light' }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sync.getState().preferences.theme).toBe('light');
    expect(server.saves).toHaveLength(1);
  });
});
