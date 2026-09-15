import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@chatofy/types';
import { durationMinutes, formatOffset, mediaOffset } from './conversation-formatting';

/**
 * The rounding the history row prints, pinned because the docblock above it was
 * describing a different function.
 *
 * It said "rounded up" while the code rounds to nearest, and the two agree on the
 * only example the comment gave — a 40-second conversation, which the floor
 * rescues either way. They disagree everywhere else, so nothing was catching it.
 */

const conversation = (startedAt: string, endedAt: string): ConversationSummary => ({
  conversationId: '11111111-1111-4111-8111-111111111111',
  direction: 'vi_to_en',
  startedAt,
  endedAt,
  turnCount: 1,
  preview: 'xin chào',
  hasMinutes: false,
});

describe('durationMinutes', () => {
  it('rounds to the nearest whole minute', () => {
    // 6m10s. Rounded UP this would read "7 min" — a length overstated by more
    // than a tenth of itself.
    expect(
      durationMinutes(conversation('2026-09-03T10:00:00.000Z', '2026-09-03T10:06:10.000Z')),
    ).toBe(6);
    expect(
      durationMinutes(conversation('2026-09-03T10:00:00.000Z', '2026-09-03T10:06:50.000Z')),
    ).toBe(7);
  });

  it('never reads "0 min", however short the conversation was', () => {
    // The floor, not the rounding, is what does this.
    expect(
      durationMinutes(conversation('2026-09-03T10:00:00.000Z', '2026-09-03T10:00:40.000Z')),
    ).toBe(1);
    expect(
      durationMinutes(conversation('2026-09-03T10:00:00.000Z', '2026-09-03T10:00:01.000Z')),
    ).toBe(1);
  });
});

describe('formatOffset', () => {
  it('pads the seconds so the column does not shift', () => {
    expect(formatOffset(1_000)).toBe('0:01');
    expect(formatOffset(6_000)).toBe('0:06');
    expect(formatOffset(72_000)).toBe('1:12');
  });

  it('grows to h:mm:ss only past an hour', () => {
    expect(formatOffset(59 * 60_000 + 59_000)).toBe('59:59');
    expect(formatOffset(3_600_000)).toBe('1:00:00');
    expect(formatOffset(3_671_000)).toBe('1:01:11');
  });

  it('FLOORS the seconds, because this labels a moment to seek to', () => {
    // 5.9s reads 0:05, not 0:06. Rounding up would send the player past the first
    // syllable of the line it labels; landing just before it is recoverable by
    // listening, landing after has already cut the word off.
    expect(formatOffset(5_900)).toBe('0:05');
    expect(formatOffset(59_999)).toBe('0:59');
  });

  it('shows 0:00 rather than a negative', () => {
    // A gutter is not the place to report that two clocks disagreed.
    expect(formatOffset(-1)).toBe('0:00');
  });
});

describe('mediaOffset', () => {
  it('converts conversation time into media time', () => {
    // The recording starts after the conversation does — the permission prompt,
    // the worklet load and the socket connect all sit in between.
    expect(mediaOffset(6_200, 1_400)).toBe(4_800);
  });

  it('passes null through: no capture record means no position to show', () => {
    expect(mediaOffset(null, 1_400)).toBeNull();
  });

  it('treats a missing recording start as zero rather than as unknown', () => {
    // A row stored before `audioOffsetMs` existed. Conversation time is the best
    // available reading, and it is right to within the startup interval.
    expect(mediaOffset(6_200, null)).toBe(6_200);
  });

  it('clamps a turn that precedes the recording', () => {
    // Everything said before the microphone opened belongs at the first sample.
    expect(mediaOffset(500, 1_400)).toBe(0);
  });
});
