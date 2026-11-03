'use client';

import { createContext, use } from 'react';

/**
 * What a live line last showed, so the finished line that replaces it can start
 * from those exact words — and from that place on screen — instead of appearing
 * whole somewhere else.
 *
 * The two are different components in different lists: the live line sits under
 * the transcript and is removed by the same update that appends the finished
 * turn above it. Without this, the reader's eye loses the sentence at the one
 * moment it changes most (measured on a real conversation: the final translation
 * differs from the provisional one in about 60% of its words).
 *
 * One registry per transcript, not per page. A split view and a caption window
 * each draw their own copy of the same turn, at their own position and with
 * their own half of it.
 */
export interface LiveLineSnapshot {
  source: string;
  target: string;
  /** The line's box as painted, in viewport coordinates. */
  rect: DOMRect | null;
  /** When the live line went away; `null` while it is still on screen. */
  endedAt: number | null;
  /** Which consumers have already started from this snapshot. */
  claimedBy: Set<HandoffConsumer>;
}

export type HandoffConsumer = 'source' | 'target' | 'position';

/**
 * One transcript's memory of its lines.
 *
 * - `lines`: what each live line last showed, by session.
 * - `drawn`: what each finished turn's line last read, by half and session, so
 *   a list item that remounts — its group key changes when a late capture
 *   regroups the transcript — starts from the words already on screen instead
 *   of appearing whole or being retyped.
 * - `ready`: false until the transcript's first commit. Lines mounted in that
 *   commit are the transcript as it already was, and are drawn whole; a turn
 *   that arrives later with nothing to continue is typed in.
 */
export interface LiveLineRegistry {
  lines: Map<string, LiveLineSnapshot>;
  drawn: Map<string, { text: string; groupIds: readonly string[] }>;
  ready: boolean;
}

export function createLiveLineRegistry(): LiveLineRegistry {
  return { lines: new Map(), drawn: new Map(), ready: false };
}

/** Called once the transcript's first commit is on screen; see `ready`. */
export function markLiveLineRegistryReady(registry: LiveLineRegistry): void {
  registry.ready = true;
}

/** Whether any of these turns has been drawn as a finished line before. */
export function wasDrawn(
  registry: LiveLineRegistry | null,
  half: Exclude<HandoffConsumer, 'position'>,
  sessionIds: readonly string[],
): boolean {
  return sessionIds.some((id) => registry?.drawn.has(`${half}:${id}`) ?? false);
}

/** Remember what a finished line reads, for each turn it shows. */
export function recordDrawn(
  registry: LiveLineRegistry | null,
  half: Exclude<HandoffConsumer, 'position'>,
  sessionIds: readonly string[],
  text: string,
): void {
  for (const id of sessionIds) registry?.drawn.set(`${half}:${id}`, { text, groupIds: sessionIds });
}

/**
 * What these turns' line last read on screen, if every one of them was drawn
 * before: the distinct texts of the groups they were in, in order.
 *
 * Only when this line holds the WHOLE of each of those groups. A block that
 * split in two would otherwise start both halves from the full old text and
 * show the same words stacked in two places while each erased the other's;
 * a half is drawn whole instead, which on screen is the block getting shorter.
 */
export function previouslyDrawn(
  registry: LiveLineRegistry | null,
  half: Exclude<HandoffConsumer, 'position'>,
  sessionIds: readonly string[],
): string | null {
  if (!registry || sessionIds.length === 0) return null;
  const texts: string[] = [];
  for (const id of sessionIds) {
    const entry = registry.drawn.get(`${half}:${id}`);
    if (!entry || entry.groupIds.some((member) => !sessionIds.includes(member))) return null;
    if (texts.at(-1) !== entry.text) texts.push(entry.text);
  }
  return texts.join(' ');
}

/**
 * How long after a live line goes away its snapshot may still be taken over.
 * The finished turn lands in the same update, so this only needs to cover a
 * commit or two; it is generous so a slow frame never loses the handoff, and
 * short so a line remounted later is never replayed from an old snapshot.
 */
export const HANDOFF_WINDOW_MS = 1000;

/** Provided by each `ConversationTranscript` with a registry of its own. */
export const LiveLineHandoffContext = createContext<LiveLineRegistry | null>(null);

export function useLiveLineHandoff(): LiveLineRegistry | null {
  return use(LiveLineHandoffContext);
}

/** Record what a live line shows now. Called after each of its commits. */
export function recordLiveLine(
  registry: LiveLineRegistry,
  sessionId: string,
  snapshot: Pick<LiveLineSnapshot, 'source' | 'target' | 'rect'>,
): void {
  const existing = registry.lines.get(sessionId);
  registry.lines.set(sessionId, {
    ...snapshot,
    endedAt: null,
    claimedBy: existing?.claimedBy ?? new Set(),
  });
}

/** Mark a live line gone, and drop snapshots too old to be taken over. */
export function endLiveLine(registry: LiveLineRegistry, sessionId: string, now: number): void {
  const snapshot = registry.lines.get(sessionId);
  if (snapshot) snapshot.endedAt = now;
  for (const [key, entry] of registry.lines) {
    if (entry.endedAt !== null && now - entry.endedAt > HANDOFF_WINDOW_MS)
      registry.lines.delete(key);
  }
}

/**
 * The snapshot a finished line should start from, claimed for `consumer`.
 *
 * The turn's own line first. Failing that, the newest line that ended without
 * being taken over: that is a turn the server split into pieces, whose live line
 * carried the parent's id and whose pieces each carry their own. Only lines that
 * have actually gone count, so a line still being spoken is never borrowed.
 * `ownLineOnly` skips that fallback, for a consumer that would rather do
 * nothing than act on a guess.
 */
export function claimLiveLine(
  registry: LiveLineRegistry | null,
  sessionIds: readonly string[],
  consumer: HandoffConsumer,
  now: number,
  { ownLineOnly = false }: { ownLineOnly?: boolean } = {},
): LiveLineSnapshot | null {
  if (!registry) return null;
  const fresh = (entry: LiveLineSnapshot | undefined): entry is LiveLineSnapshot =>
    entry !== undefined &&
    entry.endedAt !== null &&
    now - entry.endedAt <= HANDOFF_WINDOW_MS &&
    !entry.claimedBy.has(consumer);
  let found = sessionIds.map((id) => registry.lines.get(id)).find(fresh) ?? null;
  if (!found && !ownLineOnly) {
    for (const entry of registry.lines.values()) {
      if (fresh(entry) && (!found || entry.endedAt! > found.endedAt!)) found = entry;
    }
  }
  found?.claimedBy.add(consumer);
  return found;
}
