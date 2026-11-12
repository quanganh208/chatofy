'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * The content width at which History becomes two panes, in px.
 *
 * The same number as the `@5xl` container variant (64rem) the layout's classes use:
 * the CSS decides what is DRAWN, so the first paint is already the right shape, and
 * this decides only what is worth FETCHING — the newest conversation on `/history`,
 * which a phone never shows.
 */
export const WIDE_CONTENT_PX = 1024;

/**
 * Whether an element is at least {@link WIDE_CONTENT_PX} wide.
 *
 * The element's own width, not the viewport's: a collapsed sidebar gives the content
 * ~200px more at the same window size, and a viewport query would ignore that.
 * `false` until measured and where `ResizeObserver` is missing, which is the narrow
 * layout — the one that fetches less.
 */
export function useContainerWide(ref: RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= WIDE_CONTENT_PX);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return wide;
}
