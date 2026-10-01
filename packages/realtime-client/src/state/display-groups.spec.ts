import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@chatofy/types';
import {
  blocksToRetranslate,
  groupIsRepaired,
  groupRawSourceText,
  groupSourceText,
  groupTranslation,
  groupTurnsForDisplay,
  type DisplayGroup,
} from './display-groups.js';
import {
  blockKey,
  type BlockTranslation,
  type CapturesBySession,
} from './turn-keyed-transcript.js';
import type { AttributionsBySession } from './speaker-roster.js';

const segment = (sessionId: string, sourceText: string, targetText = 'en'): TranscriptSegment => ({
  id: `seg-${sessionId}`,
  sessionId,
  speakerRole: 'speaker_a',
  direction: 'vi_to_en',
  sourceLanguages: ['vi'],
  translations: { en: targetText },
  sourceText,
  targetText,
  audioUrl: null,
  createdAt: '2026-08-27T00:00:00.000Z',
});

/** A turn spoken in English, for a mixed-source block. */
const enSegment = (
  sessionId: string,
  sourceText: string,
  targetText: string,
): TranscriptSegment => ({
  id: `seg-${sessionId}`,
  sessionId,
  speakerRole: 'speaker_b',
  direction: 'vi_to_en',
  sourceLanguages: ['en'],
  translations: { vi: targetText },
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

  // Replaced on 2026-09-01. This case used to assert the OPPOSITE — that two
  // suggestions naming different people still merge, because a suggestion is not
  // evidence anybody looked. That held while nothing could produce a suggestion.
  // Once the acoustic layer began naming turns on its own, every label became
  // `suggested`, so the split would never fire again and a block holding two
  // discovered voices would render under whichever chip came first: one
  // speaker's words under the other speaker's name.
  it('splits two different discovered voices, even though neither was confirmed', () => {
    const attributions: AttributionsBySession = {
      a: { speakerId: 's1', origin: 'suggested', suggestedSpeakerId: 's1' },
      b: { speakerId: 's2', origin: 'suggested', suggestedSpeakerId: 's2' },
    };
    const groups = groupTurnsForDisplay(
      [segment('a', 'one'), segment('b', 'two')],
      captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
      attributions,
    );
    expect(shape(groups)).toEqual([['a'], ['b']]);
  });

  it('still merges when two suggestions agree', () => {
    const attributions: AttributionsBySession = {
      a: { speakerId: 's1', origin: 'suggested', suggestedSpeakerId: 's1' },
      b: { speakerId: 's1', origin: 'suggested', suggestedSpeakerId: 's1' },
    };
    const groups = groupTurnsForDisplay(
      [segment('a', 'one'), segment('b', 'two')],
      captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
      attributions,
    );
    expect(shape(groups)).toEqual([['a', 'b']]);
  });

  it('merges a turn still waiting for a name with the one before it', () => {
    // `pending` carries no name, so it cannot disagree with one. Splitting on it
    // would break a ceiling-cut utterance apart for the seconds before the
    // clusterer answers, and then silently rejoin it.
    const attributions: AttributionsBySession = {
      a: { speakerId: 's1', origin: 'suggested', suggestedSpeakerId: 's1' },
      b: { speakerId: null, origin: 'pending' },
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
    expect(groupTranslation(group!, 'en')).toBe('at 5pm it rained');
  });

  // The ceiling cut "điện tử | bắt đầu có hiệu lực" in a recorded news clip, and
  // the two halves translated alone read "…authentication It begins to have
  // direct effect". One translation of the whole block is what the block shows.
  describe('with a block translation', () => {
    const three = () =>
      groupTurnsForDisplay(
        [segment('a', 'một', 'one'), segment('b', 'hai', 'two'), segment('c', 'ba', 'three')],
        captures(
          ['a', 1_000, true, 9_000],
          ['b', 9_130, true, 17_000],
          ['c', 17_200, false, 20_000],
        ),
        {},
      );

    // Stored the way the reducer stores them: one entry per shape.
    const answered = (
      ...rows: [string[], Partial<Record<'en' | 'vi', string>>][]
    ): Record<string, BlockTranslation> =>
      Object.fromEntries(
        rows.map(([segmentIds, translations]) => [
          blockKey(segmentIds),
          { segmentIds, translations },
        ]),
      );

    it('replaces the joined pieces it covers', () => {
      const [group] = three();
      const blocks = answered([['a', 'b', 'c'], { en: 'One, two, three.' }]);
      expect(groupTranslation(group!, 'en', blocks)).toBe('One, two, three.');
    });

    it('covers the opening run while the grown block is still being asked for', () => {
      const [group] = three();
      const blocks = answered([['a', 'b'], { en: 'One and two' }]);
      expect(groupTranslation(group!, 'en', blocks)).toBe('One and two three');
    });

    it('prefers the longest answered shape, whatever order the answers landed in', () => {
      const [group] = three();
      const blocks = answered([['a', 'b', 'c'], { en: 'whole' }], [['a', 'b'], { en: 'shorter' }]);
      expect(groupTranslation(group!, 'en', blocks)).toBe('whole');
    });

    // Naming the last piece's speaker splits it off: the block is now `a b`,
    // and the answer for `a b c` no longer describes it.
    it('reads the answer for its new shape when the block shrinks', () => {
      const [group] = groupTurnsForDisplay(
        [segment('a', 'một', 'one'), segment('b', 'hai', 'two')],
        captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 17_000]),
        {},
      );
      const blocks = answered(
        [['a', 'b', 'c'], { en: 'whole' }],
        [['a', 'b'], { en: 'One and two' }],
      );
      expect(groupTranslation(group!, 'en', blocks)).toBe('One and two');
    });

    it('is ignored once the grouping no longer starts with its run', () => {
      const [group] = three();
      const blocks = answered([['a', 'x'], { en: 'stale' }]);
      expect(groupTranslation(group!, 'en', blocks)).toBe('one two three');
    });

    it('falls back to the pieces when the answer has no text in that language', () => {
      const [group] = three();
      // A refusal is answered empty.
      const blocks = answered([['a', 'b', 'c'], {}], [['a', 'b'], { vi: 'một hai' }]);
      expect(groupTranslation(group!, 'en', blocks)).toBe('one two three');
    });

    it('asks only for multi-piece blocks whose exact shape is unanswered', () => {
      const groups = [
        ...three(),
        ...groupTurnsForDisplay(
          [segment('d', 'bốn', 'four')],
          captures(['d', 40_000, false, 42_000]),
          {},
        ),
      ];
      expect(blocksToRetranslate(groups, {})).toEqual([['a', 'b', 'c']]);
      expect(blocksToRetranslate(groups, answered([['a', 'b'], {}]))).toEqual([['a', 'b', 'c']]);
      expect(blocksToRetranslate(groups, answered([['a', 'b', 'c'], {}]))).toEqual([]);
    });
  });

  // A mixed turn — several `sourceLanguages` — is translated into the WHOLE
  // conversation (`translationTargets`, domain/languages.ts), so its map holds
  // more than one key. `groupTranslation` has to read the requested language's
  // entry out of that map rather than assuming one member ever has only one.
  it('picks the requested language out of a mixed turn translated into both', () => {
    const mixed: TranscriptSegment = {
      ...segment('a', 'ship it giờ này', 'ship it now'),
      sourceLanguages: ['vi', 'en'],
      translations: { vi: 'ship it giờ này', en: 'ship it now' },
    };
    const [group] = groupTurnsForDisplay([mixed], captures(['a', 1_000, false, 9_000]), {});
    expect(groupTranslation(group!, 'vi')).toBe('ship it giờ này');
    expect(groupTranslation(group!, 'en')).toBe('ship it now');
  });

  // A real Vietnamese-source turn and a real English-source turn, kept as
  // separate blocks (no forced cut between them). Each contributes only to the
  // language its OWN plan actually translated into — a block never invents a
  // self-translation for a member already spoken in the requested language.
  it('reads each block out of its own translations map, not a shared field', () => {
    const groups = groupTurnsForDisplay(
      [segment('a', 'chắc rồi', 'sure'), enSegment('b', 'ready to ship?', 'sẵn sàng ra mắt chưa?')],
      captures(['a', 1_000, false, 9_000], ['b', 20_000, false, 28_000]),
      {},
    );
    const [first, second] = groups;
    expect(groupTranslation(first!, 'en')).toBe('sure');
    expect(groupTranslation(second!, 'vi')).toBe('sẵn sàng ra mắt chưa?');
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

  // Restored punctuation and case change nearly every Vietnamese line and
  // never a word. Offering the "original" under every line would show the same
  // words in lowercase and teach readers to skip the disclosure.
  it('does not call a line repaired when only its marks and case changed', () => {
    const [group] = groups();
    expect(groupIsRepaired(group!, { a: 'Mười bảy giờ,', b: 'trời mưa.' })).toBe(false);
    expect(groupIsRepaired(group!, { a: '17 giờ,' })).toBe(true);
  });

  it('drops a cut piece\u2019s full stop when the next piece continues the sentence', () => {
    const [group] = groups();
    // The second piece was punctuated reading the first as context, and opened
    // lowercase: no sentence ended at the cut.
    expect(groupSourceText(group!, { a: 'Mười bảy giờ.', b: 'trời mưa.' })).toBe(
      'Mười bảy giờ trời mưa.',
    );
  });

  it('keeps the full stop when the next piece starts a sentence of its own', () => {
    const [group] = groups();
    expect(groupSourceText(group!, { a: 'Mười bảy giờ.', b: 'Trời mưa.' })).toBe(
      'Mười bảy giờ. Trời mưa.',
    );
  });

  it('keeps the full stop when the next piece opens on a numeral', () => {
    // "Bảy ngày…" was capitalised, then typeset to "7 ngày…": the case that
    // said "new sentence" is gone, so the seam is left as punctuated.
    const [group] = groups();
    expect(groupSourceText(group!, { a: 'Mười bảy giờ.', b: '7 ngày sau.' })).toBe(
      'Mười bảy giờ. 7 ngày sau.',
    );
  });

  // A finished piece is forced to end on the likeliest of . ? ! — so a mid-clause
  // cut can close on a question mark or an exclamation as readily as a full stop,
  // and the lowercase opening after it is the same verdict either way.
  it('drops a forced question mark or exclamation when the next piece continues', () => {
    const [group] = groups();
    expect(groupSourceText(group!, { a: 'Mười bảy giờ?', b: 'trời mưa.' })).toBe(
      'Mười bảy giờ trời mưa.',
    );
    expect(groupSourceText(group!, { a: 'Mười bảy giờ!', b: 'trời mưa.' })).toBe(
      'Mười bảy giờ trời mưa.',
    );
  });

  it('keeps a question mark or exclamation when the next piece starts a sentence', () => {
    const [group] = groups();
    expect(groupSourceText(group!, { a: 'Mấy giờ rồi?', b: 'Trời mưa.' })).toBe(
      'Mấy giờ rồi? Trời mưa.',
    );
    expect(groupSourceText(group!, { a: 'Mưa rồi!', b: 'Trời tối.' })).toBe('Mưa rồi! Trời tối.');
  });

  it('leaves the last piece\u2019s closing mark alone', () => {
    const [group] = groups();
    expect(groupSourceText(group!, { a: 'Mười bảy giờ,', b: 'trời mưa?' })).toBe(
      'Mười bảy giờ, trời mưa?',
    );
  });
});
