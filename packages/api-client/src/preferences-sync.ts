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
 * ## A read never undoes a save
 *
 * A GET can be answered after a PATCH that was sent later — the server read the
 * row before the write committed. Every acknowledged save (and reset) bumps an
 * epoch, and a load that started in an older epoch is dropped: what it carries
 * is already superseded by the save's own answer. What is in flight is laid
 * over any server copy just like what is queued, so the reader's change never
 * blinks back for a round trip.
 *
 * ## Refused is not failed
 *
 * A network error, a 5xx, a 429 or an expired session is retried with backoff.
 * A refusal — any other 4xx — is final: the same patch would be refused forever,
 * and since later changes are combined into it, nothing else would ever save from
 * this device. The refused patch is dropped, the server copy is re-read so the
 * screen shows what is actually stored, and the status says `refused` until the
 * next change.
 *
 * ## Cache
 *
 * The cache is what makes first paint right on a returning visit (no theme
 * flash) and what the store serves offline. It is read through
 * `parseUserPreferences`, so a cache written by another build costs at most the
 * fields it disagrees on. Writes to it are coalesced to the save debounce (and
 * done at once on `flush`), because on web it is synchronous `localStorage` on the
 * main thread and a dragged slider must not serialize the document every frame.
 */
export type PreferencesSyncStatus = 'idle' | 'saving' | 'error' | 'refused';

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
  /**
   * Opaque to the adapter: store it as given, hand it back as stored. The store
   * keeps one entry per context (tab, popup, worker) in it, so contexts sharing
   * one slot never overwrite or clear each other's unsent change.
   */
  writePending?(value: PendingSlot | null): void | Promise<void>;
}

/** What the pending slot holds: each context's unacknowledged patch. */
export interface PendingSlot {
  contexts: Record<string, UserPreferencesPatch>;
}

/**
 * Read a slot without trusting it. A bare patch (a slot written before slots had
 * contexts) is accepted as one orphaned entry; anything invalid is dropped.
 */
function readSlot(raw: unknown): Record<string, UserPreferencesPatch> {
  const out: Record<string, UserPreferencesPatch> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  const contexts = (raw as { contexts?: unknown }).contexts;
  if (typeof contexts === 'object' && contexts !== null) {
    for (const [id, value] of Object.entries(contexts)) {
      const parsed = userPreferencesPatchSchema.safeParse(value);
      if (parsed.success && Object.keys(parsed.data).length > 0) out[id] = parsed.data;
    }
    return out;
  }
  const bare = userPreferencesPatchSchema.safeParse(raw);
  if (bare.success && Object.keys(bare.data).length > 0) out['orphan'] = bare.data;
  return out;
}

const newContextId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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
   * Whether a failed save was REFUSED (final) rather than failed (retryable).
   * Defaults to {@link isRefusedByServer}: a numeric `status` on the error in
   * 400–499 other than 401, 408 and 429.
   */
  isRefused?: (error: unknown) => boolean;
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

/**
 * The default refusal test. Reads `status` off the error, which is where
 * `ApiClientError` keeps it and where a hand-written transport should put it.
 * 401 is retryable on purpose: the session may renew, and a sign-out disposes
 * the store anyway. 408 and 429 are "not now", not "never".
 */
export function isRefusedByServer(error: unknown): boolean {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status: unknown }).status
      : undefined;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 429
  );
}

const DEFAULT_DEBOUNCE_MS = 600;
const DEFAULT_MAX_RETRY_MS = 30_000;
const FIRST_RETRY_MS = 1_000;

