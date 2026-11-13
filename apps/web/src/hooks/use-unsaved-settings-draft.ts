'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Whether something inside the Settings dialog holds typing that has not been saved.
 *
 * The dialog closes on Esc and on a click on the dimmed page beside it — both easy
 * to do by reflex while writing (Esc to dismiss an autocomplete, a click to put the
 * cursor somewhere). A long form such as an AI Context draft would vanish with no way
 * back. While this reads true the dialog ignores those two; its ✕ and Back still
 * close it, because those are a decision rather than a reflex.
 *
 * A module store rather than a context, like `use-conversation-running.ts`: the
 * dialog's frame and the tab content that knows about the draft are far apart, and
 * the tab reports while the frame reads. Counted, so two reporters cannot clear
 * each other.
 */
let reporters = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => reporters > 0;
const serverSnapshot = () => false;

function change(delta: 1 | -1): void {
  reporters += delta;
  for (const listener of listeners) listener();
}

/** True while some mounted settings form reports unsaved typing. */
export function useUnsavedSettingsDraft(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** Read without subscribing, for an event handler. */
export function hasUnsavedSettingsDraft(): boolean {
  return snapshot();
}

/** Report unsaved typing for as long as `dirty` is true and the caller is mounted. */
export function useReportUnsavedSettingsDraft(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    change(1);
    return () => change(-1);
  }, [dirty]);
}
