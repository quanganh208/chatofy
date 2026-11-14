/**
 * The workspace this device last chose: `'personal'` or a team id.
 *
 * One key, `{ userId, value }`, owned by one account at a time, the same convention
 * as the preferences cache: an entry written for another user is ignored, and the
 * key is forgotten on sign-out. The workspace decides what a screen MANAGES (which
 * library a glossary or AI Context lands in); it never filters what translate offers.
 *
 * Deliberately NO cross-tab `storage` listener. A tab with an editor open must not
 * change scope under it because another tab switched: a save would then land in a
 * workspace the editor never showed. Each tab reads the key when it mounts and
 * follows only its own writes.
 *
 * Every storage touch is wrapped: Safari private mode and a disabled-storage policy
 * throw on access, and the fallback is always personal.
 */
export const WORKSPACE_STORAGE_KEY = 'chatofy.workspace';

const PERSONAL = 'personal';

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** The stored value for `userId`, or `'personal'` when nothing usable is stored. */
export function readStoredWorkspace(userId: string): string {
  let raw: string | null;
  try {
    raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return PERSONAL;
  }
  if (!raw) return PERSONAL;
  try {
    const entry: unknown = JSON.parse(raw);
    if (!entry || typeof entry !== 'object') return PERSONAL;
    const { userId: owner, value } = entry as Record<string, unknown>;
    if (typeof owner !== 'string' || typeof value !== 'string' || !value) return PERSONAL;
    return owner === userId ? value : PERSONAL;
  } catch {
    return PERSONAL;
  }
}

export function writeStoredWorkspace(userId: string, value: string): void {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ userId, value }));
  } catch {
    // Storage refused: the choice holds for this visit through the listeners.
  }
  notify();
}

/** Sign-out: the next account on this device starts in personal. */
export function forgetStoredWorkspace(): void {
  try {
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // Nothing stored that could be read back, or nothing to remove.
  }
  notify();
}

/** This tab's writes only; see the module docblock for why not other tabs'. */
export function subscribeStoredWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
