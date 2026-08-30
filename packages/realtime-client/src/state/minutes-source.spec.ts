import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@chatofy/types';
import type { SessionSpeaker, AttributionsBySession } from './speaker-roster.js';
import { toMinutesSourceTurns } from './minutes-source.js';

const segment = (
  sessionId: string,
  sourceText: string,
  speakerRole: 'speaker_a' | 'speaker_b' = 'speaker_a',
): TranscriptSegment => ({
  id: `id-${sessionId}`,
  sessionId,
  speakerRole,
  direction: 'vi_to_en',
  sourceText,
  targetText: 'translated',
  audioUrl: null,
  createdAt: '2026-08-30T00:00:00.000Z',
});

const speakers: SessionSpeaker[] = [
  { id: 'speaker-1', label: 'An' },
  { id: 'speaker-2', label: 'Bình' },
];

describe('toMinutesSourceTurns', () => {
  it('uses the confirmed roster label and the SOURCE text, in order', () => {
    const attributions: AttributionsBySession = {
      s1: { speakerId: 'speaker-1', origin: 'confirmed' },
      s2: { speakerId: 'speaker-2', origin: 'confirmed' },
    };
    const result = toMinutesSourceTurns({
      turns: [segment('s1', 'xin chào'), segment('s2', 'khỏe không')],
      speakers,
      attributions,
    });
    expect(result).toEqual([
      { speakerLabel: 'An', text: 'xin chào' },
      { speakerLabel: 'Bình', text: 'khỏe không' },
    ]);
  });

  it('falls back to the a/b role label when a turn is unattributed', () => {
    const result = toMinutesSourceTurns({
      turns: [segment('s1', 'hello', 'speaker_a'), segment('s2', 'hi', 'speaker_b')],
      speakers: [],
      attributions: {},
    });
    expect(result).toEqual([
      { speakerLabel: 'Speaker A', text: 'hello' },
      { speakerLabel: 'Speaker B', text: 'hi' },
    ]);
  });

  it('drops turns whose source text is empty or whitespace', () => {
    const result = toMinutesSourceTurns({
      turns: [segment('s1', '   '), segment('s2', 'real line')],
      speakers: [],
      attributions: {},
    });
    expect(result).toEqual([{ speakerLabel: 'Speaker A', text: 'real line' }]);
  });

  it('is empty for a conversation with no finished turns', () => {
    expect(toMinutesSourceTurns({ turns: [], speakers, attributions: {} })).toEqual([]);
  });
});
