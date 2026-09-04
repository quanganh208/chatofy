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
 * Capping the height is what keeps the dock — the status, the level, and the one
 * action — on screen while someone is talking. It also means growth no longer
 * pushes the page, so without this the newest turn simply falls below the fold of
 * a fixed box and the reader has to scroll after every sentence.
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
      className="focus-visible:ring-ring/50 relative max-h-[26rem] overflow-y-auto overscroll-contain focus-visible:ring-[3px] focus-visible:outline-none"
    >
      {children}
    </div>
  );
}
