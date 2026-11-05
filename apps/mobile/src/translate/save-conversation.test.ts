import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiClientError } from '@chatofy/api-client';
import { initialTurnKeyedTranscript } from '@chatofy/realtime-client';
import { buildSaveRequest, classifySaveFailure, pausedMsOf } from './save-conversation.ts';

const identity = {
  startedAt: '2026-11-05T10:00:00.000Z',
  pair: { source: 'vi', target: 'en' },
  askedTwoWay: true,
} as const;

const oneTurn = {
  ...initialTurnKeyedTranscript,
  turns: [
    {
      id: 'a',
      sessionId: 'sess-a',
      speakerRole: 'speaker_a' as const,
      sourceLanguages: ['vi' as const],
      translations: { en: 'hello' },
      sourceText: 'xin chào',
      audioUrl: null,
      createdAt: '2026-11-05T10:00:01.000Z',
    },
  ],
};

describe('buildSaveRequest', () => {
  it('keeps nothing when nothing was said', () => {
    assert.equal(
      buildSaveRequest({
        conversation: initialTurnKeyedTranscript,
        identity,
        pauses: [],
        endedAt: '2026-11-05T10:05:00.000Z',
      }),
      null,
    );
  });

  it('stores a named pair source first and an auto-detected one with the whole registry', () => {
    const named = buildSaveRequest({
      conversation: oneTurn,
      identity,
      pauses: [],
      endedAt: '2026-11-05T10:01:00.000Z',
    });
    assert.deepEqual(named?.languages, ['vi', 'en']);
    assert.equal(named?.mode, 'two-way');
    assert.equal(named?.turns.length, 1);

    const detected = buildSaveRequest({
      conversation: oneTurn,
      identity: { ...identity, pair: { source: 'detect', target: 'en' }, askedTwoWay: false },
      pauses: [],
      endedAt: '2026-11-05T10:01:00.000Z',
    });
    assert.equal(detected?.languages[0], 'en');
    assert.ok((detected?.languages.length ?? 0) > 2);
    assert.equal(detected?.mode, 'one-way');
  });

  it('never reports more paused time than the conversation lasted', () => {
    const body = buildSaveRequest({
      conversation: oneTurn,
      identity,
      pauses: [{ startedAt: 0, endedAt: 10 * 60 * 1000 }],
      endedAt: '2026-11-05T10:01:00.000Z',
    });
    assert.equal(body?.pausedMs, 60_000);
  });
});

describe('pausedMsOf', () => {
  it('counts only finished pauses', () => {
    assert.equal(
      pausedMsOf([
        { startedAt: 100, endedAt: 400 },
        { startedAt: 500, endedAt: null },
      ]),
      300,
    );
  });
});

describe('classifySaveFailure', () => {
  const refused = (status: number) =>
    new ApiClientError({ code: 'x', message: 'y' } as never, status);

  it('treats a refusal that resending cannot fix as terminal, and everything else as retryable', () => {
    assert.equal(classifySaveFailure(refused(400)), 'terminal');
    assert.equal(classifySaveFailure(refused(413)), 'terminal');
    assert.equal(classifySaveFailure(refused(429)), 'retryable');
    assert.equal(classifySaveFailure(refused(503)), 'retryable');
    assert.equal(classifySaveFailure(new TypeError('network')), 'retryable');
  });
});
