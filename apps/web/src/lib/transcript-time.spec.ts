import { describe, expect, it } from 'vitest';
import { formatOffset, isoDuration, mediaOffset, recordingOffsetMs } from './transcript-time';

/**
 * The rules both timestamped screens share. `/translate` and `/history` have to
 * print the same string for the same block, so what is pinned here is the whole
 * of what makes that true: the rounding, the shift, and the origin the shift is
 * measured from.
 */

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

describe('recordingOffsetMs', () => {
  it('measures the recorder start against the conversation start', () => {
    // The permission prompt, the worklet load and the socket connect all sit in
    // this interval, which is why it is measured rather than assumed to be zero.
    expect(
      recordingOffsetMs(Date.parse('2026-09-17T01:00:01.400Z'), '2026-09-17T01:00:00.000Z'),
    ).toBe(1_400);
  });

  it('is null before the microphone has opened', () => {
    // A conversation that has started but not yet been granted a microphone has
    // no recording origin, so there is no shift to apply — and the live screen
    // then reads conversation time, exactly as history will for the same one.
    expect(recordingOffsetMs(null, '2026-09-17T01:00:00.000Z')).toBeNull();
  });

  it('is null with no conversation to measure against', () => {
    expect(recordingOffsetMs(Date.parse('2026-09-17T01:00:01.400Z'), null)).toBeNull();
  });

  it('reads a malformed start as no shift rather than as NaN', () => {
    expect(recordingOffsetMs(Date.parse('2026-09-17T01:00:01.400Z'), 'not a date')).toBeNull();
  });

  it('clamps a recorder that somehow predates the conversation', () => {
    expect(
      recordingOffsetMs(Date.parse('2026-09-17T00:59:59.000Z'), '2026-09-17T01:00:00.000Z'),
    ).toBe(0);
  });
});

describe('isoDuration', () => {
  it('writes the machine-readable half of the visible time', () => {
    expect(isoDuration(72_000)).toBe('PT1M12S');
    expect(isoDuration(6_200)).toBe('PT0M6S');
  });
});
