/**
 * A one-shot hand-off between two components that never render at the same time:
 * one side calls `request()` just before the other mounts, and the mounting side
 * reads it once with `consume()`, which answers `true` and clears it.
 *
 * Read it from a `useState` initializer. React 19 keeps the FIRST initializer result
 * under StrictMode and its double render reuses the hooks, so the second read that
 * answers `false` is discarded. An interrupted mount that React throws away and
 * restarts is not covered: the restart reads `false`. The hand-offs here only
 * open a form or move focus, so losing one costs a click, not data.
 *
 * A request nobody consumes within `ttlMs` expires, so a component mounted much
 * later — after a failed hand-off — never acts on a stale request.
 */
export interface OneShot {
  // Function properties, not methods: callers pass `consume` to `useState` unbound.
  request: () => void;
  consume: () => boolean;
}

export function createOneShot(ttlMs: number): OneShot {
  let requestedAt: number | undefined;
  return {
    request: () => {
      requestedAt = Date.now();
    },
    consume: () => {
      const at = requestedAt;
      requestedAt = undefined;
      return at !== undefined && Date.now() - at <= ttlMs;
    },
  };
}

/** How long a hand-off between two screens may wait to be read. */
export const HAND_OFF_TTL_MS = 5_000;
