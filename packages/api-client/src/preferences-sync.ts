import {
  combinePreferencePatches,
  userPreferencesPatchSchema,
  mergePreferences,
  parseUserPreferences,
  type PreferencesReadResponse,
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

/**
 * One context's unacknowledged changes.
 *
 * `patch` was never sent. `sent` was handed to the transport and its answer
 * never came back to this context — it may or may not have landed. The two are
 * kept apart because they are adopted differently by a later start: an unsent
 * patch is always sent, while a sent one is re-sent only if the server has not
 * been written since (`sentAfter` equals the server's `updatedAt`), because
 * re-sending one that DID land would overwrite whatever another device changed
 * afterwards.
 */
export interface PendingEntry {
  patch?: UserPreferencesPatch;
  sent?: UserPreferencesPatch;
  /** The server's `updatedAt` this context last knew when it sent `sent`; absent if unknown. */
  sentAfter?: string | null;
  /** When the entry was last written, so orphans are adopted oldest first. */
  at: number;
}

/** What the pending slot holds: each context's entry. */
export interface PendingSlot {
  contexts: Record<string, PendingEntry>;
}

const nonEmptyPatch = (value: unknown): UserPreferencesPatch | undefined => {
  const parsed = userPreferencesPatchSchema.safeParse(value);
  return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : undefined;
};

/** The slot's entries as stored, unvalidated. */
function rawContexts(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) return {};
  const contexts = (raw as { contexts?: unknown }).contexts;
  return typeof contexts === 'object' && contexts !== null && !Array.isArray(contexts)
    ? (contexts as Record<string, unknown>)
    : {};
}

/** Read a slot without trusting it; an invalid entry or field is dropped. */
function readSlot(raw: unknown): Record<string, PendingEntry> {
  const out: Record<string, PendingEntry> = {};
  for (const [id, value] of Object.entries(rawContexts(raw))) {
    if (typeof value !== 'object' || value === null) continue;
    const record = value as Record<string, unknown>;
    const patch = nonEmptyPatch(record['patch']);
    const sent = nonEmptyPatch(record['sent']);
    if (!patch && !sent) continue;
    const sentAfter = record['sentAfter'];
    out[id] = {
      ...(patch ? { patch } : {}),
      ...(sent ? { sent } : {}),
      ...(sent && (typeof sentAfter === 'string' || sentAfter === null) ? { sentAfter } : {}),
      at: typeof record['at'] === 'number' ? record['at'] : 0,
    };
  }
  return out;
}

const combineAll = (patches: (UserPreferencesPatch | undefined)[]) =>
  patches.reduce<UserPreferencesPatch | null>(
    (all, patch) => (!patch ? all : all ? combinePreferencePatches(all, patch) : patch),
    null,
  );

