import { describe, expect, it } from 'vitest';
import { HISTORY_LIMITS, type TranscriptSegment } from '@chatofy/types';
import type { AttributionsBySession, SessionSpeaker } from './speaker-roster.js';
import type { CapturesBySession } from './turn-keyed-transcript.js';
import { toConversationTurns as project } from './conversation-turns.js';

/**
 * The conversation start the cases below measure from.
 *
 * Zero, so a capture's `openedAt` IS its offset and a case that is about text
 * does not have to do arithmetic to stay readable. The offset cases at the
 * bottom pass a real start explicitly.
 */
const START = 0;

/**
 * `toConversationTurns` with the start defaulted.
 *
 * Most cases here predate offsets entirely and assert the TEXT projection —
 * grouping, splitting, speaker attribution. Threading a start argument through
 * all of them would add noise to a dozen cases to serve two.
 */
const toConversationTurns = (
  state: Parameters<typeof project>[0],
  startedAtMs: number = START,
): ReturnType<typeof project> => project(state, startedAtMs);

const segment = (
  sessionId: string,
  sourceText: string,
  targetText = 'en',
  speakerRole: 'speaker_a' | 'speaker_b' = 'speaker_a',
): TranscriptSegment => {
  // speaker_a is the Vietnamese side of this conversation's declared
  // direction, whatever order it names — see `speakerRoleFor`.
  const [source, target] =
    speakerRole === 'speaker_a' ? (['vi', 'en'] as const) : (['en', 'vi'] as const);
  return {
    id: `seg-${sessionId}`,
    sessionId,
    speakerRole,
    direction: 'vi_to_en',
    sourceLanguages: [source],
    translations: { [target]: targetText },
    sourceText,
    targetText,
    audioUrl: null,
    createdAt: '2026-09-03T00:00:00.000Z',
  };
};

/** A turn spoken in `source`, with its own explicit translation map. */
const languageSegment = (
  sessionId: string,
  source: 'vi' | 'en',
  sourceText: string,
  translations: Partial<Record<'vi' | 'en', string>>,
): TranscriptSegment => ({
  id: `seg-${sessionId}`,
  sessionId,
  speakerRole: source === 'vi' ? 'speaker_a' : 'speaker_b',
  direction: 'vi_to_en',
  sourceLanguages: [source],
  translations,
  sourceText,
  targetText: Object.values(translations)[0] ?? '',
  audioUrl: null,
  createdAt: '2026-09-03T00:00:00.000Z',
});

/**
 * Rows are `[sessionId, openedAt, cutForced, closedAt, preRollMs?]` — see
 * display-groups. The pre-roll is omitted by every case that is not about it,
 * which is also the shape a capture recorded before the field existed has.
 */
const captures = (...rows: [string, number, boolean, number, number?][]): CapturesBySession =>
  Object.fromEntries(
    rows.map(([id, openedAt, cutForced, closedAt, preRollMs]) => [
      id,
      { openedAt, cutForced, closedAt, ...(preRollMs === undefined ? {} : { preRollMs }) },
    ]),
  );

const speakers: SessionSpeaker[] = [
  { id: 'speaker-1', label: 'An' },
  { id: 'speaker-2', label: 'Bình' },
];

const base = { speakers: [], attributions: {}, captures: {}, displays: {} };

