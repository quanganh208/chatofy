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
  let version = 0;
  let updatedAt: string | null = null;
  const bump = () => {
    version += 1;
    updatedAt = `v${version}`;
  };
  const saves: UserPreferencesPatch[] = [];
  let failNext = 0;
  const transport: PreferencesTransport = {
    load: vi.fn(async (): Promise<PreferencesResponse> => ({
      preferences: stored,
      updatedAt,
    })),
    save: vi.fn(async (patch): Promise<PreferencesResponse> => {
      if (failNext > 0) {
        failNext -= 1;
        throw new Error('offline');
      }
      saves.push(patch);
      stored = mergePreferences(stored, patch);
      bump();
      return { preferences: stored, updatedAt };
    }),
    reset: vi.fn(async (): Promise<PreferencesResponse> => {
      stored = defaults;
      bump();
      return { preferences: stored, updatedAt };
    }),
  };
  return {
    transport,
    saves,
    failTimes: (n: number) => {
      failNext = n;
    },
    /** Another device's write. */
    set: (next: UserPreferences) => {
      stored = next;
      bump();
    },
    get stored() {
      return stored;
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
      const contexts = (pendingValue as { contexts?: Record<string, { patch?: unknown }> } | null)
        ?.contexts;
      return contexts
        ? Object.values(contexts).flatMap((entry) => (entry.patch ? [entry.patch] : []))
        : [];
    },
    /** Every context's sent-but-unanswered patch in the slot, in order. */
    get sentPatches() {
      const contexts = (pendingValue as { contexts?: Record<string, { sent?: unknown }> } | null)
        ?.contexts;
      return contexts
        ? Object.values(contexts).flatMap((entry) => (entry.sent ? [entry.sent] : []))
        : [];
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
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }), 'v1');
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
    const cache = memoryCache(null, { contexts: { old: { patch: { theme: 'dark' }, at: 1 } } });
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    server.failTimes(1);
    await sync.start();
    await vi.advanceTimersByTimeAsync(0);
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
    cache.writePending({
      contexts: { 'other-tab': { patch: { translateMode: 'two-way' }, at: 1 } },
    });
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

  it('a broadcast from another tab outranks a read that was already out', async () => {
    const server = fakeServer();
    const sync = createPreferencesSync({
      transport: server.transport,
      cache: memoryCache(),
      defaults,
    });
    await sync.start();
    let answerRead!: () => void;
    vi.mocked(server.transport.load).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerRead = () => resolve({ preferences: defaults, updatedAt: null });
        }),
    );
    const read = sync.refresh();
    sync.receive(mergePreferences(defaults, { theme: 'dark' }));
    answerRead();
    await read;
    expect(sync.getState().preferences.theme).toBe('dark');
  });

  it('an ack that lands after dispose still removes the entry, so nothing replays it', async () => {
    const server = fakeServer();
    const cache = memoryCache();
    let finishSave!: () => void;
    vi.mocked(server.transport.save).mockImplementationOnce(
      (patch) =>
        new Promise((resolve) => {
          finishSave = () =>
            resolve({ preferences: mergePreferences(defaults, patch), updatedAt: 'v1' });
        }),
    );
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    await sync.start();
    sync.update({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(600);
    expect(cache.sentPatches).toEqual([{ theme: 'dark' }]);
    await sync.dispose();
    finishSave();
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.pending).toBeNull();
  });

  it('does not replay a sent patch over a newer change from another device', async () => {
    const server = fakeServer();
    const cache = memoryCache();
    // A context that sent { gender: male } at v0 (never written) and died unanswered.
    cache.writePending({
      contexts: {
        dead: { sent: { voices: { vi: { gender: 'male' } } }, sentAfter: null, at: 1 },
      },
    });
    // It landed, and another device has written since.
    server.set(mergePreferences(defaults, { voices: { vi: { gender: 'female' } } }));
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    await sync.start();
    await vi.advanceTimersByTimeAsync(600);
    expect(server.saves).toEqual([]);
    expect(sync.getState().preferences.voices.vi?.gender).toBe('female');
    expect(cache.pending).toBeNull();
  });

  it('re-sends a sent patch when the server is unchanged since it was sent', async () => {
    const server = fakeServer();
    const cache = memoryCache();
    cache.writePending({
      contexts: { dead: { sent: { theme: 'dark' }, sentAfter: null, at: 1 } },
    });
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    await sync.start();
    expect(server.saves).toEqual([{ theme: 'dark' }]);
    expect(sync.getState().preferences.theme).toBe('dark');
  });

  it('keeps a sent patch for later when the server cannot be read', async () => {
    const server = fakeServer();
    const cache = memoryCache();
    vi.mocked(server.transport.load).mockRejectedValueOnce(new Error('offline'));
    cache.writePending({
      contexts: { dead: { sent: { theme: 'dark' }, sentAfter: null, at: 1 } },
    });
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    await sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.saves).toEqual([]);
    expect(cache.sentPatches).toEqual([{ theme: 'dark' }]);
  });

  it('adopts orphaned entries oldest first', async () => {
    const server = fakeServer();
    const cache = memoryCache(null, {
      contexts: {
        tab1: { patch: { theme: 'system' }, at: 30 },
        tab2: { patch: { theme: 'light' }, at: 20 },
      },
    });
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    await sync.start();
    expect(server.saves).toEqual([{ theme: 'system' }]);
  });

  it('a change made while a reset is out is saved after it, and kept', async () => {
    const server = fakeServer();
    const sync = createPreferencesSync({
      transport: server.transport,
      cache: memoryCache(),
      defaults,
    });
    await sync.start();
    let finishReset!: () => void;
    vi.mocked(server.transport.reset).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishReset = () => resolve({ preferences: defaults, updatedAt: null });
        }),
    );
    const reset = sync.reset();
    sync.update({ theme: 'dark' });
    const flushed = sync.flush();
    await vi.advanceTimersByTimeAsync(600);
    expect(server.saves).toEqual([]);
    finishReset();
    await reset;
    await flushed;
    await vi.advanceTimersByTimeAsync(600);
    expect(server.saves).toEqual([{ theme: 'dark' }]);
    expect(sync.getState().preferences.theme).toBe('dark');
  });

  it('a reset during a failing save does not bring the discarded change back', async () => {
    const server = fakeServer();
    const sync = createPreferencesSync({
      transport: server.transport,
      cache: memoryCache(),
      defaults,
    });
    await sync.start();
    let failSave!: () => void;
    vi.mocked(server.transport.save).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failSave = () => reject(new Error('offline'));
        }),
    );
    sync.update({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(600);
    const reset = sync.reset();
    failSave();
    await reset;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.saves).toEqual([]);
    expect(server.stored.theme).toBe('system');
    expect(sync.getState().preferences.theme).toBe('system');
  });

  it('start leaves an entry rewritten while its read was out', async () => {
    const server = fakeServer();
    const cache = memoryCache(null, {
      contexts: { worker: { patch: { theme: 'dark' }, at: 1 } },
    });
    let answerRead!: () => void;
    vi.mocked(server.transport.load).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerRead = () => resolve({ preferences: defaults, updatedAt: null });
        }),
    );
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    const started = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    // The worker records a second change in its entry meanwhile.
    cache.writePending({
      contexts: { worker: { patch: { theme: 'dark', translateMode: 'two-way' }, at: 2 } },
    });
    answerRead();
    await started;
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.pendingPatches).toContainEqual({ theme: 'dark', translateMode: 'two-way' });
  });

  it('a change made during start goes with the orphans, so a never-landed one is not lost', async () => {
    const server = fakeServer();
    const cache = memoryCache(null, {
      contexts: { dead: { sent: { theme: 'dark' }, sentAfter: null, at: 1 } },
    });
    let answerRead!: () => void;
    vi.mocked(server.transport.load).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerRead = () => resolve({ preferences: defaults, updatedAt: null });
        }),
    );
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    const started = sync.start();
    sync.update({ translateMode: 'two-way' });
    await vi.advanceTimersByTimeAsync(600);
    expect(server.saves).toEqual([]);
    answerRead();
    await started;
    await vi.advanceTimersByTimeAsync(600);
    expect(server.stored).toMatchObject({ theme: 'dark', translateMode: 'two-way' });
  });

  it("records the version another tab's broadcast carried", async () => {
    const server = fakeServer();
    const cache = memoryCache();
    vi.mocked(server.transport.save).mockImplementationOnce(() => new Promise(() => undefined));
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    await sync.start();
    sync.receive(mergePreferences(defaults, { theme: 'light' }), 'v7');
    sync.update({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(600);
    const entry = Object.values(
      (cache.pending as { contexts: Record<string, { sentAfter?: unknown }> }).contexts,
    )[0];
    expect(entry?.sentAfter).toBe('v7');
  });

  it("keeps another build's entry it cannot read when editing its own", async () => {
    const server = fakeServer();
    const foreign = { patch: { theme: 'sepia' }, at: 1 };
    const cache = memoryCache(null, { contexts: { newer: foreign } });
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    await sync.start();
    server.failTimes(1);
    sync.update({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(600);
    expect((cache.pending as { contexts: Record<string, unknown> }).contexts['newer']).toEqual(
      foreign,
    );
  });

  it('a flush while start is still out persists the change at once', async () => {
    const server = fakeServer();
    const cache = memoryCache();
    vi.mocked(server.transport.load).mockImplementationOnce(() => new Promise(() => undefined));
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    void sync.start();
    await vi.advanceTimersByTimeAsync(0);
    sync.update({ theme: 'dark' });
    void sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.pendingPatches).toEqual([{ theme: 'dark' }]);
    expect(cache.value).toMatchObject({ theme: 'dark' });
  });

  it('a reset pressed during start discards the orphans, sent or unsent', async () => {
    const server = fakeServer();
    const cache = memoryCache(null, {
      contexts: {
        a: { sent: { theme: 'dark' }, sentAfter: null, at: 1 },
        b: { patch: { translateMode: 'two-way' }, at: 2 },
      },
    });
    let answerRead!: () => void;
    vi.mocked(server.transport.load).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerRead = () => resolve({ preferences: defaults, updatedAt: null });
        }),
    );
    const sync = createPreferencesSync({ transport: server.transport, cache, defaults });
    const started = sync.start();
    await vi.advanceTimersByTimeAsync(0);
    const reset = sync.reset();
    answerRead();
    await reset;
    await started;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.saves).toEqual([]);
    expect(server.stored).toEqual(defaults);
    expect(cache.pending).toBeNull();
  });
});
