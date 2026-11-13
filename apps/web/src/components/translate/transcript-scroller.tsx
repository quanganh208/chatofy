'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { ScrollArea } from '@chatofy/ui/react';
import type { TranscriptOrder } from '@/lib/translate-settings';

/**
 * How far from the newest edge still counts as reading the newest turn.
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
 * ## Which edge it follows
 *
 * The NEWEST edge, wherever `order` puts it. Oldest first, that is the bottom:
 * the conversation grows downward and the region keeps the end in view. Newest
 * first, it is the top: the line being spoken sits above everything else, so the
 * region holds `scrollTop` at 0 while the reader is within the slack of it. Every
 * rule below — remembered anchoring, the slack, `freeScroll` — is the same rule
 * measured from that edge; "the end" in what follows means whichever one it is.
 *
 * ## The cap lives above this, and it has to BE a cap
 *
 * This carried `max-h-[calc(100svh-16rem)]` while it was the only scroll region
 * on the screen. It is not, since `split` draws one of these per pane — and two
 * stacked regions each capped at the viewport are two viewports of page. The
 * maximum moved up to `transcript-panes.tsx`, which knows how many of these there
 * are and divides one bounded height between them.
 *
 * **What must not come back is bounding by `flex-1` alone, and the failure is
 * silent.** `SidebarProvider` is `min-h-svh` — an INDEFINITE height, so the
 * wrapper's own size includes this region's full content. `flex-1` then has no
 * bound to divide and `overflow-y-auto` never engages: measured at 60 turns,
 * `clientHeight` and `scrollHeight` were both 4500, the region did not scroll,
 * and the dock sat at y=4664. The auto-following below went with it —
 * `scrollTop = scrollHeight` on an element that cannot scroll is a no-op, so new
 * turns landed under the fold of a page that would not follow them.
 *
 * `min-height` cannot fix that. A floor is not a bound; only a resolved MAXIMUM
 * makes a box overflow. So `min-h-0 flex-1` here is how the region FILLS whatever
 * the wrapper allows, and the wrapper is where the allowance comes from.
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
 * zero, so following stays on. Newest first, the turn that lands lands ABOVE the
 * reader; one scrolled away to re-read, or parked at the top with free scroll on,
 * is held on the turn they are reading by hand, in every browser. Switching the
 * order resets following, because a flipped list makes the old position
 * meaningless.
 *
 * ## `freeScroll` is the reader saying it in advance
 *
 * Scrolling up already stops the following, so the switch is not a second way to
 * do the same thing — it covers the case the gesture cannot express: staying put
 * while parked AT the end. Anchored there, every new turn re-pins the view, and
 * there is no scroll that means "stop doing that" without also meaning "take me
 * somewhere else". With it on, the region never follows and the conversation
 * grows below the fold, which is the point.
 *
 * `useLayoutEffect`, so the correction lands before the browser paints —
 * `useEffect` lets a frame through with the new turn below the fold. The scroll
 * is instant, never smooth: smooth is motion nobody asked for, it queues up
 * behind a fast exchange, and it is the first thing a reduced-motion preference
 * means to switch off.
 */
