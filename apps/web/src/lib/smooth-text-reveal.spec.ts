import { describe, expect, it } from 'vitest';
import {
  backlog,
  needsFrame,
  REVEAL_HOLD_IDLE_RELEASE_MS,
  createRevealState,
  graphemes,
  retarget,
  stepReveal,
  type RevealOptions,
  type RevealState,
} from './smooth-text-reveal';

const FRAME = 16.67;
const SOURCE: RevealOptions = { initialIntervalMs: 300, holdWhileShorter: false };
const TRANSLATION: RevealOptions = { initialIntervalMs: 120, holdWhileShorter: true };

/** Steps until nothing is owed, returning every intermediate `shown`. */
function drain(start: RevealState, from: number, frameMs = FRAME, maxFrames = 1000) {
  let state = start;
  let now = from;
  const shownAfterEachStep: string[] = [];
  for (let i = 0; i < maxFrames && backlog(state) > 0; i++) {
    now += frameMs;
    state = stepReveal(state, now, frameMs);
    shownAfterEachStep.push(state.shown);
  }
  return { state, now, shownAfterEachStep };
}

/** A state whose whole target is already on screen. */
function revealed(text: string, options: RevealOptions): RevealState {
  return drain(retarget(createRevealState(options, 0), text, 0, options), 0).state;
}

const graphemeSteps = (steps: string[]) =>
  steps.map(
    (shown, i) => graphemes(shown).length - (i === 0 ? 0 : graphemes(steps[i - 1]!).length),
  );

describe('graphemes', () => {
  it('counts a Vietnamese letter with its marks as one, composed or not', () => {
    expect(graphemes('Việt')).toHaveLength(4);
    expect(graphemes('Việt')).toHaveLength(4);
  });
});

describe('stepReveal', () => {
  it('types a new line in a few graphemes per frame, always a prefix of the target', () => {
    const target = 'hello world';
    const { state, shownAfterEachStep } = drain(
      retarget(createRevealState(SOURCE, 0), target, 0, SOURCE),
      0,
    );
    expect(state.shown).toBe(target);
    for (const shown of shownAfterEachStep) expect(target.startsWith(shown)).toBe(true);
    expect(Math.max(...graphemeSteps(shownAfterEachStep))).toBeLessThanOrEqual(3);
    expect(graphemeSteps(shownAfterEachStep).every((n) => n >= 0)).toBe(true);
  });

  it('catches up by typing faster, never by jumping', () => {
    const long = 'a'.repeat(100);
    const first = drain(retarget(createRevealState(SOURCE, 0), long, 0, SOURCE), 0);
    const steps = graphemeSteps(first.shownAfterEachStep);
    expect(steps.every((n) => n >= 0 && n <= 3)).toBe(true);
    // Never stalls: the 25 graphemes/s floor is 0.42 per frame, so a frame can
    // add nothing, but any three in a row add at least one.
    for (let i = 0; i + 3 <= steps.length; i++) {
      expect(steps[i]! + steps[i + 1]! + steps[i + 2]!).toBeGreaterThan(0);
    }
    expect(first.shownAfterEachStep.length).toBeLessThanOrEqual(45);

    // A later update arriving with nothing pending is spread over about one interval.
    const at = first.now + 600;
    const extended = retarget(first.state, long + 'b'.repeat(20), at, SOURCE);
    const second = drain(extended, at);
    expect(second.state.shown).toBe(long + 'b'.repeat(20));
    expect(
      Math.max(...graphemeSteps([first.state.shown, ...second.shownAfterEachStep]).slice(1)),
    ).toBeLessThanOrEqual(3);
    expect(second.shownAfterEachStep.length).toBeLessThanOrEqual(
      Math.ceil(extended.intervalMs / FRAME) + 5,
    );
  });

  it('allows more per frame only in proportion to a slower frame', () => {
    const { shownAfterEachStep } = drain(
      retarget(createRevealState(SOURCE, 0), 'a'.repeat(100), 0, SOURCE),
      0,
      50,
    );
    expect(Math.max(...graphemeSteps(shownAfterEachStep))).toBeLessThanOrEqual(9);
  });

  it('lets a line be given a higher per-frame ceiling', () => {
    const options: RevealOptions = { ...TRANSLATION, maxGraphemesPerFrame: 4 };
    const { shownAfterEachStep } = drain(
      retarget(createRevealState(options, 0), 'a'.repeat(100), 0, options),
      0,
    );
    const steps = graphemeSteps(shownAfterEachStep);
    expect(Math.max(...steps)).toBe(4);
  });

  it('never shows a base letter without the marks that belong to it', () => {
    const target = 'Tiếng Việt rất hay'.normalize('NFD');
    const targetGraphemes = graphemes(target);
    const { shownAfterEachStep } = drain(
      retarget(createRevealState(SOURCE, 0), target, 0, SOURCE),
      0,
    );
    for (const shown of shownAfterEachStep) {
      const shownGraphemes = graphemes(shown);
      expect(shownGraphemes.join('')).toBe(shown);
      shownGraphemes.forEach((g, i) => expect(g).toBe(targetGraphemes[i]));
    }
  });
});

