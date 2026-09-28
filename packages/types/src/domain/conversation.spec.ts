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

  it('answers empty when every conversation language is a source', () => {
    expect(
      primaryTranslation({ sourceLanguages: ['vi', 'en'], translations: {} }, ['vi', 'en']),
    ).toBe('');
  });

  it('answers empty when the target has no translation entry', () => {
    expect(primaryTranslation({ sourceLanguages: ['vi'], translations: {} }, ['vi', 'en'])).toBe(
      '',
    );
  });
});
