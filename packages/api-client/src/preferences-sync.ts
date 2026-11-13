import {
  combinePreferencePatches,
  userPreferencesPatchSchema,
  mergePreferences,
  parseUserPreferences,
  type PreferencesResponse,
  type UserPreferences,
  type UserPreferencesPatch,
} from '@chatofy/types';

/**
 * The client side of account preferences, shared by web, mobile and the
 * extension. Transport- and storage-agnostic: each client hands in how to reach
 * the API and where to keep its cache, and gets back one store.
 *
 * ## Optimistic, then durable
 *
 * `update` applies the patch to the snapshot and the cache at once and only
 * then schedules the save, so a toggle never waits on the network. Patches made
 * while a save is in flight, failing, or offline are combined into one and sent
 * together; on failure the save is retried with backoff and again whenever the
 * client says it is back (`flush`).
 *
 * ## Remote changes never land mid-session
 *
 * `refresh` reads the server copy, re-applies any patch still pending on top of
 * it (local intent is newer than whatever the server held), and publishes the
 * result — unless the store is `hold`ing, which a client does while a
 * conversation or call is running. A held refresh is kept and applied on
 * `release`, so a voice changed on the phone takes effect at the next start
 * rather than halfway through a sentence.
 *
 * ## Cache
 *
 * The cache is what makes first paint right on a returning visit (no theme
 * flash) and what the store serves offline. It is read through
 * `parseUserPreferences`, so a cache written by another build costs at most the
 * fields it disagrees on.
 */
export type PreferencesSyncStatus = 'idle' | 'saving' | 'error';

export interface PreferencesSyncState {
  preferences: UserPreferences;
  status: PreferencesSyncStatus;
  /** True once a server copy has been read in this session. */
  loaded: boolean;
}

export interface PreferencesCache {
  read(): unknown | Promise<unknown>;
  write(preferences: UserPreferences): void | Promise<void>;
  clear(): void | Promise<void>;
  /**
   * Where changes the server has not acknowledged yet are kept, so they outlive
   * the tab, popup, service worker or app process that made them.
   *
   * Without it a change made offline survives only in the cached document, and
   * the next start's server read replaces that document — the change is lost
   * without a word. With it, `start` re-applies the saved patch over the server
   * copy and sends it. `null` means nothing is pending. Optional so a cache that
   * cannot persist still works; it just loses an unsent change on close.
   */
  readPending?(): unknown | Promise<unknown>;
  writePending?(patch: UserPreferencesPatch | null): void | Promise<void>;
}

export interface PreferencesTransport {
  load(): Promise<PreferencesResponse>;
  save(patch: UserPreferencesPatch): Promise<PreferencesResponse>;
  reset(): Promise<PreferencesResponse>;
}

export interface PreferencesSyncConfig {
  transport: PreferencesTransport;
  cache: PreferencesCache;
  /** What an empty cache and an unreachable server both mean. */
  defaults: UserPreferences;
  /** Quiet time before a burst of changes (a dragged slider) is saved. */
  debounceMs?: number;
  /** Backoff ceiling between failed saves. */
  maxRetryMs?: number;
  /**
   * A change made by ANOTHER store instance in this same client (another tab).
   * Called with the full document so the receiving side can adopt it without a
   * fetch; wire it to a BroadcastChannel or equivalent.
   */
  broadcast?: (preferences: UserPreferences) => void;
}

