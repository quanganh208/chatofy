'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  needsFrame,
  createRevealState,
  retarget,
  stepReveal,
  type RevealOptions,
  type RevealState,
} from '@/lib/smooth-text-reveal';

export interface UseSmoothTextReveal {
  /** What to draw now. */
  shown: string;
  /** Attach to the element that draws `shown`; frames are scheduled on ITS window. */
  attach: (element: HTMLElement | null) => void;
}

interface RevealController {
  attach(element: HTMLElement | null): void;
  setTarget(target: string, options: RevealOptions): void;
  dispose(): void;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const FIRST_FRAME_MS = 16;
const MAX_FRAME_MS = 100;

/**
 * Whether to draw the target as it is, with no reveal at all.
 *
 * Reduced motion is gated HERE, in JavaScript, because nothing else can see it:
 * the reduced-motion e2e check reads CSS `transitionProperty` and `animationName`
 * (`docs/design-guidelines.md`, Motion), and a reveal driven by animation frames
 * has neither. A hidden document is instant for a different reason — its frames
 * do not run, so a reveal there would simply stop.
 */
function isInstant(view: Window): boolean {
  return Boolean(view.matchMedia?.(REDUCED_MOTION).matches) || view.document.hidden;
}

/**
 * The frame loop, held outside React so that 60 updates a second never pass
 * through an effect.
 *
 * Frames are asked of the DRAWING element's own window. The caption window is a
 * Picture-in-Picture or popup document rendered by a portal from this page, and
 * the reader looks at it precisely while this tab is in the background — where
 * this tab's own `requestAnimationFrame` is paused and the caption would freeze.
 */
function createRevealController(draw: (shown: string) => void): RevealController {
  let element: HTMLElement | null = null;
  let state: RevealState | null = null;
  let frame: { view: Window; id: number } | null = null;
  let lastFrameAt: number | null = null;
  let watchedDocument: Document | null = null;

  const view = (): Window | null =>
    element?.ownerDocument.defaultView ?? (typeof window === 'undefined' ? null : window);

  const cancel = () => {
    if (frame) frame.view.cancelAnimationFrame(frame.id);
    frame = null;
    lastFrameAt = null;
  };

  const snap = () => {
    cancel();
    if (!state) return;
    // A held translation resolves to the one that replaced it: with no reveal,
    // there is nothing to hold for.
    const latest = state.pending ?? state.target;
    state = { ...state, shown: latest, target: latest, carry: 0, pending: null };
    draw(state.shown);
  };

  const onVisibilityChange = () => {
    if (watchedDocument?.hidden) snap();
  };

  const watch = (document: Document | null) => {
    if (watchedDocument === document) return;
    watchedDocument?.removeEventListener('visibilitychange', onVisibilityChange);
    watchedDocument = document;
    watchedDocument?.addEventListener('visibilitychange', onVisibilityChange);
  };

  const tick = (timestamp: number) => {
    const scheduledOn = frame?.view;
    frame = null;
    if (!state || !scheduledOn) return;
    const frameMs =
      lastFrameAt === null
        ? FIRST_FRAME_MS
        : Math.min(MAX_FRAME_MS, Math.max(0, timestamp - lastFrameAt));
    lastFrameAt = timestamp;
    const previous = state.shown;
    state = stepReveal(state, scheduledOn.performance.now(), frameMs);
    if (state.shown !== previous) draw(state.shown);
    if (needsFrame(state)) schedule();
    else lastFrameAt = null;
  };

  function schedule() {
    if (frame || !state || !needsFrame(state)) return;
    const target = view();
    if (!target) return;
    if (isInstant(target)) {
      snap();
      return;
    }
    frame = { view: target, id: target.requestAnimationFrame(tick) };
  }

  return {
    attach(next) {
      if (next === element) return;
      // A frame asked of the old element's window would run there, not here.
      cancel();
      element = next;
      watch(next?.ownerDocument ?? null);
      schedule();
    },
    setTarget(target, options) {
      const current = view();
      if (!current) return;
      const now = current.performance.now();
      state = retarget(state ?? createRevealState(options, now), target, now, options);
      if (isInstant(current)) {
        snap();
        return;
      }
      // Drawn at once, not on the next frame: a revision replaces the words that
      // changed, and showing replaced words for even a frame longer is
      // the one thing a correction must not do.
      draw(state.shown);
      schedule();
    },
    dispose() {
      cancel();
      watch(null);
    },
  };
}

/**
 * Types a live line in grapheme by grapheme, catching up by typing faster
 * rather than by jumping. See `@/lib/smooth-text-reveal` for the pacing.
 */
export function useSmoothTextReveal(
  target: string,
  options: { initialIntervalMs: number; holdWhileShorter?: boolean; maxGraphemesPerFrame?: number },
): UseSmoothTextReveal {
  const { initialIntervalMs, holdWhileShorter = false, maxGraphemesPerFrame } = options;
  const [shown, setShown] = useState(() =>
    typeof window !== 'undefined' && isInstant(window) ? target : '',
  );
  const [controller] = useState(() => createRevealController(setShown));

  // Stable for the component's life. A new callback each render would be called
  // with null and then the element every render, cancelling and rescheduling the
  // frame sixty times a second.
  const attach = useCallback(
    (element: HTMLElement | null) => controller.attach(element),
    [controller],
  );

  // A layout effect, so a revision's replacement lands in the same paint as the
  // commit that carried it. Ref callbacks run before layout effects, so the
  // element — and with it the right window — is already attached here.
  useLayoutEffect(() => {
    controller.setTarget(target, { initialIntervalMs, holdWhileShorter, maxGraphemesPerFrame });
  }, [controller, target, initialIntervalMs, holdWhileShorter, maxGraphemesPerFrame]);

  useEffect(() => () => controller.dispose(), [controller]);

  return { shown, attach };
}
