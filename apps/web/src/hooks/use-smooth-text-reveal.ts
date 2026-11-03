'use client';

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useState } from 'react';
import {
  needsFrame,
  createRevealState,
  retarget,
  settledAt,
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
  /** Treat `text` as what is on screen, so the next target morphs from it. */
  reseed(text: string, options: RevealOptions): void;
  dispose(): void;
}

export interface SmoothTextRevealOptions {
  initialIntervalMs: number;
  holdWhileShorter?: boolean;
  maxGraphemesPerFrame?: number;
  /** See {@link RevealOptions.maxMorphMs}. */
  maxMorphMs?: number;
  /**
   * Draw the first text this line is given whole, with no reveal. For a
   * finished line: it is typed only when it CHANGES, so a transcript that
   * mounts full — reopened, scrolled back, or remounted — is not retyped.
   */
  instantInitial?: boolean;
  /**
   * Asked whenever the target changes, before the change is planned: a text to
   * treat as on screen instead, or `null` to morph from what is. This is how a
   * finished line takes over from the live line it replaces — it starts from the
   * words the reader was looking at, not from nothing.
   */
  seed?: (target: string, shown: string) => string | null;
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
function createRevealController(
  draw: (shown: string) => void,
  instantInitial: boolean,
): RevealController {
  let element: HTMLElement | null = null;
  // Spent by the first non-empty target, or by a seed, whichever comes first.
  let instantNext = instantInitial;
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
    state = settledAt(state, state.pending ?? state.target);
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
      if (instantNext && target !== '') {
        instantNext = false;
        snap();
        return;
      }
      if (isInstant(current)) {
        snap();
        return;
      }
      schedule();
    },
    reseed(text, options) {
      const current = view();
      if (!current) return;
      instantNext = false;
      state = settledAt(state ?? createRevealState(options, current.performance.now()), text);
      draw(text);
    },
    dispose() {
      cancel();
      watch(null);
    },
  };
}

/**
 * Types a transcript line in and morphs it on every change, grapheme by grapheme,
 * catching up by typing faster rather than by jumping. See `@/lib/smooth-text-reveal`.
 */
export function useSmoothTextReveal(
  target: string,
  options: SmoothTextRevealOptions,
): UseSmoothTextReveal {
  const {
    initialIntervalMs,
    holdWhileShorter = false,
    maxGraphemesPerFrame,
    maxMorphMs,
    instantInitial = false,
    seed,
  } = options;
  const [shown, setShown] = useState(() =>
    instantInitial || (typeof window !== 'undefined' && isInstant(window)) ? target : '',
  );
  const [controller] = useState(() => createRevealController(setShown, instantInitial));
  // An effect event, so a new `seed` closure each render neither re-runs the
  // layout effect below nor is read stale by it.
  const seedFor = useEffectEvent((next: string): string | null => seed?.(next, shown) ?? null);

  // Stable for the component's life. A new callback each render would be called
  // with null and then the element every render, cancelling and rescheduling the
  // frame sixty times a second.
  const attach = useCallback(
    (element: HTMLElement | null) => controller.attach(element),
    [controller],
  );

  // A layout effect, so a seed lands before the first paint of a new target.
  // Ref callbacks run before layout effects, so the element — and with it the
  // right window — is already attached here.
  useLayoutEffect(() => {
    const revealOptions = { initialIntervalMs, holdWhileShorter, maxGraphemesPerFrame, maxMorphMs };
    const seeded = seedFor(target);
    if (seeded !== null) controller.reseed(seeded, revealOptions);
    controller.setTarget(target, revealOptions);
  }, [controller, target, initialIntervalMs, holdWhileShorter, maxGraphemesPerFrame, maxMorphMs]);

  useEffect(() => () => controller.dispose(), [controller]);

  return { shown, attach };
}
