import { createPreferencesSync, type PreferencesSync } from '@chatofy/api-client';
import { loadAccessToken } from './token-storage';
import { extensionDefaults, preferencesCache } from './preferences-cache';
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

/**
 * Write the pair, the voice or the context from the service worker.
 *
 * Built, started, written, flushed and disposed within the call, because a
 * service worker has no lifetime to hold a store across and a retry timer it
 * left behind would die with it. `start` runs first so the patch is computed
 * against the current account document and not against whatever this worker
 * last happened to see. Signed out there is no account to write to, so the call
 * does nothing — a capture cannot start without a session anyway.
 *
 * A save the API refused stays in the cache (the capture reads the change from
 * there) and is reported through `console.warn`, since the next popup open
 * re-reads the server copy and a failure here has no surface to show on.
 */
export async function saveSyncedFields(
  apiBaseUrl: string,
  change: Partial<SyncedCaptureFields> & { contextId?: string | null },
): Promise<void> {
  if ((await loadAccessToken()) === null) return;

  const store = createExtensionPreferences(apiBaseUrl);
  try {
    await store.start();
    const patch = patchFromSynced(store.getState().preferences, change);
    if (patch === null) return;
    store.update(patch);
    await store.flush();
    if (store.getState().status === 'error') {
      console.warn('Could not save preferences to your account; keeping them on this device.');
    }
  } finally {
    await store.dispose();
  }
}
