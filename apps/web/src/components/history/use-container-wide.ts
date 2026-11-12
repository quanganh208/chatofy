'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * The class a probe element carries so CSS, not a number here, decides "wide".
 *
 * `hidden @5xl:block`: displayed exactly when the History container is at least
 * 64rem, the width the layout's own `@5xl:` classes switch at. A px constant would
 * agree with that only at a 16px root font size — at a 20px default (an
 * accessibility setting) CSS switches at 1280px and a 1024px constant would fetch
 * the newest conversation for a pane that is not drawn.
 */
export const WIDE_PROBE_CLASS = 'hidden @5xl:block';

/**
 * Whether the History container is wide enough for two panes, as CSS sees it.
 *
 * Observes `container` for size changes and, on each one, reads whether `probe` — an
 * element inside it carrying {@link WIDE_PROBE_CLASS} — is displayed. One source of
 * truth: the container query that draws the layout is the one that answers here.
 *
 * `false` until measured and where `ResizeObserver` is missing, which is the narrow
 * layout — the one that fetches less.
 */
export function useContainerWide(
  container: RefObject<HTMLElement | null>,
  probe: RefObject<HTMLElement | null>,
): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const marker = probe.current;
      setWide(marker !== null && getComputedStyle(marker).display !== 'none');
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [container, probe]);

  return wide;
}