describe('toConversationTurns', () => {
  it('stores an utterance the ceiling split as ONE block', () => {
    const rows = toConversationTurns({
      ...base,
      turns: [segment('a', 'first half', 'one'), segment('b', 'second half', 'two')],
      captures: captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
    });

    // Not two rows of unpunctuated recognizer output — the whole reason grouping
    // happens before the save rather than after the read.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      position: 0,
      sourceText: 'first half second half',
      targetText: 'one two',
    });
  });

  it('saves the whole-block translation of a split utterance, keeping its source', () => {
    const rows = toConversationTurns({
      ...base,
      turns: [segment('a', 'first half', 'one'), segment('b', 'second half', 'two')],
      captures: captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
      blockTranslations: {
        'a b': { segmentIds: ['a', 'b'], translations: { en: 'One sentence.' } },
      },
    });

    expect(rows[0]).toMatchObject({
      sourceText: 'first half second half',
      translations: { en: 'One sentence.' },
      // The legacy field reads the same block answer, so the row agrees with itself.
      targetText: 'One sentence.',
    });
  });

  it('saves the block typeset as one text as the display of a split utterance', () => {
    // Each piece was punctuated as a sentence with nothing after it: "của ngành."
    // closed a clause the next piece went on with.
    const rows = toConversationTurns({
      ...base,
      turns: [segment('a', 'của ngành ai', 'one'), segment('b', 'khi mà', 'two')],
      captures: captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
      displays: { a: 'Của ngành. AI.', b: 'Khi mà.' },
      blockTranslations: {
        'a b': {
          segmentIds: ['a', 'b'],
          translations: { en: 'Of the AI industry, when.' },
          display: 'Của ngành AI khi mà.',
        },
      },
    });

    expect(rows[0]).toMatchObject({
      sourceText: 'của ngành ai khi mà',
      displayText: 'Của ngành AI khi mà.',
    });
  });

  it('keeps the legacy text of a block whose members spoke different languages', () => {
    // A cut across a language switch: no one language mirrors every member's
    // `targetText`, so there is nothing to read the block through.
    const rows = toConversationTurns({
      ...base,
      turns: [
        languageSegment('a', 'vi', 'nửa đầu', { en: 'first half' }),
        languageSegment('b', 'en', 'second half', { vi: 'nửa sau' }),
      ],
      captures: captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
      blockTranslations: {
        'a b': { segmentIds: ['a', 'b'], translations: { en: 'One sentence.' } },
      },
    });

    expect(rows[0]?.targetText).toBe('first half nửa sau');
  });

  it('leaves displayText null when the rendering matches the recognizer', () => {
    const rows = toConversationTurns({
      ...base,
      turns: [segment('a', 'xin chào')],
      captures: captures(['a', 1_000, false, 3_000]),
    });
    expect(rows[0]?.displayText).toBeNull();
  });

  it('sets displayText when the block was repaired', () => {
    const rows = toConversationTurns({
      ...base,
      turns: [segment('a', 'xin chao')],
      captures: captures(['a', 1_000, false, 3_000]),
      displays: { a: 'xin chào' },
    });
    expect(rows[0]).toMatchObject({
      sourceText: 'xin chao',
      displayText: 'xin chào',
    });
  });

  it('stores the confirmed roster label, and null when the block was never attributed', () => {
    const attributions: AttributionsBySession = {
      a: { speakerId: 'speaker-1', origin: 'confirmed' },
    };
    const rows = toConversationTurns({
      ...base,
      speakers,
      attributions,
      turns: [segment('a', 'named'), segment('b', 'unnamed', 'en', 'speaker_b')],
      captures: captures(['a', 1_000, false, 3_000], ['b', 5_000, false, 7_000]),
    });

    expect(rows[0]).toMatchObject({ speakerLabel: 'An', speakerRole: 'speaker_a' });
    // Null, not "Speaker B": the fallback is language-dependent and belongs to
    // the screen, not to a database row the i18n parity gate cannot see.
    expect(rows[1]).toMatchObject({ speakerLabel: null, speakerRole: 'speaker_b' });
  });

  it('numbers positions in block order, contiguously from zero', () => {
    const rows = toConversationTurns({
      ...base,
      turns: [
        segment('a', 'first half'),
        segment('b', 'second half'),
        segment('c', 'a separate thing'),
      ],
      captures: captures(
        ['a', 1_000, true, 9_000],
        ['b', 9_130, false, 12_000],
        ['c', 20_000, false, 22_000],
      ),
    });
    expect(rows.map((row) => row.position)).toEqual([0, 1]);
    expect(rows.map((row) => row.sourceText)).toEqual([
      'first half second half',
      'a separate thing',
    ]);
  });

  it('drops a block the recognizer produced nothing for, without leaving a gap', () => {
    const rows = toConversationTurns({
      ...base,
      turns: [segment('a', '   '), segment('b', 'real line')],
      captures: captures(['a', 1_000, false, 3_000], ['b', 5_000, false, 7_000]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ position: 0, sourceText: 'real line' });
  });

  it('splits a block past the per-field storage cap into rows that each fit it', () => {
    // Grouping merges every forced cut under the capture gap and has no ceiling
    // of its own, so a few minutes of unbroken speech is ONE block, longer than
    // a stored field may be. A save is all-or-nothing and a refusal is terminal,
    // so leaving the block whole costs the entire conversation.
    const source = [wordsOfLength(3_000), wordsOfLength(3_000)];
    const target = [wordsOfLength(3_200), wordsOfLength(3_200)];
    const rows = toConversationTurns({
      ...base,
      turns: [segment('a', source[0]!, target[0]), segment('b', source[1]!, target[1])],
      captures: captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
    });

    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.sourceText.length).toBeLessThanOrEqual(HISTORY_LIMITS.MAX_TURN_CHARS);
      expect(row.targetText.length).toBeLessThanOrEqual(HISTORY_LIMITS.MAX_TURN_CHARS);
      // Every piece is still attributed: a split that dropped the speaker off
      // the tail would leave half the block unnamed.
      expect(row.speakerRole).toBe('speaker_a');
    }
    expect(rows.map((row) => row.position)).toEqual(rows.map((_, position) => position));

    // Nothing lost and nothing sliced: rejoining on a single space reproduces
    // the block exactly, which only holds if every cut landed on a space.
    expect(rows.map((row) => row.sourceText).join(' ')).toBe(source.join(' '));
    expect(
      rows
        .map((row) => row.targetText)
        .filter((text) => text !== '')
        .join(' '),
    ).toBe(target.join(' '));
  });

  it('cuts at the cap when the text has no word boundary to cut on', () => {
    // A URL or an unspaced run: a boundary that is not there cannot be honoured,
    // and refusing the save would cost more than a cut mid-token.
    const unbroken = 'x'.repeat(HISTORY_LIMITS.MAX_TURN_CHARS + 500);
    const rows = toConversationTurns({
      ...base,
      turns: [segment('a', unbroken, '')],
      captures: captures(['a', 1_000, false, 3_000]),
    });

    expect(rows.map((row) => row.sourceText.length)).toEqual([HISTORY_LIMITS.MAX_TURN_CHARS, 500]);
    expect(rows.map((row) => row.sourceText).join('')).toBe(unbroken);
  });

  it('carries the repaired rendering across the pieces of a split block', () => {
    const raw = wordsOfLength(6_000);
    const rows = toConversationTurns({
      ...base,
      turns: [segment('a', raw)],
      captures: captures(['a', 1_000, false, 3_000]),
      displays: { a: raw.toUpperCase() },
    });

    expect(rows).toHaveLength(2);
    // Never '': a reader and the minutes prompt both read
    // `displayText ?? sourceText`, so an empty rendering would hide the line.
    for (const row of rows) expect(row.displayText).not.toBe('');
    expect(rows.map((row) => row.displayText).join(' ')).toBe(raw.toUpperCase());
  });

  it('spreads the rendering over every row when only the recognizer text passed the cap', () => {
    // The repair shortens what was said — dropped filler, tightened spacing —
    // so the raw block needs two rows and the rendering would have fitted one.
    // Every reader resolves a row as `displayText ?? sourceText`, so a rendering
    // that stopped after row 0 would leave row 1 falling back to the RAW tail
    // and the end of the block would be read twice.
    const raw = wordsOfLength(HISTORY_LIMITS.MAX_TURN_CHARS + 600);
    const repaired = wordsOfLength(HISTORY_LIMITS.MAX_TURN_CHARS - 100).toUpperCase();
    const rows = toConversationTurns({
      ...base,
      turns: [segment('a', raw, '')],
      captures: captures(['a', 1_000, false, 3_000]),
      displays: { a: repaired },
    });

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.displayText).toBeTruthy();
      expect(row.displayText?.length ?? 0).toBeLessThanOrEqual(HISTORY_LIMITS.MAX_TURN_CHARS);
      expect(row.sourceText.length).toBeLessThanOrEqual(HISTORY_LIMITS.MAX_TURN_CHARS);
    }
    // Read as the screen and the minutes prompt read it: the block's text, once.
    expect(rows.map((row) => row.displayText ?? row.sourceText).join(' ')).toBe(repaired);
    expect(rows.map((row) => row.sourceText).join(' ')).toBe(raw);
  });

  it('spreads the recognizer text over every row when only the rendering passed the cap', () => {
    // The other direction: the repair is longer than what the recognizer wrote.
    // The raw text would have fitted one row, and a row carrying none of it
    // would be a stored turn with no recognizer line behind its rendering.
    const raw = wordsOfLength(HISTORY_LIMITS.MAX_TURN_CHARS - 100);
    const repaired = wordsOfLength(HISTORY_LIMITS.MAX_TURN_CHARS + 600).toUpperCase();
    const rows = toConversationTurns({
      ...base,
      turns: [segment('a', raw, '')],
      captures: captures(['a', 1_000, false, 3_000]),
      displays: { a: repaired },
    });

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.sourceText).not.toBe('');
      expect(row.sourceText.length).toBeLessThanOrEqual(HISTORY_LIMITS.MAX_TURN_CHARS);
      expect(row.displayText?.length ?? 0).toBeLessThanOrEqual(HISTORY_LIMITS.MAX_TURN_CHARS);
    }
    expect(rows.map((row) => row.displayText ?? row.sourceText).join(' ')).toBe(repaired);
    expect(rows.map((row) => row.sourceText).join(' ')).toBe(raw);
  });

  it('spreads the translation over every row when only the recognizer text passed the cap', () => {
    const raw = wordsOfLength(HISTORY_LIMITS.MAX_TURN_CHARS + 600);
    const translated = wordsOfLength(HISTORY_LIMITS.MAX_TURN_CHARS - 100).toUpperCase();
    const rows = toConversationTurns({
      ...base,
      turns: [segment('a', raw, translated)],
      captures: captures(['a', 1_000, false, 3_000]),
    });

    expect(rows).toHaveLength(2);
    // Both halves of a translation the reader can follow beside the source,
    // rather than the whole of it against the first half of what was said.
    for (const row of rows) expect(row.targetText).not.toBe('');
    expect(rows.map((row) => row.targetText).join(' ')).toBe(translated);
  });

  it('orders by capture time, not by the order translations completed', () => {
    // The reducer appends in COMPLETION order: a first half that walked the model
    // ladder can land after a second half that reused a speculation.
    const rows = toConversationTurns({
      ...base,
      turns: [segment('later', 'second'), segment('earlier', 'first')],
      captures: captures(['later', 9_000, false, 11_000], ['earlier', 1_000, false, 3_000]),
    });
    expect(rows.map((row) => row.sourceText)).toEqual(['first', 'second']);
  });

  describe('sourceLanguages and translations', () => {
    it('carries a real vi turn and a real en turn as two distinct rows', () => {
      const rows = toConversationTurns({
        ...base,
        turns: [
          languageSegment('a', 'vi', 'xin chào', { en: 'hello' }),
          languageSegment('b', 'en', 'good morning', { vi: 'chào buổi sáng' }),
        ],
        captures: captures(['a', 1_000, false, 3_000], ['b', 20_000, false, 22_000]),
      });

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        sourceLanguages: ['vi'],
        translations: { en: 'hello' },
      });
      expect(rows[1]).toMatchObject({
        sourceLanguages: ['en'],
        translations: { vi: 'chào buổi sáng' },
      });
    });

    it('translates a mixed turn into every conversation language', () => {
      // Several `sourceLanguages` on one turn go to the WHOLE conversation
      // (`translationTargets`, domain/languages.ts) — both keys land on the one
      // stored row.
      const mixed = languageSegment('a', 'vi', 'ship it giờ này', {
        vi: 'ship it giờ này',
        en: 'ship it now',
      });
      const rows = toConversationTurns({
        ...base,
        turns: [{ ...mixed, sourceLanguages: ['vi', 'en'] }],
        captures: captures(['a', 1_000, false, 3_000]),
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sourceLanguages: ['vi', 'en'],
        translations: { vi: 'ship it giờ này', en: 'ship it now' },
      });
    });

    // The risk this covers: a mixed turn (several `sourceLanguages`) targets
    // the WHOLE conversation, and its several translations are unrelated
    // strings — nothing says they are the same length. Each target language
    // must be capped against its OWN length, independently, or one running
    // long could corrupt or truncate the other rather than merely needing more
    // rows itself.
    it('caps each target language independently on a mixed turn that passes the storage cap', () => {
      const long = wordsOfLength(HISTORY_LIMITS.MAX_TURN_CHARS + 600);
      const short = wordsOfLength(HISTORY_LIMITS.MAX_TURN_CHARS - 100);
      const mixed: TranscriptSegment = {
        id: 'seg-a',
        sessionId: 'a',
        speakerRole: 'speaker_a',
        direction: 'vi_to_en',
        sourceLanguages: ['vi', 'en'],
        translations: { en: long, vi: short },
        sourceText: 'a real mixed sentence',
        targetText: long,
        audioUrl: null,
        createdAt: '2026-09-03T00:00:00.000Z',
      };
      const rows = toConversationTurns({
        ...base,
        turns: [mixed],
        captures: captures(['a', 1_000, false, 3_000]),
      });

      expect(rows.length).toBeGreaterThan(1);
      for (const row of rows) {
        expect(row.sourceLanguages).toEqual(['vi', 'en']);
        expect((row.translations.en ?? '').length).toBeLessThanOrEqual(
          HISTORY_LIMITS.MAX_TURN_CHARS,
        );
        expect((row.translations.vi ?? '').length).toBeLessThanOrEqual(
          HISTORY_LIMITS.MAX_TURN_CHARS,
        );
      }
      // Read as the screen and the minutes prompt read it: each language's
      // text, once, concatenated in row order.
      expect(rows.map((row) => row.translations.en ?? row.translations.vi ?? '').length).toBe(
        rows.length,
      );
      expect(
        rows
          .map((row) => row.translations.vi)
          .filter((text): text is string => Boolean(text))
          .join(' '),
      ).toBe(short);
    });
  });

  describe('offsetMs', () => {
    it('measures from the conversation start, not from zero', () => {
      const startedAt = 1_700_000_000_000;
      const rows = toConversationTurns(
        {
          ...base,
          turns: [segment('a', 'xin chào')],
          captures: captures(['a', startedAt + 6_200, false, startedAt + 8_000]),
        },
        startedAt,
      );
      expect(rows[0]?.offsetMs).toBe(6_200);
    });

    it('points at the first sample the block contains, not at the gate confirming it', () => {
      // The pump prepends audio captured before the gate called it speech, so
      // the turn starts that much earlier than `openedAt`. A seek to the
      // uncorrected number lands past the syllable the pre-roll exists to save.
      const startedAt = 1_700_000_000_000;
      const rows = toConversationTurns(
        {
          ...base,
          turns: [segment('a', 'xin chào')],
          captures: captures(['a', startedAt + 6_200, false, startedAt + 8_000, 320]),
        },
        startedAt,
      );
      expect(rows[0]?.offsetMs).toBe(5_880);
    });

    it('does not move a turn that opened with an empty pre-roll', () => {
      // `closeTurn` empties the pre-roll, and continuous mode can open the next
      // turn before any block has refilled it. There is no audio before
      // `openedAt` to point at, so the correction is the capture's own amount
      // rather than the constant the pump usually keeps.
      const rows = toConversationTurns(
        {
          ...base,
          turns: [segment('a', 'xin chào')],
          captures: captures(['a', 6_200, false, 8_000, 0]),
        },
        0,
      );
      expect(rows[0]?.offsetMs).toBe(6_200);
    });

    it('keeps a pre-roll that reaches past the conversation start at zero', () => {
      // Someone speaking immediately has real audio from before `startedAt`, and
      // the write schema is `min(0)` — only this clamp stands between the
      // subtraction and a 400 that loses the whole save.
      const rows = toConversationTurns(
        {
          ...base,
          turns: [segment('a', 'xin chào')],
          captures: captures(['a', 200, false, 3_000, 320]),
        },
        0,
      );
      expect(rows[0]?.offsetMs).toBe(0);
    });

    it('keeps early turns apart instead of collapsing them onto 0:00', () => {
      // The correction is bounded by what each turn actually recorded, so turns
      // seconds apart near the start stay distinct — a flat subtraction large
      // enough to cover the pipeline delay would clamp several of them to zero
      // and lose the ordering the gutter carries.
      const rows = toConversationTurns(
        {
          ...base,
          turns: [segment('a', 'xin chào'), segment('b', 'cảm ơn')],
          captures: captures(['a', 400, false, 2_000, 320], ['b', 4_000, false, 6_000, 320]),
        },
        0,
      );
      expect(rows.map((row) => row.offsetMs)).toEqual([80, 3_680]);
    });

    it('reads the FIRST member of a block the ceiling split', () => {
      // The whole block was one utterance, so its time is where the speaker
      // started — not where the ceiling happened to cut it.
      const rows = toConversationTurns(
        {
          ...base,
          turns: [segment('a', 'first half', 'one'), segment('b', 'second half', 'two')],
          captures: captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]),
        },
        0,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.offsetMs).toBe(1_000);
    });

    it('gives every piece of a split block the same offset', () => {
      // `splitAtCap` cuts one block into several rows when a field outgrows its
      // column. The pieces were all said at one moment; a later time on the tail
      // would invent a pause.
      const long = wordsOfLength(HISTORY_LIMITS.MAX_TURN_CHARS + 500);
      const rows = toConversationTurns(
        {
          ...base,
          turns: [segment('a', long)],
          captures: captures(['a', 4_000, false, 20_000]),
        },
        0,
      );
      expect(rows.length).toBeGreaterThan(1);
      expect(new Set(rows.map((row) => row.offsetMs))).toEqual(new Set([4_000]));
    });

    it('is null when no capture record arrived, never zero', () => {
      // A record can be absent for a turn still in flight or one that aged out of
      // the pipeline's bounded buffer. Zero would render 0:00 and claim the block
      // opened the conversation.
      const rows = toConversationTurns({ ...base, turns: [segment('a', 'xin chào')] }, 0);
      expect(rows[0]?.offsetMs).toBeNull();
    });

    it('clamps a capture earlier than the start to zero', () => {
      // `startedAt` is stamped just before `session.start()`, so a turn cannot
      // really open before it — a negative here means the clocks disagree.
      const rows = toConversationTurns(
        {
          ...base,
          turns: [segment('a', 'xin chào')],
          captures: captures(['a', 500, false, 3_000]),
        },
        2_000,
      );
      expect(rows[0]?.offsetMs).toBe(0);
    });

    it('clamps at the duration ceiling rather than sending a value the save would refuse', () => {
      // A caller that failed to parse its own `startedAt` and fell back to the
      // epoch would otherwise turn every offset into a value decades past
      // `MAX_DURATION_MS`, and the write schema refuses that outright.
      const rows = toConversationTurns(
        {
          ...base,
          turns: [segment('a', 'xin chào')],
          captures: captures(['a', HISTORY_LIMITS.MAX_DURATION_MS + 5_000, false, 3_000]),
        },
        0,
      );
      expect(rows[0]?.offsetMs).toBe(HISTORY_LIMITS.MAX_DURATION_MS);
    });

    it('reads as null rather than NaN when the start could not be measured', () => {
      const rows = toConversationTurns(
        {
          ...base,
          turns: [segment('a', 'xin chào')],
          captures: captures(['a', 6_200, false, 8_000]),
        },
        NaN,
      );
      expect(rows[0]?.offsetMs).toBeNull();
    });

    it('defaults the start to zero for a caller on the previous signature', () => {
      // `toConversationTurns` gained this parameter with conversation recording,
      // and it is exported to the extension and mobile. A caller still calling
      // it with one argument must get an offset, not `NaN` in every row.
      const rows = project({
        ...base,
        turns: [segment('a', 'xin chào')],
        captures: captures(['a', 6_200, false, 8_000]),
      });
      expect(rows[0]?.offsetMs).toBe(6_200);
    });

    it('leaves out the paused time before a block, so it lands on the paused recording', () => {
      // Paused from 10s to 15s. The recorder skipped those five seconds, so a
      // block spoken at 20s wall time sits at 15s in the media; one spoken
      // before the pause is not moved at all.
      const startedAt = 1_700_000_000_000;
      const pauses = [{ startedAt: startedAt + 10_000, endedAt: startedAt + 15_000 }];
      const rows = project(
        {
          ...base,
          turns: [segment('a', 'trước'), segment('b', 'sau')],
          captures: captures(
            ['a', startedAt + 4_000, false, startedAt + 6_000],
            ['b', startedAt + 20_000, false, startedAt + 22_000],
          ),
        },
        startedAt,
        pauses,
      );
      expect(rows.map((row) => row.offsetMs)).toEqual([4_000, 15_000]);
    });

    it('keeps wall time when no pauses are passed, for a recording that ran through them', () => {
      const startedAt = 1_700_000_000_000;
      const rows = project(
        {
          ...base,
          turns: [segment('b', 'sau')],
          captures: captures(['b', startedAt + 20_000, false, startedAt + 22_000]),
        },
        startedAt,
      );
      expect(rows[0]?.offsetMs).toBe(20_000);
    });
  });
});

/** Distinct space-separated words totalling `length` characters. */
function wordsOfLength(length: number): string {
  const words: string[] = [];
  let total = 0;
  for (let index = 0; total < length; index += 1) {
    const word = `w${index}`;
    words.push(word);
    total += word.length + (words.length > 1 ? 1 : 0);
  }
  return words.join(' ').slice(0, length).trimEnd();
}