describe('retarget', () => {
  it('replaces a revised word in place instead of retyping the line', () => {
    // The recogniser's commonest revision: one early word changes, the rest stays.
    const state = revealed('mai mình đi học nhé', SOURCE);
    const revised = retarget(state, 'hai mình đi học nhé', 1000, SOURCE);
    expect(revised.shown).toBe('hai mình đi học nhé');
    expect(backlog(revised)).toBe(0);
  });

  it('types only what a revision adds beyond what was on screen', () => {
    const state = revealed('xin chào bạn', SOURCE);
    const revised = retarget(state, 'xin chào các bạn', 1000, SOURCE);
    expect(revised.shown).toBe('xin chào các');
    expect(drain(revised, 1000).state.shown).toBe('xin chào các bạn');
  });

  it('holds a translation while the new one is shorter, and swaps once it catches up', () => {
    const state = revealed('Hello my friend', TRANSLATION);
    const held = retarget(state, 'Hi', 1000, TRANSLATION);
    expect(held.shown).toBe('Hello my friend');
    expect(backlog(held)).toBe(0);
    const caughtUp = retarget(held, 'Hi there my good friend', 1100, TRANSLATION);
    expect(caughtUp.shown).toBe('Hi there my goo');
    expect(drain(caughtUp, 1100).state.shown).toBe('Hi there my good friend');
  });

  it('releases a held translation once the new one stops arriving', () => {
    const held = retarget(revealed('Hello my friend', TRANSLATION), 'Hi', 1000, TRANSLATION);
    expect(needsFrame(held)).toBe(true);
    expect(stepReveal(held, 1000 + REVEAL_HOLD_IDLE_RELEASE_MS - 10, FRAME).shown).toBe(
      'Hello my friend',
    );
    const released = stepReveal(held, 1000 + REVEAL_HOLD_IDLE_RELEASE_MS, FRAME);
    expect(released.shown).toBe('Hi');
    expect(needsFrame(released)).toBe(false);
  });

  it('ignores a repeat of the held target', () => {
    const held = retarget(revealed('Hello my friend', TRANSLATION), 'Hi', 1000, TRANSLATION);
    expect(retarget(held, 'Hi', 1200, TRANSLATION)).toBe(held);
  });

  it('does not hold the source line: a shorter reading is a real correction', () => {
    const state = revealed('Hello my friend', SOURCE);
    expect(retarget(state, 'Hello', 1000, SOURCE).shown).toBe('Hello');
  });

  it('clears at once on an empty target, even while holding', () => {
    const state = revealed('Hello my friend', TRANSLATION);
    expect(retarget(state, '', 1000, TRANSLATION).shown).toBe('');
  });

  it('returns the same state for the same target', () => {
    const state = revealed('Hello', SOURCE);
    expect(retarget(state, 'Hello', 1000, SOURCE)).toBe(state);
  });

  it('learns a faster cadence from updates that arrive faster', () => {
    let state = retarget(createRevealState(SOURCE, 0), 'a', 0, SOURCE);
    state = retarget(state, 'ab', 100, SOURCE);
    state = retarget(state, 'abc', 200, SOURCE);
    state = retarget(state, 'abcd', 300, SOURCE);
    expect(state.intervalMs).toBeLessThan(300);
  });
});
