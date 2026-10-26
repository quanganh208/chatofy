import { describe, expect, it } from 'vitest';
import { conferenceDurationMinutes, conferenceEndedAt } from './conference.js';

const participant = (leftAt?: string) => ({
  id: 'p',
  userId: 'u',
  sourceLanguage: 'vi',
  status: leftAt ? 'left' : 'joined',
  joinedAt: '2026-10-26T03:00:00.000Z',
  leftAt,
});

const start = '2026-10-26T03:00:00.000Z';
const everyoneLeft = [
  participant('2026-10-26T03:20:00.000Z'),
  participant('2026-10-26T03:30:10.000Z'),
];

describe('conferenceEndedAt', () => {
  it('is the owner ending the room when there is one', () => {
    expect(
      conferenceEndedAt({ endedAt: '2026-10-26T03:10:00.000Z', participants: everyoneLeft }),
    ).toBe('2026-10-26T03:10:00.000Z');
  });

  it('is the last departure when everyone left without the owner ending it', () => {
    expect(conferenceEndedAt({ endedAt: undefined, participants: everyoneLeft })).toBe(
      '2026-10-26T03:30:10.000Z',
    );
  });

  it('is null while anyone is still in the room, or nobody ever joined', () => {
    expect(
      conferenceEndedAt({ endedAt: null, participants: [...everyoneLeft, participant()] }),
    ).toBeNull();
    expect(conferenceEndedAt({ endedAt: null, participants: [] })).toBeNull();
  });
});

describe('conferenceDurationMinutes', () => {
  it('rounds to whole minutes and never answers zero', () => {
    expect(
      conferenceDurationMinutes({
        startedAt: start,
        endedAt: '2026-10-26T03:41:40.000Z',
        participants: [],
      }),
    ).toBe(42);
    expect(
      conferenceDurationMinutes({
        startedAt: start,
        endedAt: '2026-10-26T03:00:05.000Z',
        participants: [],
      }),
    ).toBe(1);
  });

  it('runs to the last departure', () => {
    expect(
      conferenceDurationMinutes({
        startedAt: start,
        endedAt: undefined,
        participants: everyoneLeft,
      }),
    ).toBe(30);
  });

  it('is null when the meeting never started or is not over', () => {
    expect(
      conferenceDurationMinutes({ startedAt: undefined, endedAt: start, participants: [] }),
    ).toBeNull();
    expect(
      conferenceDurationMinutes({
        startedAt: start,
        endedAt: undefined,
        participants: [participant()],
      }),
    ).toBeNull();
  });
});
