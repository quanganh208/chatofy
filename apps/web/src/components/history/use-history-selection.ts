'use client';

import { useCallback, useState } from 'react';
import type { ConversationSummary } from '@chatofy/types';

/**
 * Which conversation is open in the reading pane.
 *
 * - `/history/<id>`: that one, on any width.
 * - `/history` on a wide screen: the newest — PINNED when it first opens. A search
 *   that changes which row is newest does not swap the pane: refetching a detail,
 *   resetting its tab and stopping its audio once per debounced keystroke would make
 *   the list unusable as a filter beside what you are reading. A row click is what
 *   changes it.
 * - `/history` on a narrow screen: none; the list is the whole page.
 *
 * The pin is dropped when a URL names a conversation, so coming back to `/history`
 * opens the newest again, and when the pinned conversation is deleted, so the newest
 * REMAINING one opens in its place.
 */
export function useHistorySelection(
  openId: string | undefined,
  wide: boolean,
  conversations: readonly ConversationSummary[],
) {
  const [pinned, setPinned] = useState<string | undefined>(undefined);
  const newest = conversations[0]?.conversationId;

  // Adjusted during render, so the pane never draws one frame of the wrong choice.
  if (openId !== undefined && pinned !== undefined) setPinned(undefined);
  if (openId === undefined && wide && pinned === undefined && newest !== undefined) {
    setPinned(newest);
  }

  const selectedId = openId ?? (wide ? (pinned ?? newest) : undefined);

  const unpin = useCallback((conversationId: string) => {
    setPinned((current) => (current === conversationId ? undefined : current));
  }, []);

  return { selectedId, unpin };
}
