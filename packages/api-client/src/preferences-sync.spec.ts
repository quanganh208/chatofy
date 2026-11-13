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

function memoryCache(initial: unknown = null, initialPending: unknown = null) {
  let value = initial;
  let pendingValue = initialPending;
  return {
    readPending: () => pendingValue,
    writePending: (value: unknown) => {
      pendingValue = value;
    },
    get pending() {
      return pendingValue;
    },
    /** Every context's unsent patch in the slot, in order. */
    get pendingPatches() {
      const contexts = (pendingValue as { contexts?: Record<string, unknown> } | null)?.contexts;
      return contexts ? Object.values(contexts) : [];
    },
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

  it('keeps an unsent change across a closed instance and sends it at the next start', async () => {
    const server = fakeServer();
    const cache = memoryCache();
    const first = createPreferencesSync({ transport: server.transport, cache, defaults });
    await first.start();
    server.failTimes(1);
    first.update({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(600);
    expect(cache.pendingPatches).toEqual([{ theme: 'dark' }]);
    await first.dispose();

    const second = createPreferencesSync({ transport: server.transport, cache, defaults });
    await second.start();
    expect(second.getState().preferences.theme).toBe('dark');
    expect(server.saves).toEqual([{ theme: 'dark' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.pending).toBeNull();
  });

  it('clears the persisted patch on reset and on a sign-out dispose', async () => {
    const server = fakeServer();
    const cache = memoryCache(null, { theme: 'dark' });
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    server.failTimes(1);
    await sync.start();
    expect(cache.pendingPatches).toEqual([{ theme: 'dark' }]);
    await sync.reset();
    expect(cache.pending).toBeNull();
    sync.update({ theme: 'light' });
    await sync.dispose(true);
    expect(cache.pending).toBeNull();
  });

  it('a failed reset rejects to its caller and leaves no phantom retry state', async () => {
    const server = fakeServer();
    const sync = createPreferencesSync({
      transport: server.transport,
      cache: memoryCache(),
      defaults,
    });
    await sync.start();
    vi.mocked(server.transport.reset).mockRejectedValueOnce(new Error('offline'));
    await expect(sync.reset()).rejects.toThrow('offline');
    expect(sync.getState().status).toBe('idle');
  });

  it('drops a load that was answered after a later save was acknowledged', async () => {
    const server = fakeServer();
    const sync = createPreferencesSync({
      transport: server.transport,
      cache: memoryCache(),
      defaults,
    });
    await sync.start();
    // A GET that reads the row BEFORE the PATCH commits, and answers after it.
    let answerStaleLoad!: () => void;
    vi.mocked(server.transport.load).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          const stale = { preferences: defaults, updatedAt: null };
          answerStaleLoad = () => resolve(stale);
        }),
    );
    sync.update({ theme: 'dark' });
    const loading = sync.refresh();
    await vi.advanceTimersByTimeAsync(600);
    expect(sync.getState().preferences.theme).toBe('dark');
    answerStaleLoad();
    await loading;
    expect(sync.getState().preferences.theme).toBe('dark');
  });

  it('keeps an in-flight change on screen while a load answers mid-save', async () => {
    const server = fakeServer();
    const sync = createPreferencesSync({
      transport: server.transport,
      cache: memoryCache(),
      defaults,
    });
    await sync.start();
    let finishSave!: () => void;
    vi.mocked(server.transport.save).mockImplementationOnce(
      (patch) =>
        new Promise((resolve) => {
          finishSave = () =>
            resolve({ preferences: mergePreferences(defaults, patch), updatedAt: 'now' });
        }),
    );
    sync.update({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(600);
    await sync.refresh();
    expect(sync.getState().preferences.theme).toBe('dark');
    finishSave();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('drops a refused patch instead of retrying it forever, and later changes still save', async () => {
    const server = fakeServer();
    const cache = memoryCache();
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    await sync.start();
    vi.mocked(server.transport.save).mockRejectedValueOnce(
      Object.assign(new Error('refused'), { status: 400 }),
    );
    sync.update({ reading: { big: 'x' } });
    await vi.advanceTimersByTimeAsync(600);
    expect(sync.getState().status).toBe('refused');
    expect(sync.getState().preferences.reading).toEqual({});
    expect(cache.pending).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.mocked(server.transport.save)).toHaveBeenCalledTimes(1);
    sync.update({ theme: 'dark' });
    expect(sync.getState().status).toBe('idle');
    await vi.advanceTimersByTimeAsync(600);
    expect(server.saves).toEqual([{ theme: 'dark' }]);
  });

  it('retries a 401, a 429 and a 5xx rather than treating them as refusals', async () => {
    for (const status of [401, 429, 503]) {
      const server = fakeServer();
      const sync = createPreferencesSync({
        transport: server.transport,
        cache: memoryCache(),
        defaults,
      });
      await sync.start();
      vi.mocked(server.transport.save).mockRejectedValueOnce(
        Object.assign(new Error('x'), { status }),
      );
      sync.update({ theme: 'dark' });
      await vi.advanceTimersByTimeAsync(600);
      expect(sync.getState().status).toBe('error');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(server.saves).toEqual([{ theme: 'dark' }]);
    }
  });

  it('coalesces cache writes from a burst of changes', async () => {
    const server = fakeServer();
    const cache = memoryCache();
    const write = vi.spyOn(cache, 'write');
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    await sync.start();
    write.mockClear();
    for (let i = 0; i < 20; i += 1) sync.update({ call: { originalVolume: i / 20 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(write.mock.calls.length).toBeLessThanOrEqual(2);
    expect(cache.value).toMatchObject({ call: { originalVolume: 19 / 20 } });
  });

  it("never clears another context's unsent change from the shared slot", async () => {
    const server = fakeServer();
    const cache = memoryCache();
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    await sync.start();
    sync.update({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(0);
    // Another tab, offline, keeps its own unsent change in the same slot.
    cache.writePending({ contexts: { 'other-tab': { translateMode: 'two-way' } } });
    await vi.advanceTimersByTimeAsync(600);
    expect(server.saves).toEqual([{ theme: 'dark' }]);
    expect(cache.pendingPatches).toEqual([{ translateMode: 'two-way' }]);
  });

  it('does nothing after dispose when a save answers late', async () => {
    const server = fakeServer();
    const broadcast = vi.fn();
    const cache = memoryCache();
    let finishSave!: () => void;
    vi.mocked(server.transport.save).mockImplementationOnce(
      (patch) =>
        new Promise((resolve) => {
          finishSave = () =>
            resolve({ preferences: mergePreferences(defaults, patch), updatedAt: 'now' });
        }),
    );
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults, broadcast });
    await sync.start();
    sync.update({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(600);
    await sync.dispose(true);
    finishSave();
    await vi.advanceTimersByTimeAsync(0);
    expect(broadcast).not.toHaveBeenCalled();
    expect(cache.value).toBeNull();
  });
});
