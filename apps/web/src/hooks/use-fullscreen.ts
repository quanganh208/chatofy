'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseFullscreen<T extends HTMLElement> {
  /**
   * Attach to the element that goes fullscreen. A callback ref held in state
   * rather than a ref object, so the element is a value render may read — the
   * change listener below depends on it.
   */
  attach: (node: T | null) => void;
  /** Fullscreen by either route. */
  active: boolean;
  /**
   * The CSS route: the element covers the viewport itself because the browser
   * would not do it. The caller draws that state, which the native route draws
   * through `:fullscreen` without being asked.
   */
  emulated: boolean;
  enter: () => void;
  exit: () => void;
}

/**
 * The transcript, fullscreen.
 *
 * ## Two routes, one state
 *
 * The Fullscreen API where the browser grants it on an element, and a fixed
 * full-viewport layer where it does not — iPhone Safari has the API only for
 * `<video>`, so the element route is refused there outright, and an embedding
 * frame without `allowfullscreen` refuses it everywhere. The caller is told which
 * one is in force, because only the emulated one needs styles of its own.
 *
 * ## The browser decides when native fullscreen ended
 *
 * Esc, a system gesture, or the tab losing it all end native fullscreen without
 * this hook being asked, so `active` follows `fullscreenchange` rather than the
 * call that requested it. Esc is wired by hand only for the emulated layer, where
 * nothing else would hear it.
 *
 * ## Focus goes back where it came from
 *
 * The button that entered is outside the fullscreen element (or under the cover),
 * and the stage's own close control unmounts on the way out — so leaving would
 * otherwise drop focus on `<body>`. Whatever had focus when fullscreen was asked
 * for gets it back when fullscreen ends, by any route.
 */
export function useFullscreen<T extends HTMLElement>(): UseFullscreen<T> {
  const [node, attach] = useState<T | null>(null);
  const [native, setNative] = useState(false);
  const [emulated, setEmulated] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const active = native || emulated;

  useEffect(() => {
    if (active) return;
    returnFocus.current?.focus();
    returnFocus.current = null;
  }, [active]);

  useEffect(() => {
    const onChange = () => setNative(node !== null && document.fullscreenElement === node);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [node]);

  useEffect(() => {
    if (!emulated) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEmulated(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [emulated]);

  const enter = useCallback(() => {
    if (!node) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (document.fullscreenEnabled && typeof node.requestFullscreen === 'function') {
      // A refusal after the check (a permissions policy, a lost activation) falls
      // through to the layer rather than leaving the button doing nothing.
      node.requestFullscreen().catch(() => setEmulated(true));
      return;
    }
    setEmulated(true);
  }, [node]);

  const exit = useCallback(() => {
    setEmulated(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  return { attach, active, emulated, enter, exit };
}
