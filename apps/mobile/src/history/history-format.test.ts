import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConversationTurn } from '@chatofy/types';
import {
  detailTurns,
  durationMinutes,
  languageLine,
  searchTerm,
  titleOf,
} from './history-format.ts';

describe('searchTerm', () => {
  it('sends nothing until the term is long enough for the API', () => {
    assert.equal(searchTerm(' a '), '');
    assert.equal(searchTerm('  xin chào '), 'xin chào');
    assert.equal(searchTerm(''), '');
  });
});

describe('titleOf', () => {
  it('prefers the written title and falls back to the preview', () => {
    assert.equal(titleOf({ title: ' Họp nhóm ', preview: 'xin chào' }), 'Họp nhóm');
    assert.equal(titleOf({ title: null, preview: ' xin chào ' }), 'xin chào');
    assert.equal(titleOf({ title: null, preview: '   ' }), null);
  });
});

describe('languageLine', () => {
  it('reads a stored pair source first', () => {
    assert.deepEqual(languageLine(['vi', 'en']), { kind: 'pair', from: 'vi', to: 'en' });
  });

  it('reads more than two stored languages as Auto-detect into the first', () => {
    assert.deepEqual(languageLine(['en', 'vi', 'zh']), { kind: 'detect', from: null, to: 'en' });
  });
});

describe('durationMinutes', () => {
  const base = { startedAt: '2026-11-05T10:00:00.000Z', endedAt: '2026-11-05T10:10:00.000Z' };

  it('leaves paused time out', () => {
    assert.equal(durationMinutes({ ...base, pausedMs: 4 * 60_000 }), 6);
  });

  it('is at least a minute for a conversation that ran, and zero for one that did not', () => {
    assert.equal(durationMinutes({ ...base, endedAt: '2026-11-05T10:00:10.000Z', pausedMs: 0 }), 1);
    assert.equal(durationMinutes({ ...base, pausedMs: 10 * 60_000 }), 0);
    assert.equal(durationMinutes({ startedAt: 'x', endedAt: 'y', pausedMs: 0 }), 0);
  });
});

describe('detailTurns', () => {
  function turn(position: number, over: Partial<ConversationTurn> = {}): ConversationTurn {
    return {
      position,
      speakerRole: 'speaker_a',
      speakerLabel: null,
      sourceText: 'xin chào',
      displayText: null,
      sourceLanguages: ['vi'],
      translations: { en: 'hello' },
      offsetMs: null,
      ...over,
    } as ConversationTurn;
  }

  it('orders by position and picks each line translation from its own language', () => {
    const lines = detailTurns([
      turn(1, { sourceLanguages: ['en'], sourceText: 'hi', translations: { vi: 'chào' } }),
      turn(0),
    ]);
    assert.deepEqual(
      lines.map((line) => [
        line.position,
        line.sourceLanguage,
        line.translationLanguage,
        line.translation,
      ]),
      [
        [0, 'vi', 'en', 'hello'],
        [1, 'en', 'vi', 'chào'],
      ],
    );
  });

  it('prefers the repaired text and keeps a stored speaker name', () => {
    const [line] = detailTurns([turn(0, { displayText: 'Xin chào.', speakerLabel: 'An' })]);
    assert.equal(line?.sourceText, 'Xin chào.');
    assert.equal(line?.speakerLabel, 'An');
  });
});
