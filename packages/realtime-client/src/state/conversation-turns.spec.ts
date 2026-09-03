import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@chatofy/types';
import type { AttributionsBySession, SessionSpeaker } from './speaker-roster.js';
import type { CapturesBySession } from './turn-keyed-transcript.js';
import { toConversationTurns } from './conversation-turns.js';

const segment = (
  sessionId: string,
  sourceText: string,
  targetText = 'en',
  speakerRole: 'speaker_a' | 'speaker_b' = 'speaker_a',
): TranscriptSegment => ({
  id: `seg-${sessionId}`,
  sessionId,
  speakerRole,
  direction: 'vi_to_en',
  sourceText,
  targetText,
  audioUrl: null,
  createdAt: '2026-09-03T00:00:00.000Z',
});

/** Rows are `[sessionId, openedAt, cutForced, closedAt]` — see display-groups. */
const captures = (...rows: [string, number, boolean, number][]): CapturesBySession =>
  Object.fromEntries(
    rows.map(([id, openedAt, cutForced, closedAt]) => [id, { openedAt, cutForced, closedAt }]),
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
});
