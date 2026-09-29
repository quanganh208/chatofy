import { describe, expect, it } from 'vitest';
import { primaryTranslation } from './conversation.js';

describe('primaryTranslation', () => {
  it('picks the other language of a vi_to_en conversation for a vi turn', () => {
    expect(
      primaryTranslation({ sourceLanguages: ['vi'], translations: { en: 'hello' } }, ['vi', 'en']),
    ).toBe('hello');
  });

  it('picks the other language of an en_to_vi conversation for an en turn', () => {
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
