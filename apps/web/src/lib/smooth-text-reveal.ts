/**
 * Paces how a transcript line changes on screen, one grapheme at a time.
 *
 * The server does not deliver a live line smoothly, and nothing upstream can make
 * it: the recogniser re-reads the whole utterance every ~300ms and each reading
 * adds one to three words at once, and every new provisional translation starts
 * again from its first token. Drawn as they arrive, the source line moves in word
 * jumps and the translation blanks and regrows. This module spreads each jump over
 * the frames until the next one is expected.
 *
 * Every change is drawn as typing. New text is typed in; a revised word is
 * erased where it stands and its replacement typed in its place; text that goes
 * away is erased. The user asked for that on 03/11/2026, after the first version
 * swapped revised words in a single frame and the swap read as the line jumping.
 * Which graphemes to erase and type is `text-morph-diff.ts`; how fast is this
 * module.
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

import {
  applyMorphSteps,
  graphemes,
  morphSegments,
  morphSteps,
  type MorphSegment,
} from './text-morph-diff';

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
  /**
   * For a FINISHED line: every change completes within this many ms, typing
   * faster than the per-frame ceiling if it has to. A settled line is rewritten
   * while somebody is reading it — its polished translation, or a block
   * retranslated whole about a second after it finished — and a long block typed
   * at the live line's ceiling would keep it moving for seconds. The user chose
   * a time bound over both (03/11/2026). Unset on live lines.
   */
  maxMorphMs?: number;
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
  /** Time bound on one change, for a finished line; `null` on a live line. */
  maxMorphMs: number | null;
  /**
   * The erase-and-type script from what was on screen when the target last
   * changed, and how many of its steps are done; `shown` is always the script
   * played that far.
   *
   * Planned once per change rather than re-diffed every frame: half-erased words
   * align differently from whole ones, so a fresh diff each frame could change
   * its mind mid-word and erase text it had just typed.
   */
  plan: MorphSegment[];
  planSteps: number;
  planDone: number;
}

/** `state` now heading for `target`, scripted from what is on screen. */
function planned(state: RevealState, target: string): RevealState {
  const plan = morphSegments(state.shown, target);
  return { ...state, target, plan, planSteps: morphSteps(plan), planDone: 0 };
}

/** `state` showing `text` with nothing left to do. */
export function settledAt(state: RevealState, text: string): RevealState {
  return {
    ...state,
    shown: text,
    target: text,
    pending: null,
    carry: 0,
    plan: [],
    planSteps: 0,
    planDone: 0,
  };
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

/** Re-exported: callers count graphemes the same way the morph does. */
export { graphemes };

/** Whether the reveal still has work to do on later frames. */
export function needsFrame(state: RevealState): boolean {
  return state.pending !== null || backlog(state) > 0;
}

/** Graphemes still to erase or type before what is shown reads as the target. */
export function backlog(state: RevealState): number {
  return state.planSteps - state.planDone;
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
    maxMorphMs: options.maxMorphMs ?? null,
    plan: [],
    planSteps: 0,
    planDone: 0,
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
  // taken back, so it is never held: the line is erased.
  if (next === '') return { ...planned(state, ''), pending: null, lastTargetAt: now };

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
    // and the finished turn replaces the live line in any case. A change already
    // under way carries on: freezing it would leave a half-erased word standing.
    return { ...state, pending: next, lastTargetAt: now, intervalMs };
  }

  // Nothing changes on screen yet: the frames erase the words that changed and
  // type their replacements, leaving every word that still agrees where it is.
  return { ...planned(state, next), pending: null, lastTargetAt: now, intervalMs };
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
    // Its own change, so a finished line's time bound starts here.
    state = { ...planned(state, state.pending), pending: null, lastTargetAt: now };
  }
  const owed = backlog(state);
  if (owed === 0) return state;

  const elapsed = now - state.lastTargetAt;
  let timeLeft = Math.max(state.intervalMs * REVEAL_DRAIN_FRACTION - elapsed, REVEAL_MIN_DRAIN_MS);
  // A finished line must be done by its bound, so the bound shortens the plan
  // and, below, lifts the ceiling — down to the last frame, never past it.
  const boundLeft = state.maxMorphMs === null ? null : state.maxMorphMs - elapsed;
  if (boundLeft !== null) timeLeft = Math.max(Math.min(timeLeft, boundLeft), frameMs);
  const rate = Math.max((owed / timeLeft) * 1000, REVEAL_FLOOR_GRAPHEMES_PER_SECOND);
  let carry = state.carry + (rate * frameMs) / 1000;
  let count = Math.floor(carry);
  carry -= count;
  const ceiling = Math.max(
    1,
    Math.round((state.maxGraphemesPerFrame * frameMs) / SIXTY_HZ_FRAME_MS),
  );
  const perFrameCap =
    boundLeft === null
      ? ceiling
      : Math.max(ceiling, Math.ceil(owed / Math.max(1, Math.floor(boundLeft / frameMs))));
  // The excess is dropped rather than banked: banked, it would come out as a
  // jump on the next frame.
  if (count > perFrameCap) {
    count = perFrameCap;
    carry = 0;
  }
  count = Math.min(count, owed);
  if (count === 0) return { ...state, carry };

  const planDone = state.planDone + count;
  const shown = applyMorphSteps(state.plan, planDone);
  return { ...state, shown, planDone, carry: planDone === state.planSteps ? 0 : carry };
}
