import { describe, expect, it } from 'vitest';
import { conversationSummarySchema, primaryTranslation } from './conversation.js';

describe('primaryTranslation', () => {
  it('picks the other language of a vi→en conversation for a vi turn', () => {
    expect(
      primaryTranslation({ sourceLanguages: ['vi'], translations: { en: 'hello' } }, ['vi', 'en']),
    ).toBe('hello');
  });

  it('picks the other language of an en→vi conversation for an en turn', () => {
    expect(
      primaryTranslation({ sourceLanguages: ['en'], translations: { vi: 'chào bạn' } }, [
        'en',
        'vi',
      ]),
    ).toBe('chào bạn');
  });

  it('answers empty when every conversation language is a source and nothing was translated', () => {
    expect(
      primaryTranslation({ sourceLanguages: ['vi', 'en'], translations: {} }, ['vi', 'en']),
    ).toBe('');
  });

  it('shows a mixed turn covering every language in a rendering away from its first source', () => {
    // The same pick the rollback down-SQL makes for `targetText`, so the turn
    // reads identically before and after a rollback.
    expect(
      primaryTranslation(
        { sourceLanguages: ['vi', 'en'], translations: { vi: 'xin chào bạn', en: 'hello friend' } },
        ['vi', 'en'],
      ),
    ).toBe('hello friend');
    expect(
      primaryTranslation(
        { sourceLanguages: ['en', 'vi'], translations: { vi: 'xin chào bạn', en: 'hello friend' } },
        ['vi', 'en'],
      ),
    ).toBe('xin chào bạn');
  });

  it('skips an empty rendering when falling back for a mixed turn', () => {
    expect(
      primaryTranslation(
        { sourceLanguages: ['en', 'vi'], translations: { vi: '', en: 'hello friend' } },
        ['vi', 'en'],
      ),
    ).toBe('hello friend');
  });

  it('answers empty when the target has no translation entry', () => {
    expect(primaryTranslation({ sourceLanguages: ['vi'], translations: {} }, ['vi', 'en'])).toBe(
      '',
    );
  });
});

describe('conversationSummarySchema display fields', () => {
  const summary = {
    conversationId: 'c1',
    languages: ['vi', 'en'],
    startedAt: '2026-11-04T02:00:00.000Z',
    endedAt: '2026-11-04T02:10:00.000Z',
    turnCount: 2,
    preview: 'Xin chào',
    hasMinutes: false,
  };

  it('defaults every display field for a list from a build that predates them', () => {
    const parsed = conversationSummarySchema.parse(summary);
    expect(parsed).toMatchObject({
      title: null,
      kind: 'one-way',
      hasRecording: false,
      speakerCount: 0,
      speakers: [],
    });
  });

  it('keeps the display fields a current build sends', () => {
    const parsed = conversationSummarySchema.parse({
      ...summary,
      title: 'Thuê căn hộ',
      kind: 'two-way',
      hasRecording: true,
      speakerCount: 2,
      speakers: ['Lan', 'John'],
    });
    expect(parsed).toMatchObject({
      title: 'Thuê căn hộ',
      kind: 'two-way',
      hasRecording: true,
      speakerCount: 2,
      speakers: ['Lan', 'John'],
    });
  });

  it('refuses more than four listed speakers', () => {
    expect(
      conversationSummarySchema.safeParse({ ...summary, speakers: ['a', 'b', 'c', 'd', 'e'] })
        .success,
    ).toBe(false);
  });
});
