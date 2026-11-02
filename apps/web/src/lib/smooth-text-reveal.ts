/**
 * Paces how much of a live line is on screen, one grapheme at a time.
 *
 * The server does not deliver a live line smoothly, and nothing upstream can make
 * it: the recogniser re-reads the whole utterance every ~300ms and each reading
 * adds one to three words at once, and every new provisional translation starts
 * again from its first token. Drawn as they arrive, the source line moves in word
 * jumps and the translation blanks and regrows. This module spreads each jump over
 * the frames until the next one is expected.
 *
 * Two promises shape every rule below:
 *
 * - **It never jumps.** A line that has fallen behind types faster, up to a fixed
 *   number of graphemes per frame, rather than showing the rest at once. Showing
 *   the rest at once is exactly the jump this exists to remove. That was the
 *   user's call, over an earlier draft that snapped past a backlog cap.
 * - **It never draws a partial grapheme.** Vietnamese is often decomposed, so a
 *   step counted in UTF-16 units would show a bare `e` a frame before its tone
 *   mark. Everything here is counted in graphemes and sliced on their boundaries.
 *
 * Pure and DOM-free on purpose: the hook drives it on animation frames, and the
 * measurement replay drives it on a simulated clock from plain `tsx`.
 */

export interface RevealOptions {
  /** Expected ms between target updates, before any has been measured. */
  initialIntervalMs: number;
  /**
   * For the translation line: while a new target is a strict prefix of what is
   * shown, keep showing it. A new provisional translation streams in from its
   * first token, and its opening words usually match the previous one's — so the
   * previous text is still true until the new one says something different.
   */
  holdWhilePrefix: boolean;
}

export interface RevealState {
  /** What is on screen. Always ends on a grapheme boundary. */
  shown: string;
  /** What `shown` is converging to. */
  target: string;
  /** When the target last changed, in ms. */
  lastTargetAt: number;
  /** Moving average of ms between target changes. */
  intervalMs: number;
  /** Fractional graphemes owed from earlier frames. */
  carry: number;
}

/** Slowest rate, so a trickle of text still moves visibly. */
export const REVEAL_FLOOR_GRAPHEMES_PER_SECOND = 25;
/** Per 60 Hz frame (16.67 ms); scaled by frame length for slower windows. ≈180/s. */
export const REVEAL_MAX_GRAPHEMES_PER_FRAME = 3;
/** Never plan to drain the backlog faster than this, so a late update speeds up instead of jumping. */
export const REVEAL_MIN_DRAIN_MS = 100;
export const REVEAL_INTERVAL_MIN_MS = 50;
export const REVEAL_INTERVAL_MAX_MS = 1000;
/** Weight of the newest interval sample. */
export const REVEAL_EMA_WEIGHT = 0.3;

const SIXTY_HZ_FRAME_MS = 16.67;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The user-perceived characters of `text`, unnormalized, joining back to `text`. */
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** The longest run of leading graphemes `a` and `b` share. */
export function commonGraphemePrefix(a: string, b: string): string {
  const left = graphemes(a);
  const right = graphemes(b);
  let prefix = '';
  for (let i = 0; i < right.length && left[i] === right[i]; i++) prefix += right[i];
  return prefix;
}

/** Graphemes of the target not yet on screen. */
export function backlog(state: RevealState): number {
  if (!state.target.startsWith(state.shown)) return graphemes(state.target).length;
  return graphemes(state.target.slice(state.shown.length)).length;
}

export function createRevealState(options: RevealOptions, now: number): RevealState {
  return {
    shown: '',
    target: '',
    lastTargetAt: now,
    intervalMs: options.initialIntervalMs,
    carry: 0,
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Point the reveal at a new target. Called once per server update.
 *
 * The interval is learned from update arrivals, not configured: Vietnamese and
 * English read at different speeds, and a constant tuned for one would be wrong
 * for the other.
 */
export function retarget(
  state: RevealState,
  next: string,
  now: number,
  options: RevealOptions,
): RevealState {
  if (next === state.target) return state;
  // An empty piece is how the server withdraws a translation of words that were
  // taken back, so it always clears, held or not.
  if (next === '') return { ...state, shown: '', target: '', carry: 0 };

  // The first text after an empty line opens a new run; the gap before it is
  // silence, not a cadence.
  const intervalMs =
    state.target === ''
      ? state.intervalMs
      : (1 - REVEAL_EMA_WEIGHT) * state.intervalMs +
        REVEAL_EMA_WEIGHT *
          clamp(now - state.lastTargetAt, REVEAL_INTERVAL_MIN_MS, REVEAL_INTERVAL_MAX_MS);

  if (options.holdWhilePrefix && state.shown.startsWith(next) && next.length < state.shown.length) {
    // Hold until the new translation diverges. Bounded: the finished turn
    // replaces the live line, so a held guess cannot outlive its sentence.
    return { ...state, target: state.shown, lastTargetAt: now, intervalMs };
  }

  // A revision: what no longer agrees disappears at once — animating a deletion
  // would show retracted words for longer — and the new text types forward.
  const shown = commonGraphemePrefix(state.shown, next);
  return { ...state, shown, target: next, lastTargetAt: now, intervalMs };
}

/**
 * Advance by one frame. The rate is the backlog over the time left before the
 * next update is expected, so a line normally finishes typing just as new text
 * arrives — and one that is behind speeds up, capped per frame.
 */
export function stepReveal(state: RevealState, now: number, frameMs: number): RevealState {
  const owed = backlog(state);
  if (owed === 0) return state;

  const timeLeft = Math.max(state.intervalMs - (now - state.lastTargetAt), REVEAL_MIN_DRAIN_MS);
  const rate = Math.max((owed / timeLeft) * 1000, REVEAL_FLOOR_GRAPHEMES_PER_SECOND);
  let carry = state.carry + (rate * frameMs) / 1000;
  let count = Math.floor(carry);
  carry -= count;
  const perFrameCap = Math.max(
    1,
    Math.round((REVEAL_MAX_GRAPHEMES_PER_FRAME * frameMs) / SIXTY_HZ_FRAME_MS),
  );
  // The excess is dropped rather than banked: banked, it would come out as a
  // jump on the next frame.
  if (count > perFrameCap) {
    count = perFrameCap;
    carry = 0;
  }
  count = Math.min(count, owed);
  if (count === 0) return { ...state, carry };

  const added = graphemes(state.target.slice(state.shown.length)).slice(0, count).join('');
  const shown = state.shown + added;
  return { ...state, shown, carry: shown === state.target ? 0 : carry };
}
