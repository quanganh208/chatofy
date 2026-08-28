import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@chatofy/types';
import {
  groupIsRepaired,
  groupRawSourceText,
  groupSourceText,
  groupTargetText,
  groupTurnsForDisplay,
  type DisplayGroup,
} from './display-groups.js';
import type { CapturesBySession } from './turn-keyed-transcript.js';
import type { AttributionsBySession } from './speaker-roster.js';

const segment = (sessionId: string, sourceText: string, targetText = 'en'): TranscriptSegment => ({
  id: `seg-${sessionId}`,
  sessionId,
  speakerRole: 'speaker_a',
  direction: 'vi_to_en',
  sourceText,
  targetText,
  audioUrl: null,
  createdAt: '2026-08-27T00:00:00.000Z',
});

/**
 * `cut` = the length ceiling ended it, so the speaker was still going.
 *
 * Rows are `[sessionId, openedAt, cutForced, closedAt]`. An 8s ceiling means a
 * cut turn's open and close are ~8s apart while the NEXT turn opens a few
 * hundred ms after that close — which is the interval the merge actually reads.
 */
const captures = (...rows: [string, number, boolean, number][]): CapturesBySession =>
  Object.fromEntries(
    rows.map(([id, openedAt, cutForced, closedAt]) => [id, { openedAt, cutForced, closedAt }]),
  );

const shape = (groups: DisplayGroup[]) => groups.map((group) => group.sessionIds);

