import { combinePreferencePatches, mergePreferences } from '@chatofy/types';
import { createPreferencesSync, type PendingSlot, type PreferencesSync } from '@chatofy/api-client';
import { loadAccessToken } from './token-storage';
import { extensionDefaults, preferencesCache, readCachedPreferences } from './preferences-cache';
import { patchFromSynced, type SyncedCaptureFields } from './preferences-mapping';
import { createPreferencesTransport } from './preferences-transport';

/**
 * The extension's handle on the account's preferences.
 *
 * Every context that needs one builds its own: the popup keeps one for as long as
 * it is open, and the service worker builds a short-lived one per write. They
 * share nothing but the cache key (`preferences-cache.ts`), which is why neither
 * is a singleton here — a module-level store would be one per context anyway,
 * and would look like shared state that is not.
 */
export function createExtensionPreferences(apiBaseUrl: string): PreferencesSync {
  return createPreferencesSync({
    transport: createPreferencesTransport(apiBaseUrl),
    cache: preferencesCache,
    defaults: extensionDefaults(),
    // Short: the popup can be dismissed at any moment, and its callers flush as
    // soon as they write.
    debounceMs: 250,
  });
}

type SyncedChange = Partial<SyncedCaptureFields> & { contextId?: string | null };

/** This worker's entry in the shared pending slot. */
const WORKER_CONTEXT = 'worker';

/**
 * Record the pair, the voice or the context locally, with no network.
 *
 * The patch is computed against the cached document, merged into the cache a
 * capture reads, and added to the worker's entry in the pending slot. That entry
 * is what survives a service worker that dies before the account save finishes:
 * the next store's `start` takes it over and sends it. Returns whether anything
 * changed. Signed out there is no account to write to, so nothing is recorded.
 */
export function recordSyncedFields(change: SyncedChange): Promise<boolean> {
  // One at a time: two settings messages handled together would each read the
  // same cache and slot and the second write would drop the first's change.
  const run = recording.then(() => recordNow(change));
  recording = run.catch(() => false);
  return run;
}

let recording: Promise<unknown> = Promise.resolve();

async function recordNow(change: SyncedChange): Promise<boolean> {
  if ((await loadAccessToken()) === null) return false;

  const current = (await readCachedPreferences()) ?? extensionDefaults();
  const patch = patchFromSynced(current, change);
  if (patch === null) return false;

  const slot = (await preferencesCache.readPending?.()) as PendingSlot | null | undefined;
  const contexts = { ...(slot?.contexts ?? {}) };
  const earlier = contexts[WORKER_CONTEXT];
  contexts[WORKER_CONTEXT] = {
    ...earlier,
    patch: earlier?.patch ? combinePreferencePatches(earlier.patch, patch) : patch,
    at: Date.now(),
  };
  // Pending first: if the worker dies between the two writes the change is still
  // sent, whereas the other order would leave a cached value nothing will send.
  await preferencesCache.writePending?.({ contexts });
  await preferencesCache.write(mergePreferences(current, patch));
  return true;
}

/**
 * Send whatever the pending slot holds, from a short-lived store.
 *
 * Built, started, flushed and disposed within the call, because a service worker
 * has no lifetime to hold a store across and a retry timer it left behind would
 * die with it. A save that fails stays in the slot (the capture reads the change
 * from the cache) and is reported through `console.warn`, since the next popup
 * open re-sends it and a failure here has no surface to show on.
 */
export async function sendPendingPreferences(apiBaseUrl: string): Promise<void> {
  if ((await loadAccessToken()) === null) return;

  const store = createExtensionPreferences(apiBaseUrl);
  try {
    await store.start();
    await store.flush();
    const { status } = store.getState();
    if (status === 'error') {
      console.warn('Could not save preferences to your account; keeping them on this device.');
    } else if (status === 'refused') {
      console.warn('The API refused the preferences change; the account copy was kept.');
    }
  } finally {
    await store.dispose();
  }
}