export interface PreferencesSync {
  getState(): PreferencesSyncState;
  subscribe(listener: (state: PreferencesSyncState) => void): () => void;
  /** Read the cache, then the server. Safe to call more than once. */
  start(): Promise<void>;
  update(patch: UserPreferencesPatch): void;
  /** Re-read the server copy (on focus, on app foreground). */
  refresh(): Promise<void>;
  /** Send anything pending now (on reconnect, before unload). */
  flush(): Promise<void>;
  /** Drop the account's document back to the defaults, everywhere. */
  reset(): Promise<void>;
  /** Defer remote changes while a session runs; local `update`s still apply. */
  hold(): void;
  release(): void;
  /** Adopt a document another tab already saved. Never re-saved from here. */
  receive(preferences: UserPreferences): void;
  /** Sign-out: forget the cache and stop retrying. */
  dispose(clearCache?: boolean): Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 600;
const DEFAULT_MAX_RETRY_MS = 30_000;
const FIRST_RETRY_MS = 1_000;

export function createPreferencesSync(config: PreferencesSyncConfig): PreferencesSync {
  const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxRetryMs = config.maxRetryMs ?? DEFAULT_MAX_RETRY_MS;

  let state: PreferencesSyncState = {
    preferences: config.defaults,
    status: 'idle',
    loaded: false,
  };
  const listeners = new Set<(state: PreferencesSyncState) => void>();

  let pending: UserPreferencesPatch | null = null;
  /** The patch being sent right now, until the server answers. */
  let sending: UserPreferencesPatch | null = null;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryMs = FIRST_RETRY_MS;
  let holds = 0;
  let heldRemote: UserPreferences | null = null;
  let disposed = false;
  /** Set by a sign-out dispose: nothing may be written to this cache again. */
  let forgotten = false;
  let started: Promise<void> | null = null;

  const publish = (next: Partial<PreferencesSyncState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  };

  const writeCache = (preferences: UserPreferences) => {
    void Promise.resolve()
      .then(() => (forgotten ? undefined : config.cache.write(preferences)))
      .catch(() => {
        // A full or blocked store must never break the page; the server copy stands.
      });
  };

  /** Persist everything not yet acknowledged: what is in flight, then what queued after it. */
  const persistUnsaved = () => {
    if (!config.cache.writePending) return;
    const unsaved =
      sending && pending ? combinePreferencePatches(sending, pending) : (sending ?? pending);
    void Promise.resolve()
      // A sign-out that cleared the cache meanwhile must not have it rewritten.
      .then(() => (forgotten ? undefined : config.cache.writePending?.(unsaved)))
      .catch(() => {
        // Same as the document cache: storage trouble never breaks the page.
      });
  };

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delay: number) => {
    clearTimer();
    if (disposed) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay);
  };

  /** Server copy, with whatever this client has not saved yet laid over it. */
  const withPending = (server: UserPreferences) =>
    pending ? mergePreferences(server, pending) : server;

  const adoptRemote = (server: UserPreferences) => {
    const next = withPending(server);
    if (holds > 0) {
      heldRemote = next;
      return;
    }
    publish({ preferences: next, loaded: true });
    writeCache(next);
  };

  async function flush(): Promise<void> {
    clearTimer();
    if (disposed) return;
    if (inFlight) {
      await inFlight;
      if (pending) return flush();
      return;
    }
    if (!pending) return;

    const outgoing = pending;
    sending = outgoing;
    pending = null;
    publish({ status: 'saving' });

    inFlight = (async () => {
      try {
        const response = await config.transport.save(outgoing);
        sending = null;
        persistUnsaved();
        retryMs = FIRST_RETRY_MS;
        const saved = parseUserPreferences(response.preferences, config.defaults);
        // The server's answer is authoritative for what it stored; anything
        // queued during the request is newer and stays on top.
        const next = withPending(saved);
        if (holds > 0) heldRemote = next;
        else publish({ preferences: next, loaded: true });
        writeCache(next);
        config.broadcast?.(next);
        publish({ status: pending ? 'saving' : 'idle' });
        if (pending) schedule(debounceMs);
      } catch {
        // Put the failed patch back UNDER anything queued since.
        sending = null;
        pending = pending ? combinePreferencePatches(outgoing, pending) : outgoing;
        persistUnsaved();
        publish({ status: 'error' });
        schedule(retryMs);
        retryMs = Math.min(retryMs * 2, maxRetryMs);
      }
    })();

    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    try {
      const response = await config.transport.load();
      adoptRemote(parseUserPreferences(response.preferences, config.defaults));
    } catch {
      // Offline or signed out: keep serving the cache.
    }
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      if (started) return started;
      started = (async () => {
        try {
          const cached = await config.cache.read();
          if (cached !== null && cached !== undefined && !state.loaded) {
            publish({ preferences: withPending(parseUserPreferences(cached, config.defaults)) });
          }
        } catch {
          // An unreadable cache is a first visit.
        }
        try {
          const saved = userPreferencesPatchSchema.safeParse(await config.cache.readPending?.());
          if (saved.success && Object.keys(saved.data).length > 0) {
            // Older than anything made in this instance, so it goes underneath.
            pending = pending ? combinePreferencePatches(saved.data, pending) : saved.data;
            publish({ preferences: mergePreferences(state.preferences, pending) });
          }
        } catch {
          // Nothing recoverable; carry on with what the server holds.
        }
        await refresh();
        if (pending) await flush();
      })();
      return started;
    },

    update(patch) {
      if (disposed) return;
      pending = pending ? combinePreferencePatches(pending, patch) : patch;
      persistUnsaved();
      const next = mergePreferences(state.preferences, patch);
      publish({ preferences: next });
      writeCache(next);
      // A failing save keeps its backoff; a fresh change does not reset it.
      if (state.status !== 'error') schedule(debounceMs);
    },

    refresh,

    flush,

    async reset() {
      clearTimer();
      pending = null;
      if (inFlight) await inFlight.catch(() => undefined);
      clearTimer();
      pending = null;
      sending = null;
      persistUnsaved();
      publish({ status: 'saving' });
      try {
        const response = await config.transport.reset();
        const next = parseUserPreferences(response.preferences, config.defaults);
        retryMs = FIRST_RETRY_MS;
        heldRemote = null;
        publish({ preferences: next, status: 'idle', loaded: true });
        writeCache(next);
        config.broadcast?.(next);
      } catch (error) {
        // Nothing is queued to retry — a reset is the reader's explicit act and
        // its failure is reported to them by the caller, inline. The store
        // itself has nothing unsaved, so it goes back to idle rather than
        // claiming a retry that will never happen.
        publish({ status: 'idle' });
        throw error;
      }
    },

    hold() {
      holds += 1;
    },

    release() {
      holds = Math.max(0, holds - 1);
      if (holds === 0 && heldRemote) {
        const next = withPending(heldRemote);
        heldRemote = null;
        publish({ preferences: next, loaded: true });
        writeCache(next);
      }
    },

    receive(preferences) {
      adoptRemote(parseUserPreferences(preferences, config.defaults));
    },

    async dispose(clearCache = false) {
      disposed = true;
      clearTimer();
      pending = null;
      listeners.clear();
      if (clearCache) {
        forgotten = true;
        try {
          await config.cache.writePending?.(null);
          await config.cache.clear();
        } catch {
          // Nothing to undo.
        }
      }
    },
  };
}
