'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * A panel width the reader chose, remembered in this browser.
 *
 * `width` is the default until the stored value has been read, so the server render and the
 * first client render agree; `ready` says when that has happened, for anything that should
 * only appear once the real number is known (a handle whose `aria-valuenow` would otherwise
 * be wrong for one frame). `isCustom` is false while the default is in force, so a caller
 * can keep its own responsive default instead of pinning a pixel width it never chose.
 *
 * Storage is read, not trusted: a value that is not a whole number is ignored and one out
 * of range is clamped. Storage that throws (private windows, blocked site data) leaves the
 * default in force and the page working.
 */
type Limit = number | (() => number);

const resolve = (limit: Limit) => (typeof limit === 'function' ? limit() : limit);

function readStored(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null || !/^\d+$/.test(raw)) return null;
    return Number(raw);
  } catch {
    return null;
  }
}

export function useStoredWidth(key: string, fallback: number, min: number, max: Limit) {
  const [stored, setStored] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const clamp = useCallback(
    (width: number) => Math.min(resolve(max), Math.max(min, Math.round(width))),
    [min, max],
  );

  useEffect(() => {
    const value = readStored(key);
    // Reading storage after mount is the point of this effect: it must not run during
    // render, or the server and the first client paint would disagree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStored(value === null ? null : clamp(value));
    setReady(true);
  }, [key, clamp]);

  const setWidth = useCallback(
    (width: number) => {
      const next = clamp(width);
      setStored(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Not remembered, still applied for this visit.
      }
    },
    [key, clamp],
  );

  const reset = useCallback(() => {
    setStored(null);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to forget.
    }
  }, [key]);

  return { width: stored ?? fallback, isCustom: stored !== null, ready, setWidth, reset };
}
