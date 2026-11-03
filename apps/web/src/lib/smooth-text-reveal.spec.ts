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

/** Fewest grapheme edits between two texts: what a frame visibly changed. */
function editDistance(from: string, to: string): number {
  const a = graphemes(from);
  const b = graphemes(to);
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        row[j]! + 1,
        next[j - 1]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length]!;
}

/** Graphemes visibly changed between each consecutive pair of `shown` values. */
const stepSizes = (steps: string[]) =>
  steps.slice(1).map((shown, i) => editDistance(steps[i]!, shown));

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
  it('erases a revised word where it stands and types its replacement', () => {
    // The recogniser's commonest revision: one early word changes, the rest stays.
    const state = revealed('mai mình đi học nhé', SOURCE);
    const revised = retarget(state, 'hai mình đi học nhé', 1000, SOURCE);
    // Nothing is swapped in the frame the revision arrives.
    expect(revised.shown).toBe('mai mình đi học nhé');
    expect(backlog(revised)).toBe(6);
    const { state: done, shownAfterEachStep } = drain(revised, 1000);
    expect(done.shown).toBe('hai mình đi học nhé');
    // The words that agree never move, and the wrong word is gone before the
    // right one starts.
    for (const shown of shownAfterEachStep) expect(shown.endsWith(' mình đi học nhé')).toBe(true);
    const heads = shownAfterEachStep.map((shown) => shown.slice(0, -' mình đi học nhé'.length));
    expect(heads.some((head) => head === '')).toBe(true);
    expect(stepSizes([state.shown, ...shownAfterEachStep]).every((n) => n <= 3)).toBe(true);
  });

  it('types only what a revision adds, erasing nothing', () => {
    const state = revealed('xin chào bạn', SOURCE);
    const revised = retarget(state, 'xin chào các bạn', 1000, SOURCE);
    expect(revised.shown).toBe('xin chào bạn');
    const { state: done, shownAfterEachStep } = drain(revised, 1000);
    expect(done.shown).toBe('xin chào các bạn');
    const lengths = shownAfterEachStep.map((shown) => graphemes(shown).length);
    lengths.forEach((length, i) => expect(length).toBeGreaterThanOrEqual(lengths[i - 1] ?? 12));
  });

  it('keeps a word still being typed instead of erasing it', () => {
    let state = retarget(createRevealState(SOURCE, 0), 'xin chào', 0, SOURCE);
    state = stepReveal(stepReveal(state, FRAME, FRAME), 2 * FRAME, FRAME);
    while (graphemes(state.shown).length < 7) state = stepReveal(state, 3 * FRAME, FRAME);
    const midWord = state.shown;
    const extended = retarget(state, 'xin chào bạn', 100, SOURCE);
    const { shownAfterEachStep } = drain(extended, 100);
    for (const shown of shownAfterEachStep) expect(shown.startsWith(midWord)).toBe(true);
  });

  it('holds a translation while the new one is shorter, and morphs once it catches up', () => {
    const state = revealed('Hello my friend', TRANSLATION);
    const held = retarget(state, 'Hi', 1000, TRANSLATION);
    expect(held.shown).toBe('Hello my friend');
    expect(backlog(held)).toBe(0);
    const caughtUp = retarget(held, 'Hi there my good friend', 1100, TRANSLATION);
    expect(caughtUp.shown).toBe('Hello my friend');
    const { state: done, shownAfterEachStep } = drain(caughtUp, 1100);
    expect(done.shown).toBe('Hi there my good friend');
    // ` my ` and `friend` agree, so they stay on screen throughout.
    for (const shown of shownAfterEachStep) expect(shown).toMatch(/ my .*friend$/);
  });

  it('erases a held translation down to the new one once it stops arriving', () => {
    const held = retarget(revealed('Hello my friend', TRANSLATION), 'Hi', 1000, TRANSLATION);
    expect(needsFrame(held)).toBe(true);
    expect(stepReveal(held, 1000 + REVEAL_HOLD_IDLE_RELEASE_MS - 10, FRAME).shown).toBe(
      'Hello my friend',
    );
    const released = stepReveal(held, 1000 + REVEAL_HOLD_IDLE_RELEASE_MS, FRAME);
    expect(released.pending).toBeNull();
    expect(released.shown).not.toBe('Hi');
    const { state: done } = drain(released, 1000 + REVEAL_HOLD_IDLE_RELEASE_MS);
    expect(done.shown).toBe('Hi');
    expect(needsFrame(done)).toBe(false);
  });

  it('ignores a repeat of the held target', () => {
    const held = retarget(revealed('Hello my friend', TRANSLATION), 'Hi', 1000, TRANSLATION);
    expect(retarget(held, 'Hi', 1200, TRANSLATION)).toBe(held);
  });

  it('does not hold the source line: a shorter reading is erased back to', () => {
    const state = revealed('Hello my friend', SOURCE);
    const shorter = retarget(state, 'Hello', 1000, SOURCE);
    expect(shorter.shown).toBe('Hello my friend');
    const { state: done, shownAfterEachStep } = drain(shorter, 1000);
    expect(done.shown).toBe('Hello');
    for (const shown of shownAfterEachStep) expect('Hello my friend'.startsWith(shown)).toBe(true);
  });

  it('erases the line on an empty target, even while holding', () => {
    const state = revealed('Hello my friend', TRANSLATION);
    const held = retarget(state, 'Hi', 900, TRANSLATION);
    const cleared = retarget(held, '', 1000, TRANSLATION);
    expect(cleared.shown).toBe('Hello my friend');
    expect(cleared.pending).toBeNull();
    const { state: done, shownAfterEachStep } = drain(cleared, 1000);
    expect(done.shown).toBe('');
    expect(shownAfterEachStep.length).toBeGreaterThan(3);
    for (const shown of shownAfterEachStep) expect('Hello my friend'.startsWith(shown)).toBe(true);
  });

  it('re-plans from what is on screen when a new target lands mid-change', () => {
    const target = 'Tiếng Việt rất hay'.normalize('NFD');
    let state = retarget(revealed('Hôm nay trời đẹp'.normalize('NFD'), SOURCE), target, 0, SOURCE);
    state = stepReveal(state, FRAME, FRAME);
    state = stepReveal(state, 2 * FRAME, FRAME);
    const next = 'Tiếng Việt rất là hay'.normalize('NFD');
    const { state: done, shownAfterEachStep } = drain(retarget(state, next, 40, SOURCE), 40);
    expect(done.shown).toBe(next);
    for (const shown of shownAfterEachStep) expect(graphemes(shown).join('')).toBe(shown);
    for (const shown of shownAfterEachStep) {
      // No bare combining mark: every grapheme starts with a base character.
      for (const g of graphemes(shown)) expect(/^\p{M}/u.test(g)).toBe(false);
    }
  });

  it('finishes a settled line within its time bound, typing faster to do it', () => {
    const options: RevealOptions = { ...TRANSLATION, holdWhileShorter: false, maxMorphMs: 800 };
    const before = 'one two three four five six seven eight nine ten '.repeat(6).trim();
    const after = 'uno dos tres cuatro cinco seis siete ocho nueve diez '.repeat(6).trim();
    const state = retarget(revealed(before, options), after, 5000, options);
    const { state: done, shownAfterEachStep } = drain(state, 5000);
    expect(done.shown).toBe(after);
    expect(shownAfterEachStep.length * FRAME).toBeLessThanOrEqual(800 + FRAME);
  });

  it('keeps the live ceiling on a line without a time bound', () => {
    const before = 'one two three four five six seven eight nine ten '.repeat(6).trim();
    const after = 'uno dos tres cuatro cinco seis siete ocho nueve diez '.repeat(6).trim();
    const state = retarget(revealed(before, SOURCE), after, 5000, SOURCE);
    const { shownAfterEachStep } = drain(state, 5000);
    expect(Math.max(...stepSizes([before, ...shownAfterEachStep]))).toBeLessThanOrEqual(3);
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
