'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Whether a translate conversation is running somewhere in this tab.
 *
 * The Settings dialog opens over whatever page is showing, including `/translate`
 * mid-conversation. The pair, the voice and the starting context ride
 * `client.session.start`, so the page freezes them while it runs — and the dialog
 * writes the same account preferences the page reads (`use-translate-settings.ts`).
 * A dialog that left them live would accept a change the
 * running conversation ignores and then silently apply it to the next one.
 *
 * A module store rather than a context: the dialog is mounted by the app frame,
 * above the page, so no provider the page renders can reach it. The page reports,
 * the dialog reads.
 *
 * Counted rather than a flag, so two reporters (a remount overlapping its
 * predecessor's cleanup) cannot clear each other: it reads running while ANY
 * reporter says so.
 */
let reporters = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => reporters > 0;
// The server renders no conversation.
const serverSnapshot = () => false;

function change(delta: 1 | -1): void {
  reporters += delta;
  for (const listener of listeners) listener();
}

/** True while some mounted translate surface reports a conversation running. */
export function useConversationRunning(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * Report this surface's conversation as running for as long as `running` is true
 * and the caller is mounted. Unmounting mid-conversation withdraws the report.
 */
export function useReportConversationRunning(running: boolean): void {
  useEffect(() => {
    if (!running) return;
    change(1);
    return () => change(-1);
  }, [running]);
}
