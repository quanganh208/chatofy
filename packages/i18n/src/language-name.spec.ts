import { describe, expect, it } from 'vitest';
import {
  createTranslator,
  en,
  languageNameForSentence,
  languageNameInSentence,
  vi,
  zh,
} from './index.js';

describe('languageNameInSentence', () => {
  it('lower-cases only the first letter in Vietnamese', () => {
    expect(languageNameInSentence('vi', 'Tiếng Việt')).toBe('tiếng Việt');
  });

  it('leaves English and Chinese as written', () => {
    expect(languageNameInSentence('en', 'Vietnamese')).toBe('Vietnamese');
    expect(languageNameInSentence('zh', '越南语')).toBe('越南语');
  });

  it('survives an empty name', () => {
    expect(languageNameInSentence('vi', '')).toBe('');
  });
});

describe('languageNameForSentence', () => {
  it.each([
    ['vi', vi, 'vi', 'tiếng Việt'],
    ['vi', vi, 'en', 'tiếng Anh'],
    ['vi', vi, 'zh', 'tiếng Trung'],
    ['en', en, 'vi', 'Vietnamese'],
    ['zh', zh, 'vi', '越南语'],
  ] as const)('%s names %s in a sentence', (locale, messages, code, expected) => {
    expect(languageNameForSentence(createTranslator(messages), locale, code)).toBe(expected);
  });

  it('returns an unknown code as written', () => {
    expect(languageNameForSentence(createTranslator(vi), 'vi', 'xx')).toBe('xx');
  });

  it('does not touch the standalone label', () => {
    expect(createTranslator(vi)('common.languageName.vi')).toBe('Tiếng Việt');
  });
});
