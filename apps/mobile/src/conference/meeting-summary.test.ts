import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { participantNames, spokenLanguages } from './meeting-summary.ts';

const participant = (displayName: string | undefined, sourceLanguage: string, leftAt?: string) => ({
  id: displayName ?? 'p',
  userId: 'u',
  displayName,
  sourceLanguage,
  status: leftAt ? 'left' : 'joined',
  joinedAt: '2026-10-26T03:00:00Z',
  leftAt,
});

describe('participantNames', () => {
  it('names a blank participant as a guest', () => {
    const conference = {
      participants: [
        participant('Alice', 'vi'),
        participant('  ', 'en'),
        participant(undefined, 'en'),
      ],
    };
    assert.deepEqual(participantNames(conference, 'Guest'), ['Alice', 'Guest', 'Guest']);
  });
});

describe('spokenLanguages', () => {
  it('lists each language once, in first-seen order', () => {
    const conference = {
      participants: [participant('A', 'en'), participant('B', 'vi'), participant('C', 'en')],
    };
    assert.deepEqual(spokenLanguages(conference), ['en', 'vi']);
  });
});
