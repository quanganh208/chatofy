'use client';

import { useEffect, useRef } from 'react';

/**
 * The transcript's one scroll region, following the conversation as it grows.
 *
 * Capping the height is what keeps the dock — the status, the level, and the one
 * action — on screen while someone is talking. It also means growth no longer
 * pushes the page, so without this the newest turn simply falls below the fold of
 * a fixed box and the reader has to scroll after every sentence. The line that
 * matters most is the live one: it is the only thing moving during the seconds
 * before a translation lands, and a live line nobody can see is the screen going
 * dead in the exact state this design is about.
 *
 * **It stops following the moment you scroll away.** Someone reading back three
 * turns while the conversation continues is not asking to be yanked to the
 * bottom, and a scroller that fights the reader is worse than one that never
 * moved. Anchored is "within a screenful of the end", so an accidental nudge
 * keeps following and a deliberate scroll up does not.
 *
 * The scroll itself is `auto`, never smooth: a smooth scroll is motion nobody
 * asked for, it queues up behind a fast exchange, and it is exactly what a
 * reduced-motion preference means to switch off.
 */
export function TranscriptScroller({
  /** Changes whenever there is something new to see. */
  revision,
  label,
  children,
}: {
  revision: number;
  label: string;
  children: React.ReactNode;
}) {
  const region = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = region.current;
    if (!node) return;
    const distanceFromEnd = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distanceFromEnd > node.clientHeight) return;
    node.scrollTop = node.scrollHeight;
  }, [revision]);

  return (
    <div
      ref={region}
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