describe('groupTurnsForDisplay', () => {
  it('merges a forced-cut pair into one block', () => {
    const groups = groupTurnsForDisplay(
      [segment('a', 'first half'), segment('b', 'second half')],
      captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
      {},
    );
    expect(shape(groups)).toEqual([['a', 'b']]);
  });

  it('does not merge when the speaker stopped', () => {
    const groups = groupTurnsForDisplay(
      [segment('a', 'one'), segment('b', 'two')],
      captures(['a', 1_000, false, 9_000], ['b', 9_130, false, 12_000]),
      {},
    );
    expect(shape(groups)).toEqual([['a'], ['b']]);
  });

  it('merges a three-turn cut chain into one block', () => {
    const groups = groupTurnsForDisplay(
      [segment('a', '1'), segment('b', '2'), segment('c', '3')],
      captures(['a', 1_000, true, 9_000], ['b', 9_130, true, 17_130], ['c', 17_260, false, 20_000]),
      {},
    );
    expect(shape(groups)).toEqual([['a', 'b', 'c']]);
  });

  /**
   * The three gaps below are not invented. They were measured by replaying the
   * user's own recordings through the real `CapturePump` at the shipped 8s
   * ceiling — one message-app Opus take, a second of the same, and an iPhone
   * Voice Memos take of the same sentence.
   *
   * All three are one utterance the ceiling split, so all three must merge. Two
   * of them did not under the original 400ms bound, which is how that bound was
   * found to be wrong: the fix it shipped did not fire on real speech.
   */
  it.each([
    ['message-app take a', 597],
    ['iPhone Voice Memos take', 448],
    ['message-app take b', 277],
  ])('merges a real forced cut: %s (%dms gap)', (_label, gap) => {
    const groups = groupTurnsForDisplay(
      [segment('a', 'first half'), segment('b', 'second half')],
      captures(['a', 1_000, true, 9_000], ['b', 9_000 + gap, false, 12_000]),
      {},
    );
    expect(shape(groups)).toEqual([['a', 'b']]);
  });

  /**
   * The widest gap ever measured was 597ms and the bound is 1200ms, so a gap
   * past the bound is far outside anything continuing speech produced. This
   * pins the bound itself: without it, "merge whenever the previous turn was
   * cut" would merge a cut turn to whatever came minutes later.
   */
  it('splits when the gap runs past the bound', () => {
    const groups = groupTurnsForDisplay(
      [segment('a', 'one'), segment('b', 'two')],
      captures(['a', 1_000, true, 9_000], ['b', 9_000 + 1_201, false, 12_000]),
      {},
    );
    expect(shape(groups)).toEqual([['a'], ['b']]);
  });

  it('splits when the capture gap is too wide to be one utterance', () => {
    const groups = groupTurnsForDisplay(
      [segment('a', 'one'), segment('b', 'two')],
      captures(['a', 1_000, true, 9_000], ['b', 60_000, false, 63_000]),
      {},
    );
    expect(shape(groups)).toEqual([['a'], ['b']]);
  });

  // The reducer appends on arrival, so `turns` is completion order. With several
  // turns in flight, a first half that walked the model ladder can land after a
  // second half that reused a speculation. Grouping arrival order directly would
  // render the utterance backwards.
  it('orders by capture time, not arrival order', () => {
    const groups = groupTurnsForDisplay(
      [segment('b', 'second half'), segment('a', 'first half')],
      captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
      {},
    );
    expect(shape(groups)).toEqual([['a', 'b']]);
    expect(groupSourceText(groups[0]!, {})).toBe('first half second half');
  });

  it('splits a block when a person confirmed two different speakers', () => {
    const attributions: AttributionsBySession = {
      a: { speakerId: 's1', origin: 'confirmed' },
      b: { speakerId: 's2', origin: 'confirmed' },
    };
    const groups = groupTurnsForDisplay(
      [segment('a', 'one'), segment('b', 'two')],
      captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
      attributions,
    );
    expect(shape(groups)).toEqual([['a'], ['b']]);
  });

  // A suggestion is not evidence anybody looked at the screen, so it must not be
  // allowed to split what the ceiling demonstrably cut.
  it('does not split on a mere suggestion', () => {
    const attributions: AttributionsBySession = {
      a: { speakerId: 's1', origin: 'suggested', suggestedSpeakerId: 's1' },
      b: { speakerId: 's2', origin: 'suggested', suggestedSpeakerId: 's2' },
    };
    const groups = groupTurnsForDisplay(
      [segment('a', 'one'), segment('b', 'two')],
      captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
      attributions,
    );
    expect(shape(groups)).toEqual([['a', 'b']]);
  });

  // Capture records arrive AFTER the segments they describe, so this is the
  // state every merged block passes through on its way to being merged.
  it('never merges on missing evidence', () => {
    const groups = groupTurnsForDisplay([segment('a', 'one'), segment('b', 'two')], {}, {});
    expect(shape(groups)).toEqual([['a'], ['b']]);
  });

  it('keeps both halves when only one capture record has landed', () => {
    const groups = groupTurnsForDisplay(
      [segment('a', 'one'), segment('b', 'two')],
      captures(['a', 1_000, true, 9_000]),
      {},
    );
    expect(shape(groups)).toEqual([['a'], ['b']]);
  });

  it('is empty for an empty conversation', () => {
    expect(groupTurnsForDisplay([], {}, {})).toEqual([]);
  });

  // A comparator that returns 0 for a missing record is not a total order, and
  // V8 does not rescue it: this exact input came back `B, A, C` — C spoken first
  // and rendered last. Turns WITHOUT a record keep their arrival slot; turns with
  // one are ordered among themselves.
  it('orders capture-bearing turns even when an un-recorded turn sits between them', () => {
    const groups = groupTurnsForDisplay(
      [segment('b', 'second'), segment('a', 'no record'), segment('c', 'first')],
      captures(['b', 100, false, 200], ['c', 50, false, 90]),
      {},
    );
    expect(shape(groups)).toEqual([['c'], ['a'], ['b']]);
  });

  // Six turns where only three carry records previously came back completely
  // unsorted, because no two record-bearing turns were ever compared.
  it('orders every capture-bearing turn in a sparsely-recorded conversation', () => {
    const groups = groupTurnsForDisplay(
      ['t1', 't2', 't3', 't4', 't5', 't6'].map((id) => segment(id, id)),
      captures(['t2', 300, false, 350], ['t4', 200, false, 250], ['t6', 100, false, 150]),
      {},
    );
    // Recorded turns occupy the slots they already held (2nd, 4th, 6th), now in
    // capture order; the un-recorded ones never move.
    expect(shape(groups)).toEqual([['t1'], ['t6'], ['t3'], ['t4'], ['t5'], ['t2']]);
  });

  // Display-only means display-only: grouping may reorder and bracket turns, but
  // it must never invent, drop, or duplicate one. This is the invariant behind
  // "translation turn count unchanged".
  it('conserves every turn exactly once', () => {
    const turns = ['a', 'b', 'c', 'd'].map((id) => segment(id, id));
    const groups = groupTurnsForDisplay(
      turns,
      captures(
        ['a', 1_000, true, 9_000],
        ['b', 9_130, false, 12_000],
        ['c', 40_000, false, 42_000],
      ),
      {},
    );
    const flattened = groups.flatMap((group) => group.turns.map((turn) => turn.sessionId));
    expect(flattened.slice().sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(
      groups
        .flatMap((group) => group.sessionIds)
        .slice()
        .sort(),
    ).toEqual(flattened.slice().sort());
  });
});

describe('group text', () => {
  const groups = () =>
    groupTurnsForDisplay(
      [segment('a', 'mười bảy giờ', 'at 5pm'), segment('b', 'trời mưa', 'it rained')],
      captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
      {},
    );

  it('joins source and target in speaking order', () => {
    const [group] = groups();
    expect(groupSourceText(group!, {})).toBe('mười bảy giờ trời mưa');
    expect(groupTargetText(group!)).toBe('at 5pm it rained');
  });

  // The display-repair phase writes `displays`; this proves a repair landing for
  // ONE member re-renders the block with that member repaired and the rest
  // untouched, in any order and at any time. Grouping is a pure derivation, so
  // there is no ordering rule for that phase to get wrong.
  it('substitutes a repair for a single member, leaving the others raw', () => {
    const [group] = groups();
    expect(groupSourceText(group!, { a: '17:00' })).toBe('17:00 trời mưa');
  });

  it('falls back to raw source text for every member with no repair', () => {
    const [group] = groups();
    expect(groupSourceText(group!, { z: 'unrelated' })).toBe('mười bảy giờ trời mưa');
  });

  // The recognizer's own words have to stay reachable beside the repaired line.
  // A repair is a model's rendering of what somebody said, and the speaker is
  // the only person who can tell a restored comma from a substituted word — but
  // only if the thing it rendered is still on the page.
  it('keeps the recognizer text available whatever has been repaired', () => {
    const [group] = groups();
    expect(groupRawSourceText(group!)).toBe('mười bảy giờ trời mưa');
    // Unchanged by a repair, which is the whole point of it being separate.
    expect(groupRawSourceText(group!)).toBe(groupSourceText(group!, {}));
  });

  it('reports a block as repaired when ANY member is', () => {
    const [group] = groups();
    // Any, not all: the halves of one ceiling-cut utterance are repaired by
    // separate requests, so one can land while the other is still in flight or
    // has failed. The line is then part repaired, and still differs from what
    // the recognizer produced — so the original is still worth offering.
    expect(groupIsRepaired(group!, {})).toBe(false);
    expect(groupIsRepaired(group!, { a: '17:00' })).toBe(true);
    expect(groupIsRepaired(group!, { z: 'another turn entirely' })).toBe(false);
  });
});
