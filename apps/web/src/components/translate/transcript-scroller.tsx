'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * How far from the end still counts as reading the newest turn.
 *
 * Two lines, not a screenful. The threshold decides what a reader is taken to
 * have MEANT by scrolling: a nudge from a trackpad, or the last few pixels of a
 * scroll still settling, is not a request to stop following — and scrolling up
 * half a page to re-read the previous turn is. A screen-sized threshold calls the
 * second one an accident and yanks the reader back down.
 */
const ANCHOR_SLACK_PX = 64;

/**
 * The transcript's one scroll region, following the conversation as it grows.
 *
 * ## It takes the leftover space; it does not have a height of its own
 *
 * This was `max-h-[26rem]`, and the cap was the wrong instrument for the right
 * problem. What it was protecting is real — the dock below carries the status,
 * the level and the one action, and growth that pushed the page would put them
 * under the fold after every sentence. But it bought that by making the
 * transcript 416px on every screen, including the tall one where nothing was
 * ever in conflict, and on a two-column layout that is a reading window smaller
 * than the empty space under it.
 *
 * `flex-1` in a column that is at least `min-h-svh` (`SidebarProvider`) does the
 * same job structurally: while a conversation is running there is nothing below
 * the dock at all — the attribution stats and the minutes are both `!running` —
 * so the page does not scroll and the dock cannot be pushed anywhere. Once the
 * talking stops and those appear, the column grows past the viewport and the
 * page scrolls normally, with this region keeping its share.
 *
 * `min-h-64` is the floor that makes both true: it stops the flex line from
 * squeezing the transcript to nothing once results land under it, and it is what
 * gives `overflow-y-auto` a resolved minimum to scroll against — a flex child's
 * implicit minimum is its content, which never overflows and so never scrolls.
 *
 * ## Why there is no `revision` prop
 *
 * There was, and it was `turns.length + liveTurns.length` — which is invariant
 * across the one update that matters. A finished translation arrives as
 * `server.transcript.final`, and that reducer step removes the turn's live lines
 * AND appends the settled turn: minus one, plus one, no change. The effect never
 * fired. Nor did it for a live line whose TEXT grew, which changes no count
 * either. The feature was inert for everything except the first partial of a
 * conversation.
 *
 * So the effect runs after every render and asks the only question that matters —
 * is the reader still at the end — instead of trying to enumerate the updates
 * worth reacting to. Scrolling to the bottom when already at the bottom costs
 * nothing.
 *
 * ## Anchoring is remembered, not measured after the fact
 *
 * Whether to follow is decided by the reader's last scroll, recorded as it
 * happens. Measuring after new content lands gets it backwards on exactly the
 * turns that need it most: append a block taller than the viewport to a reader
 * pinned at the bottom, and the distance to the end is suddenly a whole screen,
 * so a measure-afterwards check concludes they had scrolled away.
 *
 * The scroll this component performs re-enters the handler with a distance of
 * zero, so following stays on.
 *
 * `useLayoutEffect`, so the correction lands before the browser paints —
 * `useEffect` lets a frame through with the new turn below the fold. The scroll
 * is instant, never smooth: smooth is motion nobody asked for, it queues up
 * behind a fast exchange, and it is the first thing a reduced-motion preference
 * means to switch off.
 */
export function TranscriptScroller({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const region = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  const onScroll = useCallback(() => {
    const node = region.current;
    if (!node) return;
    following.current = node.scrollHeight - node.scrollTop - node.clientHeight <= ANCHOR_SLACK_PX;
  }, []);

  useLayoutEffect(() => {
    const node = region.current;
    if (!node || !following.current) return;
    node.scrollTop = node.scrollHeight;
  });

  return (
    <div
      ref={region}
      onScroll={onScroll}
      // Focusable and named, because a scroll region that only some browsers make
      // reachable is one a keyboard user cannot read in the others. Its contents
      // are often only the live line, which holds nothing focusable of its own.
      tabIndex={0}
      role="region"
      aria-label={label}
      className="focus-visible:ring-ring/50 relative min-h-64 flex-1 overflow-y-auto overscroll-contain focus-visible:ring-[3px] focus-visible:outline-none"
    >
      {children}
    </div>
  );
}