const newContextId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export interface PreferencesTransport {
  load(): Promise<PreferencesReadResponse>;
  save(patch: UserPreferencesPatch): Promise<PreferencesReadResponse>;
  reset(): Promise<PreferencesReadResponse>;
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
  broadcast?: (preferences: UserPreferences, updatedAt: string | null) => void;
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
  /**
   * Adopt a document another tab already saved. Never re-saved from here.
   * `updatedAt` is the server version that save produced; without it this
   * store's next save is sent against an unknown version, and should its
   * context die unanswered, a later start drops it rather than risk a replay.
   */
  receive(preferences: UserPreferences, updatedAt?: string | null): void;
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
  /** Bumped by every acknowledged save, reset and received broadcast; a load from an older epoch is stale. */
  let epoch = 0;
  /** The server's `updatedAt` as last read; `undefined` while unknown. */
  let serverUpdatedAt: string | null | undefined;
  /** What `serverUpdatedAt` was when the in-flight patch was sent. */
  let sentAfter: string | null | undefined;
  /** The last server copy adopted, to fall back to when a change is refused. */
  let lastServer: UserPreferences | null = null;
  /** A reset in progress; a save waits for it so it lands after the DELETE. */
  let resetting: Promise<unknown> | null = null;
  /** Bumped by every reset: a save sent before it is not put back if it fails. */
  let resetGen = 0;
  /** `start` in progress; saves wait for it, so its orphans and new changes go as one. */
  let starting: Promise<void> | null = null;
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

  /**
   * Read-modify-write the shared slot, serialized, never after a sign-out.
   *
   * On the RAW entries: an entry this build cannot parse (a newer build's tab,
   * holding a value this one has never heard of) is carried through untouched,
   * not erased because this store happened to edit its own.
   */
  const editSlot = (edit: (entries: Record<string, unknown>) => void) => {
    const cache = config.cache;
    if (!cache.writePending || !cache.readPending) return;
    slotChain = slotChain
      .then(async () => {
        if (forgotten) return;
        const entries = { ...rawContexts(await cache.readPending?.()) };
        edit(entries);
        if (forgotten) return;
        await cache.writePending?.(
          Object.keys(entries).length > 0 ? ({ contexts: entries } as PendingSlot) : null,
        );
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
    const entry: Omit<PendingEntry, 'at'> | null =
      pending || sending
        ? {
            ...(pending ? { patch: pending } : {}),
            ...(sending ? { sent: sending } : {}),
            ...(sending && sentAfter !== undefined ? { sentAfter } : {}),
          }
        : null;
    const json = entry ? JSON.stringify(entry) : null;
    if (json === lastPersistedPending) return;
    lastPersistedPending = json;
    editSlot((entries) => {
      if (entry) entries[contextId] = { ...entry, at: Date.now() };
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
    lastServer = server;
    const next = withPending(server);
    if (holds > 0) {
      heldRemote = next;
      return;
    }
    publish({ preferences: next, loaded: true });
    writeCacheNow();
  };

  /**
   * Saves wait for `start`: it decides which orphaned entries still need
   * sending by comparing the server version it reads, and a save of this
   * store's own acknowledged meanwhile would move that version and make an
   * orphan that never landed look landed.
   */
  async function flush(): Promise<void> {
    // Persisted before any wait: a flush on pagehide or app background must
    // leave the change in the cache and slot even if start is still running.
    if (cacheTimer !== null && !disposed) writeCacheNow();
    if (starting) await starting.catch(() => undefined);
    return flushNow();
  }

  async function flushNow(): Promise<void> {
    clearTimer();
    if (disposed) return;
    if (cacheTimer !== null) writeCacheNow();
    if (inFlight) {
      await inFlight;
      if (pending) return flushNow();
      return;
    }
    if (resetting) {
      await resetting.catch(() => undefined);
      if (disposed) return;
    }
    if (!pending) return;

    const outgoing = pending;
    const sentInGen = resetGen;
    sending = outgoing;
    sentAfter = serverUpdatedAt;
    pending = null;
    // Marks the entry "sent": if this context dies before the answer, a later
    // start knows not to blindly re-send it.
    persistUnsavedNow();
    publish({ status: 'saving' });

    inFlight = (async () => {
      let response: PreferencesReadResponse;
      try {
        response = await config.transport.save(outgoing);
      } catch (error) {
        sending = null;
        if (isRefused(error)) {
          // Final: drop it, keep anything queued since, show what is stored.
          persistUnsavedNow();
          if (disposed) return;
          retryMs = FIRST_RETRY_MS;
          if (lastServer && holds === 0) publish({ preferences: withPending(lastServer) });
          publish({ status: 'refused' });
          await refresh();
          if (pending) schedule(debounceMs);
          return;
        }
        // A reset was pressed while this was out: it discards what came before
        // it, this included. Only what was changed since stays.
        if (sentInGen !== resetGen) {
          persistUnsavedNow();
          return;
        }
        // Put the failed patch back UNDER anything queued since, as unsent:
        // a failure that produced no answer is retried, by this store or the
        // next one to start.
        pending = pending ? combinePreferencePatches(outgoing, pending) : outgoing;
        persistUnsavedNow();
        if (disposed) return;
        publish({ status: 'error' });
        schedule(retryMs);
        retryMs = Math.min(retryMs * 2, maxRetryMs);
        return;
      }
      sending = null;
      // Even disposed (closed tab, switched account), the entry must shrink to
      // what is still unsent, or a later start would replay this landed patch.
      persistUnsavedNow();
      if (disposed) return;
      epoch += 1;
      serverUpdatedAt = response.updatedAt;
      retryMs = FIRST_RETRY_MS;
      const saved = parseUserPreferences(response.preferences, config.defaults);
      lastServer = saved;
      // The server's answer is authoritative for what it stored; anything
      // queued during the request is newer and stays on top.
      const next = withPending(saved);
      if (holds > 0) heldRemote = next;
      else publish({ preferences: next, loaded: true });
      writeCacheNow();
      config.broadcast?.(next, response.updatedAt);
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
    let response: PreferencesReadResponse;
    try {
      response = await config.transport.load();
    } catch {
      // Offline or signed out: keep serving the cache.
      return;
    }
    // Disposed meanwhile, or a save was acknowledged while this read was out:
    // the read may predate that write, and the save's answer already stands.
    if (disposed || epoch !== startedIn) return;
    serverUpdatedAt = response.updatedAt;
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
        // Every orphan predates this start; a reset pressed meanwhile discards them.
        const genAtStart = resetGen;
        try {
          const cached = await config.cache.read();
          if (cached !== null && cached !== undefined && !state.loaded) {
            publish({ preferences: withPending(parseUserPreferences(cached, config.defaults)) });
          }
        } catch {
          // An unreadable cache is a first visit.
        }
        // Take over every entry left in the slot — a tab, popup or worker that
        // closed before its change was acknowledged — oldest first. A context
        // still alive rewrites its own entry on its next change, failure or ack.
        let entries: Record<string, PendingEntry> = {};
        /** Each taken entry as it was read, so only an UNCHANGED one is removed. */
        const seen: Record<string, string> = {};
        try {
          const raw = await config.cache.readPending?.();
          entries = readSlot(raw);
          const stored = rawContexts(raw);
          for (const id of Object.keys(entries)) seen[id] = JSON.stringify(stored[id]);
        } catch {
          // Nothing recoverable; carry on with what the server holds.
        }
        const orphans = Object.entries(entries).sort(([, a], [, b]) => a.at - b.at);
        const unsent =
          resetGen === genAtStart ? combineAll(orphans.map(([, entry]) => entry.patch)) : null;
        if (unsent) {
          // Older than anything made in this instance, so it goes underneath.
          pending = pending ? combinePreferencePatches(unsent, pending) : unsent;
          publish({ preferences: mergePreferences(state.preferences, pending) });
        }
        await refresh();

        // A patch some context SENT but never heard back about is re-sent only
        // if the server is unchanged since it was sent — then it cannot have
        // landed. Otherwise it landed, or something newer replaced it, and
        // replaying it would undo another device's change. Undecidable while
        // offline, so it stays in the slot for a later start.
        const known = serverUpdatedAt !== undefined;
        const resend =
          known && resetGen === genAtStart
            ? combineAll(
                orphans.map(([, entry]) =>
                  entry.sent && entry.sentAfter !== undefined && entry.sentAfter === serverUpdatedAt
                    ? entry.sent
                    : undefined,
                ),
              )
            : null;
        if (resend) {
          pending = pending ? combinePreferencePatches(resend, pending) : resend;
          if (holds === 0) publish({ preferences: mergePreferences(state.preferences, resend) });
        }
        if (orphans.length > 0) {
          const taken = orphans.map(([id, entry]) => [id, entry] as const);
          editSlot((slot) => {
            for (const [id, entry] of taken) {
              // Rewritten since it was read (its context is alive, or a worker
              // recorded another change): the new value is not ours to remove.
              // At worst what we took is sent twice, with the same values.
              if (JSON.stringify(slot[id]) !== seen[id]) continue;
              if (!known && entry.sent) {
                slot[id] = { sent: entry.sent, sentAfter: entry.sentAfter, at: entry.at };
              } else {
                delete slot[id];
              }
            }
          });
          lastPersistedPending = null;
          persistUnsavedNow();
        }
        if (pending) await flushNow();
      })();
      starting = started;
      void started.finally(() => {
        starting = null;
      });
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
      // Changes made BEFORE the reset are what it discards. Changes made while
      // it waits for an in-flight save, or while the DELETE is out, are newer
      // than the reset and are kept — and a save holds until the DELETE answers
      // so it lands after it, not before.
      resetGen += 1;
      clearTimer();
      pending = null;
      // Claimed at once, so a save started while the in-flight one finishes
      // waits for the DELETE instead of landing before it.
      const request = (async () => {
        if (inFlight) await inFlight.catch(() => undefined);
        sending = null;
        persistUnsavedNow();
        publish({ status: 'saving' });
        return config.transport.reset();
      })();
      resetting = request;
      try {
        const response = await request;
        if (disposed) return;
        epoch += 1;
        serverUpdatedAt = response.updatedAt;
        retryMs = FIRST_RETRY_MS;
        heldRemote = null;
        // A change made while the reset was out is newer than the reset.
        lastServer = parseUserPreferences(response.preferences, config.defaults);
        const next = withPending(lastServer);
        publish({ preferences: next, status: pending ? 'saving' : 'idle', loaded: true });
        writeCacheNow();
        config.broadcast?.(next, response.updatedAt);
        if (pending) schedule(debounceMs);
      } catch (error) {
        if (disposed) return;
        // Nothing is queued to retry — a reset is the reader's explicit act and
        // its failure is reported to them by the caller, inline. The store
        // itself has nothing unsaved, so it goes back to idle rather than
        // claiming a retry that will never happen.
        publish({ status: 'idle' });
        if (pending) schedule(debounceMs);
        throw error;
      } finally {
        if (resetting === request) resetting = null;
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

    receive(preferences, updatedAt) {
      if (disposed) return;
      // Another tab's acknowledged save: newer than any read still out. Its
      // version, when the sender gave one, is the server's version now.
      epoch += 1;
      serverUpdatedAt = updatedAt;
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
      // `pending` is kept: an in-flight save that answers after this still
      // rewrites the slot entry from it (see the ack and failure branches).
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
        return;
      }
      // A short-lived context (a service worker's per-write store) is gone right
      // after this resolves, so its queued slot writes must have landed by then.
      await slotChain;
    },
  };
}