export function createPreferencesSync(config: PreferencesSyncConfig): PreferencesSync {
  const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxRetryMs = config.maxRetryMs ?? DEFAULT_MAX_RETRY_MS;
  const isRefused = config.isRefused ?? isRefusedByServer;

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
  /** Bumped by every acknowledged save and reset; a load from an older epoch is stale. */
  let epoch = 0;
  /** This store's entry in the shared pending slot. */
  const contextId = newContextId();
  /** What this store last wrote to its entry, so an unchanged entry is not rewritten. */
  let lastPersistedPending: string | null = null;
  /** Slot read-modify-writes run one at a time, in order. */
  let slotChain: Promise<unknown> = Promise.resolve();
  let cacheTimer: ReturnType<typeof setTimeout> | null = null;

  const publish = (next: Partial<PreferencesSyncState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  };

  const unsavedPatch = (): UserPreferencesPatch | null =>
    sending && pending ? combinePreferencePatches(sending, pending) : (sending ?? pending);

  const guarded = (write: () => unknown) => {
    void Promise.resolve()
      // A sign-out that cleared the cache meanwhile must not have it rewritten.
      .then(() => (forgotten ? undefined : write()))
      .catch(() => {
        // A full or blocked store must never break the page; the server copy stands.
      });
  };

  /** Read-modify-write the shared slot, serialized, never after a sign-out. */
  const editSlot = (edit: (entries: Record<string, UserPreferencesPatch>) => void) => {
    const cache = config.cache;
    if (!cache.writePending || !cache.readPending) return;
    slotChain = slotChain
      .then(async () => {
        if (forgotten) return;
        const entries = readSlot(await cache.readPending?.());
        edit(entries);
        if (forgotten) return;
        await cache.writePending?.(Object.keys(entries).length > 0 ? { contexts: entries } : null);
      })
      .catch(() => {
        // Storage trouble never breaks the page.
      });
  };

  /**
   * Persist everything not yet acknowledged — what is in flight, then what queued
   * after it — in THIS store's entry, or remove the entry when nothing is.
   */
  const persistUnsavedNow = () => {
    const unsaved = unsavedPatch();
    const json = unsaved ? JSON.stringify(unsaved) : null;
    if (json === lastPersistedPending) return;
    lastPersistedPending = json;
    editSlot((entries) => {
      if (unsaved) entries[contextId] = unsaved;
      else delete entries[contextId];
    });
  };

  const writeCacheNow = () => {
    if (cacheTimer !== null) clearTimeout(cacheTimer);
    cacheTimer = null;
    const preferences = state.preferences;
    guarded(() => config.cache.write(preferences));
    persistUnsavedNow();
  };

  /** Coalesce cache writes from a burst of local changes to one per debounce window. */
  const writeCacheSoon = () => {
    if (cacheTimer !== null || disposed) return;
    cacheTimer = setTimeout(writeCacheNow, debounceMs);
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

  /** Server copy, with whatever this client has not had acknowledged laid over it. */
  const withPending = (server: UserPreferences) => {
    const unsaved = unsavedPatch();
    return unsaved ? mergePreferences(server, unsaved) : server;
  };

  const adoptRemote = (server: UserPreferences) => {
    const next = withPending(server);
    if (holds > 0) {
      heldRemote = next;
      return;
    }
    publish({ preferences: next, loaded: true });
    writeCacheNow();
  };

  async function flush(): Promise<void> {
    clearTimer();
    if (disposed) return;
    if (cacheTimer !== null) writeCacheNow();
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
      let response: PreferencesResponse;
      try {
        response = await config.transport.save(outgoing);
      } catch (error) {
        sending = null;
        if (disposed) return;
        if (isRefused(error)) {
          // Final: drop it, keep anything queued since, show what is stored.
          retryMs = FIRST_RETRY_MS;
          persistUnsavedNow();
          publish({ status: 'refused' });
          await refresh();
          if (pending) schedule(debounceMs);
          return;
        }
        // Put the failed patch back UNDER anything queued since.
        pending = pending ? combinePreferencePatches(outgoing, pending) : outgoing;
        persistUnsavedNow();
        publish({ status: 'error' });
        schedule(retryMs);
        retryMs = Math.min(retryMs * 2, maxRetryMs);
        return;
      }
      sending = null;
      if (disposed) return;
      epoch += 1;
      retryMs = FIRST_RETRY_MS;
      const saved = parseUserPreferences(response.preferences, config.defaults);
      // The server's answer is authoritative for what it stored; anything
      // queued during the request is newer and stays on top.
      const next = withPending(saved);
      if (holds > 0) heldRemote = next;
      else publish({ preferences: next, loaded: true });
      writeCacheNow();
      config.broadcast?.(next);
      publish({ status: pending ? 'saving' : 'idle' });
      if (pending) schedule(debounceMs);
    })();

    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    const startedIn = epoch;
    let response: PreferencesResponse;
    try {
      response = await config.transport.load();
    } catch {
      // Offline or signed out: keep serving the cache.
      return;
    }
    // Disposed meanwhile, or a save was acknowledged while this read was out:
    // the read may predate that write, and the save's answer already stands.
    if (disposed || epoch !== startedIn) return;
    adoptRemote(parseUserPreferences(response.preferences, config.defaults));
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
        // Take over every entry left in the slot — a tab, popup or worker that
        // closed before its change was acknowledged — and send them as ours. A
        // context still alive rewrites its own entry on its next change or
        // failure, so nothing is lost by taking it; at worst it is sent twice.
        try {
          const entries = readSlot(await config.cache.readPending?.());
          const orphans = Object.values(entries).reduce<UserPreferencesPatch | null>(
            (all, patch) => (all ? combinePreferencePatches(all, patch) : patch),
            null,
          );
          if (orphans) {
            // Older than anything made in this instance, so it goes underneath.
            pending = pending ? combinePreferencePatches(orphans, pending) : orphans;
            publish({ preferences: mergePreferences(state.preferences, pending) });
            const taken = Object.keys(entries);
            lastPersistedPending = JSON.stringify(pending);
            const mine = pending;
            editSlot((slot) => {
              for (const id of taken) delete slot[id];
              slot[contextId] = mine;
            });
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
      const next = mergePreferences(state.preferences, patch);
      publish({ preferences: next, ...(state.status === 'refused' ? { status: 'idle' } : {}) });
      writeCacheSoon();
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
      persistUnsavedNow();
      publish({ status: 'saving' });
      try {
        const response = await config.transport.reset();
        if (disposed) return;
        epoch += 1;
        retryMs = FIRST_RETRY_MS;
        heldRemote = null;
        // A change made while the reset was out is newer than the reset.
        const next = withPending(parseUserPreferences(response.preferences, config.defaults));
        publish({ preferences: next, status: pending ? 'saving' : 'idle', loaded: true });
        writeCacheNow();
        config.broadcast?.(next);
        if (pending) schedule(debounceMs);
      } catch (error) {
        if (disposed) return;
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
        writeCacheNow();
      }
    },

    receive(preferences) {
      adoptRemote(parseUserPreferences(preferences, config.defaults));
    },

    async dispose(clearCache = false) {
      // Whatever is unsaved goes to the pending slot first (unless this is a
      // sign-out), so a context that closes mid-debounce loses nothing.
      if (!clearCache && !disposed && (cacheTimer !== null || pending)) writeCacheNow();
      if (cacheTimer !== null) clearTimeout(cacheTimer);
      cacheTimer = null;
      disposed = true;
      clearTimer();
      pending = null;
      listeners.clear();
      if (clearCache) {
        forgotten = true;
        try {
          await slotChain;
          await config.cache.writePending?.(null);
          await config.cache.clear();
        } catch {
          // Nothing to undo.
        }
      }
    },
  };
}