export function TranscriptScroller({
  label,
  freeScroll = false,
  order = 'oldest-first',
  children,
}: {
  label: string;
  /** Never follow the conversation, even from the newest edge. */
  freeScroll?: boolean;
  /** Which edge holds the newest turn: the bottom oldest first, the top newest first. */
  order?: TranscriptOrder;
  children: React.ReactNode;
}) {
  const region = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const followsTop = order === 'newest-first';

  // The turn the reader is looking at and where its top sat in the content, for
  // the place-keeping below. Recorded after every commit and every scroll, and
  // only newest first while the reader is away from the top — nothing reads it
  // otherwise, and it measures every turn above the view.
  const anchor = useRef<Anchor[] | null>(null);
  const recordAnchor = useCallback(() => {
    const node = region.current;
    anchor.current =
      node && followsTop && (freeScroll || !following.current) ? readingAnchor(node) : null;
  }, [followsTop, freeScroll]);

  const onScroll = useCallback(() => {
    const node = region.current;
    if (!node) return;
    const fromNewest = followsTop
      ? node.scrollTop
      : node.scrollHeight - node.scrollTop - node.clientHeight;
    following.current = fromNewest <= ANCHOR_SLACK_PX;
    recordAnchor();
  }, [followsTop, recordAnchor]);

  // Newest first grows at the TOP, so a reader not following would see the turn
  // they are reading slide away under every new one. Held here, by that turn
  // rather than by total height: a late translation growing a turn BELOW the
  // reader must not move them. Done by hand in every browser, with the browser's
  // own anchoring switched off on this region (below): native anchoring skips a
  // reader at scrollTop 0 — exactly free scroll parked at the top — and leaving
  // it on as well would move the others twice.
  //
  // The turn after it is held as a spare: a block that a newer turn merges into
  // the one before it unmounts (its key was its first turn), and the reader is
  // then kept by the turn below instead of not at all.
  const holdPlace = useCallback(() => {
    const node = region.current;
    const held = anchor.current?.find(({ element }) => element.isConnected);
    if (node && held) node.scrollTop += contentTop(node, held.element) - held.top;
  }, []);

  // The order the last commit drew, so a switch can be told apart from an update.
  const drawnOrder = useRef(order);

  useLayoutEffect(() => {
    const node = region.current;
    if (!node) return;
    if (drawnOrder.current !== order) {
      // Switching the order is asking to see the newest turn, wherever the reader
      // was — free scroll or not: their old position means something else once
      // the list has flipped, and no scroll event fires to re-decide it.
      drawnOrder.current = order;
      following.current = true;
      anchor.current = null;
      node.scrollTop = followsTop ? 0 : node.scrollHeight;
    } else if (!freeScroll && following.current) {
      node.scrollTop = followsTop ? 0 : node.scrollHeight;
    } else if (followsTop) {
      holdPlace();
    }
    recordAnchor();
  });

  // Text above the reader also grows WITHOUT this component rendering: the live
  // line types itself in and a polished translation morphs, both frame by frame
  // on their own state. A commit here would never see that growth, so newest
  // first also holds the place whenever the content changes size.
  useEffect(() => {
    const content = region.current?.firstElementChild;
    if (!followsTop || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!freeScroll && following.current) return;
      holdPlace();
      recordAnchor();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [followsTop, freeScroll, holdPlace, recordAnchor]);

  return (
    // shadcn's scroll area for a thin themed bar instead of the browser's. The element
    // that scrolls is its viewport, so the ref, the scroll listener and the region's
    // focus and name all go there; the root only takes the place in the flex column.
    <ScrollArea
      className="min-h-0 flex-1"
      viewportProps={{
        ref: region,
        onScroll,
        // Focusable and named, because a scroll region that only some browsers make
        // reachable is one a keyboard user cannot read in the others. Its contents
        // are often only the live line, which holds nothing focusable of its own.
        tabIndex: 0,
        role: 'region',
        'aria-label': label,
        // Newest first keeps the reader's place by hand (the effect above), so the
        // browser's anchoring is off there; oldest first leaves it to the browser.
        className: followsTop ? 'overscroll-contain [overflow-anchor:none]' : 'overscroll-contain',
      }}
    >
      {children}
    </ScrollArea>
  );
}

interface Anchor {
  element: HTMLElement;
  top: number;
}

/**
 * The first turn whose bottom is still inside the view — the one being read —
 * and the turn after it as a spare. `li` because every turn is a list item and
 * nothing else in the region is.
 */
function readingAnchor(node: HTMLElement): Anchor[] | null {
  const turns = node.querySelectorAll<HTMLElement>('li');
  for (let index = 0; index < turns.length; index++) {
    const element = turns[index]!;
    const top = contentTop(node, element);
    if (top + element.offsetHeight <= node.scrollTop) continue;
    const spare = turns[index + 1];
    return spare
      ? [
          { element, top },
          { element: spare, top: contentTop(node, spare) },
        ]
      : [{ element, top }];
  }
  return null;
}

/**
 * Where an element sits in the region's content, from layout offsets rather than
 * `getBoundingClientRect`: a finished turn slides in with a transform
 * (`flip-from-live-line.ts`), and a rect taken mid-slide would hold the reader to
 * where the turn was drawn, not where it is. Offsets also ignore the region's own
 * scroll, so the two page positions subtract to a content position.
 */
function contentTop(node: HTMLElement, element: HTMLElement): number {
  return pageTop(element) - pageTop(node);
}

function pageTop(element: HTMLElement): number {
  let top = 0;
  for (let at: HTMLElement | null = element; at; at = at.offsetParent as HTMLElement | null) {
    top += at.offsetTop;
  }
  return top;
}
