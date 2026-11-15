/**
 * An in-tab signal that a glossary or AI Context library was written to.
 *
 * The translate picker reads every context the reader may use, once per mount. A
 * write in Settings opened over `/translate` changes that list (a context renamed,
 * a linked glossary's terms edited), so the picker listens here and refetches.
 * In-tab only, like the workspace store: another tab reads fresh on its next mount.
 */
const listeners = new Set<() => void>();

/** Call after a library write succeeded. */
export function notifyLibraryChanged(): void {
  for (const listener of listeners) listener();
}

/** Listen for library writes; returns the unsubscribe. */
export function onLibraryChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
