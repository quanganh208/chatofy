import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TranscriptSegment } from '@chatofy/types';
import { finishedRow, pickTranslation, turnRows } from './turn-display.ts';

function segment(over: Partial<TranscriptSegment>): TranscriptSegment {
  return {
    id: 's1',
    sessionId: 'sess-1',
    speakerRole: 'speaker_a',
    sourceLanguages: ['vi'],
    translations: { en: 'hello' },
    sourceText: 'xin chào',
    audioUrl: null,
    createdAt: '2026-11-05T00:00:00Z',
    ...over,
  };
}

describe('pickTranslation', () => {
  it('skips the spoken language and takes the translation that has text', () => {
    assert.deepEqual(pickTranslation({ vi: 'xin chào', en: 'hello' }, ['vi']), {
      language: 'en',
      text: 'hello',
    });
  });

  it('reads a turn already in the output language as transcript only', () => {
    assert.equal(pickTranslation({ en: 'hello' }, ['en']), null);
  });

  it('shows a mixed turn its first translation, whatever language that is', () => {
    assert.deepEqual(pickTranslation({ vi: 'xin chào' }, ['vi', 'en']), {
      language: 'vi',
      text: 'xin chào',
    });
  });

  it('ignores a blank translation', () => {
    assert.equal(pickTranslation({ en: '   ' }, ['vi']), null);
  });
});

describe('finishedRow', () => {
  it('chooses the pane from the turn, not from the pair', () => {
    // A two-way reply spoken in English comes back in Vietnamese.
    const row = finishedRow(
      segment({ sourceLanguages: ['en'], sourceText: 'hello', translations: { vi: 'xin chào' } }),
      undefined,
      false,
    );
    assert.equal(row.sourceLanguage, 'en');
    assert.equal(row.translationLanguage, 'vi');
    assert.equal(row.translation, 'xin chào');
  });

  it('prefers the repaired display text over the raw recognition', () => {
    assert.equal(finishedRow(segment({}), 'Xin chào.', false).sourceText, 'Xin chào.');
  });

  it('marks a mixed turn and leaves its language unnamed', () => {
    const row = finishedRow(segment({ sourceLanguages: ['vi', 'en'] }), undefined, false);
    assert.equal(row.mixed, true);
    assert.equal(row.sourceLanguage, undefined);
  });
});

describe('turnRows', () => {
  it('lists finished turns before live ones and drops a live line whose turn finished', () => {
    const rows = turnRows(
      [segment({})],
      {},
      { 'sess-1': 'stalled' },
      [
        { sessionId: 'sess-1', text: 'xin', translation: '' },
        { sessionId: 'sess-2', text: 'tạm biệt', translation: 'bye', language: 'vi' },
        { sessionId: 'sess-3', text: '', translation: '' },
      ],
      'en',
    );
    assert.deepEqual(
      rows.map((row) => [row.key, row.live, row.unheard]),
      [
        ['sess-1', false, true],
        ['sess-2', true, false],
      ],
    );
    assert.equal(rows[1]?.translationLanguage, 'en');
  });
});
