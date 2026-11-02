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
   * For the translation line: while a new target is SHORTER than what is shown,
   * keep showing what is shown. A new provisional translation streams in from its
   * first token, so for most of its life it is shorter than the one on screen —
   * and drawing it as it grows would cut the line back to a few words and regrow
   * it, which is the blank this exists to remove. The held text is released when
   * the new one catches up, or when it stops arriving: then it is finished and
   * genuinely shorter, and it is the truth.
   */
  holdWhileShorter: boolean;
  /**
   * Most graphemes one 60 Hz frame may add; scaled by frame length. Defaults to
   * {@link REVEAL_MAX_GRAPHEMES_PER_FRAME}. The translation line is given 4: its
   * text arrives a sentence at a time, and at 3 it trailed by 400 ms at p95
   * against 283 ms at 4 on a real conversation — the user chose 4.
   */
  maxGraphemesPerFrame?: number;
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
  /** A held target, waiting to catch up with what is shown. */
  pending: string | null;
  /** Per-frame ceiling, fixed for the line's life. */
  maxGraphemesPerFrame: number;
}

/** Slowest rate, so a trickle of text still moves visibly. */
export const REVEAL_FLOOR_GRAPHEMES_PER_SECOND = 25;
/** Per 60 Hz frame (16.67 ms); scaled by frame length for slower windows. ≈180/s. */
export const REVEAL_MAX_GRAPHEMES_PER_FRAME = 3;
/** Never plan to drain the backlog faster than this, so a late update speeds up instead of jumping. */
export const REVEAL_MIN_DRAIN_MS = 100;
/**
 * Aim to finish typing an update within this share of the expected interval.
 * At the whole interval the source line trailed by 383 ms at p95 on a real
 * conversation; at 0.7 it is 300 ms, still within three graphemes a frame.
 */
export const REVEAL_DRAIN_FRACTION = 0.7;
export const REVEAL_INTERVAL_MIN_MS = 50;
export const REVEAL_INTERVAL_MAX_MS = 1000;
/** Weight of the newest interval sample. */
export const REVEAL_EMA_WEIGHT = 0.3;
/**
 * A held translation is released after this long without an update: three to
 * four of the provisional translation's ~100 ms cadences, so a stream still
 * arriving is not cut off mid-way, but a finished shorter one is not held long.
 */
export const REVEAL_HOLD_IDLE_RELEASE_MS = 400;

const SIXTY_HZ_FRAME_MS = 16.67;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The user-perceived characters of `text`, unnormalized, joining back to `text`. */
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/**
 * What to show once the target becomes `next`: as much of `next` as was already
 * on screen, so revised words are REPLACED in place and only new text is typed.
 *
 * Not the common prefix. Measured on a real conversation, 88 of 144 revisions
 * changed one word near the start of the line and left the rest as it was;
 * cutting back to the first difference blanked the line and retyped it, and put
 * the source line 3.8 s behind at p95. The recogniser substitutes, it does not
 * retract, so a substitution is drawn as one.
 */
function substituted(shown: string, next: string): string {
  const nextGraphemes = graphemes(next);
  return nextGraphemes.slice(0, Math.min(graphemes(shown).length, nextGraphemes.length)).join('');
}

/** Whether the reveal still has work to do on later frames. */
export function needsFrame(state: RevealState): boolean {
  return state.pending !== null || backlog(state) > 0;
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
    pending: null,
    maxGraphemesPerFrame: options.maxGraphemesPerFrame ?? REVEAL_MAX_GRAPHEMES_PER_FRAME,
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
  if (next === (state.pending ?? state.target)) return state;
  // An empty piece is how the server withdraws a translation of words that were
  // taken back, so it always clears, held or not.
  if (next === '') return { ...state, shown: '', target: '', carry: 0, pending: null };

  // The first text after an empty line opens a new run; the gap before it is
  // silence, not a cadence.
  const intervalMs =
    state.target === ''
      ? state.intervalMs
      : (1 - REVEAL_EMA_WEIGHT) * state.intervalMs +
        REVEAL_EMA_WEIGHT *
          clamp(now - state.lastTargetAt, REVEAL_INTERVAL_MIN_MS, REVEAL_INTERVAL_MAX_MS);

  if (options.holdWhileShorter && graphemes(next).length < graphemes(state.shown).length) {
    // Bounded twice over: released by `stepReveal` once the stream goes quiet,
    // and the finished turn replaces the live line in any case.
    return { ...state, target: state.shown, pending: next, lastTargetAt: now, intervalMs };
  }

  // A revision replaces the words that changed at once, in place — typing them
  // would animate text being read and show the wrong word for longer — and only
  // what is new types forward.
  return {
    ...state,
    shown: substituted(state.shown, next),
    target: next,
    pending: null,
    lastTargetAt: now,
    intervalMs,
  };
}

/**
 * Advance by one frame. The rate is the backlog over the time left before the
 * next update is expected, so a line normally finishes typing just as new text
 * arrives — and one that is behind speeds up, capped per frame.
 */
export function stepReveal(current: RevealState, now: number, frameMs: number): RevealState {
  let state = current;
  if (state.pending !== null && now - state.lastTargetAt >= REVEAL_HOLD_IDLE_RELEASE_MS) {
    // The new translation stopped arriving while still shorter: it is finished,
    // and holding the old one any longer would show a guess it has replaced.
    state = {
      ...state,
      shown: substituted(state.shown, state.pending),
      target: state.pending,
      pending: null,
    };
  }
  const owed = backlog(state);
  if (owed === 0) return state;

  const timeLeft = Math.max(
    state.intervalMs * REVEAL_DRAIN_FRACTION - (now - state.lastTargetAt),
    REVEAL_MIN_DRAIN_MS,
  );
  const rate = Math.max((owed / timeLeft) * 1000, REVEAL_FLOOR_GRAPHEMES_PER_SECOND);
  let carry = state.carry + (rate * frameMs) / 1000;
  let count = Math.floor(carry);
  carry -= count;
  const perFrameCap = Math.max(
    1,
    Math.round((state.maxGraphemesPerFrame * frameMs) / SIXTY_HZ_FRAME_MS),
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
