import { claimLiveLine, type LiveLineRegistry } from '@/components/translate/live-line-handoff';

/** `duration.slow` on `easing.enter`: the settled-line entrance in `docs/design-guidelines.md`. */
const ENTRANCE = 'transform 320ms cubic-bezier(0, 0, 0, 1)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const entered = new WeakSet<Element>();

/**
 * Slide a just-finished turn in from where its live line was painted.
 *
 * The finished turn is a new list item beside the live region — above it oldest
 * first, below it newest first — with a meta row the live line never had, so it
 * does not land exactly where the reader was looking. This starts it there and lets it settle into place: one transform,
 * the only entrance a settled line is allowed.
 *
 * Meant for a ref callback. Runs once per element, so a parent re-render that
 * hands React a new callback never replays it, and only for a turn whose OWN
 * live line just ended — a turn that mounts for any other reason stays still.
 *
 * In a microtask, for the same reason the live line measures itself in one: the
 * scroller pins the view after this element's layout effects, and the box to
 * compare is the one about to be painted.
 */
export function flipFromLiveLine(
  element: HTMLElement | null,
  registry: LiveLineRegistry | null,
  sessionIds: readonly string[],
): void {
  if (!element || entered.has(element)) return;
  entered.add(element);
  queueMicrotask(() => {
    const view = element.ownerDocument.defaultView;
    if (!view || !element.isConnected) return;
    // The page's clock, not the drawing window's: the live line stamped its end
    // with it, and a caption window's clock starts when that window opened.
    const snapshot = claimLiveLine(registry, sessionIds, 'position', performance.now(), {
      ownLineOnly: true,
    });
    if (!snapshot?.rect) return;
    if (view.matchMedia?.(REDUCED_MOTION).matches || element.ownerDocument.hidden) return;
    // Bottom edges, because both boxes end in the sentence: the live line is
    // only its text, and the finished turn puts its meta row ABOVE its text.
    const offset = snapshot.rect.bottom - element.getBoundingClientRect().bottom;
    if (Math.abs(offset) < 2) return;
    element.style.transition = 'none';
    element.style.transform = `translateY(${offset}px)`;
    // Read back so the starting position is committed before the transition.
    element.getBoundingClientRect();
    view.requestAnimationFrame(() => {
      element.style.transition = ENTRANCE;
      element.style.transform = '';
    });
    // Children's transitions bubble here too; only this element's own slide
    // ending may clear it, or a chip's hover would cut the slide short.
    const onEnd = (event: TransitionEvent) => {
      if (event.target !== element) return;
      element.style.transition = '';
      element.removeEventListener('transitionend', onEnd);
    };
    element.addEventListener('transitionend', onEnd);
  });
}
