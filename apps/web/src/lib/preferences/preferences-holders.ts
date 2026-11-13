/**
 * The two kinds of preferences a page can be holding: an account's, synced, or a
 * signed-out visitor's, which is a theme and nothing more.
 *
 * Both answer the same {@link PreferencesHolder} interface so every hook reads one
 * thing whichever is active (`active-preferences.ts` decides which).
 */
import {
  createPreferencesSync,
  type PreferencesSyncStatus,
  type PreferencesTransport,
} from '@chatofy/api-client';
import {
  defaultUserPreferences,
  mergePreferences,
  type UserPreferences,
  type UserPreferencesPatch,
} from '@chatofy/types';
import {
  accountPreferencesCache,
  readCachedTheme,
  removeLegacyPreferenceKeys,
  writeVisitorTheme,
} from './preferences-cache';

export interface PreferencesSnapshot {
  preferences: UserPreferences;
  status: PreferencesSyncStatus;
  /**
   * False until the cache or the server has answered. A control rendered against
   * the defaults and corrected a frame later reads as the UI changing its own mind,
   * so screens wait on this.
   */
  ready: boolean;
  /** True when the preferences are an account's and sync across its devices. */
  synced: boolean;
}

export interface PreferencesHolder {
  getSnapshot(): PreferencesSnapshot;
  subscribe(listener: () => void): () => void;
  /** Optimistic: the snapshot changes now, the save settles behind it. */
  update(patch: UserPreferencesPatch): void;
  /** Back to the defaults everywhere. Rejects when the server could not be reached. */
  reset(): Promise<void>;
  /** Defer remote changes while a conversation or call runs. Counted. */
  hold(): void;
  release(): void;
  refresh(): void;
  flush(): void;
  dispose(forget: boolean): void;
}

/** Same-browser tabs of one account hear each other's saves on this channel. */
export const PREFERENCES_CHANNEL = 'chatofy.preferences';

interface ChannelMessage {
  userId: string;
  preferences: UserPreferences;
}

export interface AccountHolder extends PreferencesHolder {
  readonly userId: string;
  /**
   * The session has been confirmed as this account's. Until then the store serves
   * its cache but sends nothing: a holder may be opened from the cache while the
   * session is still loading, and a request made for a session that turns out to be
   * gone would be a 401 on a page that never needed the account.
   */
  confirm(): void;
}

export function createAccountHolder(options: {
  userId: string;
  locale: string;
  transport: PreferencesTransport;
  debounceMs?: number;
}): AccountHolder {
  const { userId } = options;
  let confirm!: () => void;
  const confirmed = new Promise<void>((resolve) => {
    confirm = resolve;
  });
  const { transport } = options;

  const channel =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(PREFERENCES_CHANNEL);
  /**
   * Set once disposed. A save still in flight, or a hold released after an
   * account switch, must not touch the closed channel or apply a held copy: either
   * would write this account's document back over the next account's cache.
   */
  let disposed = false;

  const store = createPreferencesSync({
    transport: {
      load: () => confirmed.then(() => transport.load()),
      save: (patch) => confirmed.then(() => transport.save(patch)),
      reset: () => confirmed.then(() => transport.reset()),
    },
    cache: accountPreferencesCache(userId),
    defaults: defaultUserPreferences(options.locale),
    debounceMs: options.debounceMs,
    broadcast: (preferences) => {
      if (disposed) return;
      const message: ChannelMessage = { userId, preferences };
      channel?.postMessage(message);
    },
  });

  let ready = false;
  let snapshot: PreferencesSnapshot = { ...store.getState(), ready, synced: true };
  const listeners = new Set<() => void>();
  const publish = () => {
    snapshot = { ...store.getState(), ready, synced: true };
    for (const listener of listeners) listener();
  };
  const markReady = () => {
    if (ready) return;
    ready = true;
    publish();
  };

  // The first thing the store publishes is the cache, or failing that the server's
  // copy: either is the reader's own setup, which is what `ready` waits for.
  const unsubscribe = store.subscribe(() => {
    ready = true;
    publish();
  });

  if (channel) {
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as Partial<ChannelMessage> | null;
      if (data && data.userId === userId && data.preferences) store.receive(data.preferences);
    };
  }

  // The account store is in use from here, so the per-setting keys it replaces go.
  removeLegacyPreferenceKeys();
  // With no cache and no server, the defaults are still a state to render.
  void store.start().finally(markReady);

  return {
    userId,
    confirm,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (patch) => store.update(patch),
    reset: () => store.reset(),
    hold: () => {
      if (!disposed) store.hold();
    },
    release: () => {
      if (!disposed) store.release();
    },
    refresh: () => void store.refresh(),
    flush: () => void store.flush(),
    dispose(forget) {
      disposed = true;
      unsubscribe();
      listeners.clear();
      channel?.close();
      void store.dispose(forget);
    },
  };
}

/**
 * A signed-out visitor: the defaults, with the theme they picked on this browser.
 *
 * Only the theme is stored; any other change lives as long as the page. Nothing
 * else is reachable without an account, so nothing else needs keeping.
 *
 * `pending` is the holder a page holds while the session is still loading and the
 * cache names no account: not ready, so a signed-in reader on a fresh browser sees
 * their screen wait for the account rather than show the defaults and then change.
 */
export function createVisitorHolder(locale: string, pending = false): PreferencesHolder {
  const onClient = typeof window !== 'undefined';
  let snapshot: PreferencesSnapshot = {
    preferences: {
      ...defaultUserPreferences(locale),
      theme: onClient ? readCachedTheme() : 'system',
    },
    status: 'idle',
    ready: onClient && !pending,
    synced: false,
  };
  const listeners = new Set<() => void>();
  const set = (preferences: UserPreferences) => {
    snapshot = { ...snapshot, preferences };
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(patch) {
      if (patch.theme) writeVisitorTheme(patch.theme);
      set(mergePreferences(snapshot.preferences, patch));
    },
    reset() {
      writeVisitorTheme('system');
      set(defaultUserPreferences(locale));
      return Promise.resolve();
    },
    hold: () => {},
    release: () => {},
    refresh: () => {},
    flush: () => {},
    dispose: () => listeners.clear(),
  };
}
