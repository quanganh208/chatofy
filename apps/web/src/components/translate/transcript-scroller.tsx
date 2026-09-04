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
 * ## The cap is viewport-relative, and it has to be a cap
 *
 * This was `max-h-[26rem]`: 416px on every display, which on the two-column
 * layout is a reading window smaller than the empty space beneath it. The
 * problem it solved is real, though — the dock below carries the status, the
 * level and the one action, and a transcript that grows the page puts them under
 * the fold after every sentence.
 *
 * **Replacing it with `flex-1` alone did not work, and the failure was silent.**
 * `SidebarProvider` is `min-h-svh` — an INDEFINITE height, so the wrapper's own
 * size includes this region's full content. `flex-1` then has no bound to divide
 * and `overflow-y-auto` never engages: measured at 60 turns, `clientHeight` and
 * `scrollHeight` were both 4500, the region did not scroll, and the dock sat at
 * y=4664. The auto-following below went with it — `scrollTop = scrollHeight` on
 * an element that cannot scroll is a no-op, so new turns landed under the fold
 * of a page that would not follow them.
 *
 * `min-height` cannot fix that. A floor is not a bound; only a resolved MAXIMUM
 * makes a box overflow. So the height comes from the viewport directly, and
 * `100svh` rather than `dvh` because the small viewport is the one that is true
 * while a mobile toolbar is showing. The 16rem subtracted is everything stacked
 * around it: the topbar, the column's padding, the panel headers, the gap, and
 * the dock.
 *
 * `flex-1` stays, and it is what fills a tall screen: with little on it the flex
 * line has slack to give and the region grows into the cap. `min-h-64` stays as
 * the floor for the other direction — once the minutes and the stats land below,
 * the region must not be squeezed to nothing.
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
      className="focus-visible:ring-ring/50 relative max-h-[calc(100svh-16rem)] min-h-64 flex-1 overflow-y-auto overscroll-contain focus-visible:ring-[3px] focus-visible:outline-none"
    >
      {children}
    </div>
  );
}
