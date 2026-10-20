import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE_PAIR,
  LANGUAGE_CODES,
  allLanguagePairs,
  conversationLanguagesSchema,
  languagePairOf,
  languagePairSchema,
  pairLanguages,
  reversePair,
  samePair,
  sourceLanguagesSchema,
  speakerRoleFor,
  toLanguageCode,
  translationMapSchema,
  translationTargets,
} from './languages.js';
import { z } from 'zod';

// The helpers are generic, so a third language is exercised here without adding
// it to the registry: these cases are what keep "adding a language" a data change.
const THREE = ['vi', 'en', 'ja'] as const;

describe('language pairs', () => {
  it('the registry yields every ordered pair of vi, en and zh, source-major', () => {
    expect(allLanguagePairs(LANGUAGE_CODES)).toEqual([
      { source: 'vi', target: 'en' },
      { source: 'vi', target: 'zh' },
      { source: 'en', target: 'vi' },
      { source: 'en', target: 'zh' },
      { source: 'zh', target: 'vi' },
      { source: 'zh', target: 'en' },
    ]);
  });

  it('three languages generate every ordered pair and no self-pair', () => {
    const pairs = allLanguagePairs(THREE);
    expect(pairs).toHaveLength(6);
    expect(pairs.some((pair) => pair.source === pair.target)).toBe(false);
    expect(pairs).toContainEqual({ source: 'ja', target: 'en' });
  });

  it('reversePair swaps both ways', () => {
    expect(reversePair(languagePairOf('vi', 'en'))).toEqual({ source: 'en', target: 'vi' });
    expect(reversePair(languagePairOf<(typeof THREE)[number]>('ja', 'vi'))).toEqual({
      source: 'vi',
      target: 'ja',
    });
  });

  it('samePair compares by value, which === on two pairs never does', () => {
    const a = languagePairOf('vi', 'en');
    const b = languagePairOf('vi', 'en');
    expect(a === b).toBe(false);
    expect(samePair(a, b)).toBe(true);
    expect(samePair(a, reversePair(a))).toBe(false);
  });

  it('the default is Vietnamese into English', () => {
    expect(DEFAULT_LANGUAGE_PAIR).toEqual({ source: 'vi', target: 'en' });
  });

  it('the schema takes two distinct registry languages', () => {
    expect(languagePairSchema.parse({ source: 'zh', target: 'vi' })).toEqual({
      source: 'zh',
      target: 'vi',
    });
    expect(languagePairSchema.safeParse({ source: 'vi', target: 'vi' }).success).toBe(false);
    expect(languagePairSchema.safeParse({ source: 'xx', target: 'vi' }).success).toBe(false);
    expect(languagePairSchema.safeParse('vi_to_en').success).toBe(false);
  });

  it('the conversation languages put the declared source first', () => {
    expect(pairLanguages(languagePairOf('en', 'vi'))).toEqual(['en', 'vi']);
  });
});

describe('translationTargets', () => {
  it('a single-language turn goes to every other language, in conversation order', () => {
    expect(translationTargets(THREE, ['vi'])).toEqual(['en', 'ja']);
    expect(translationTargets(['en', 'vi'], ['en'])).toEqual(['vi']);
  });

  it('a mixed turn goes to the whole conversation', () => {
    expect(translationTargets(THREE, ['vi', 'en'])).toEqual(['vi', 'en', 'ja']);
  });

  it('a source outside the conversation leaves the whole set as targets', () => {
    expect(translationTargets<string>(THREE, ['fr'])).toEqual(['vi', 'en', 'ja']);
  });
});

describe('speakerRoleFor', () => {
  it('the registry-first language is speaker_a whatever order the conversation declared', () => {
    expect(speakerRoleFor('vi', ['en', 'vi'])).toBe('speaker_a');
    expect(speakerRoleFor('en', ['en', 'vi'])).toBe('speaker_b');
    expect(speakerRoleFor('vi', ['vi', 'en'])).toBe('speaker_a');
  });

  it('Vietnamese stays speaker_a beside Chinese, and English is speaker_a without Vietnamese', () => {
    expect(speakerRoleFor('vi', ['zh', 'vi'])).toBe('speaker_a');
    expect(speakerRoleFor('zh', ['zh', 'vi'])).toBe('speaker_b');
    expect(speakerRoleFor('en', ['zh', 'en'])).toBe('speaker_a');
    expect(speakerRoleFor('zh', ['en', 'zh'])).toBe('speaker_b');
  });
});

describe('toLanguageCode', () => {
  it('reads the primary subtag of a BCP-47 tag', () => {
    expect(toLanguageCode('vi-VN')).toBe('vi');
    expect(toLanguageCode('EN')).toBe('en');
  });

  it('a language outside the registry is null', () => {
    expect(toLanguageCode('xh')).toBeNull();
    expect(toLanguageCode('')).toBeNull();
    expect(toLanguageCode('constructor')).toBeNull();
  });
});

describe('language set schemas', () => {
  it('a conversation needs two distinct languages', () => {
    expect(conversationLanguagesSchema.safeParse(['vi', 'en']).success).toBe(true);
    expect(conversationLanguagesSchema.safeParse(['vi']).success).toBe(false);
    expect(conversationLanguagesSchema.safeParse(['vi', 'vi']).success).toBe(false);
  });

  it('a turn needs at least one source and no repeats', () => {
    expect(sourceLanguagesSchema.safeParse([]).success).toBe(false);
    expect(sourceLanguagesSchema.safeParse(['en', 'en']).success).toBe(false);
    expect(sourceLanguagesSchema.safeParse(['en', 'vi']).success).toBe(true);
  });

  it('a translation map accepts any registry subset and refuses other codes', () => {
    const schema = translationMapSchema(z.string());
    expect(schema.safeParse({ en: 'hello' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
    // 'xx', never a real BCP-47 primary subtag, so this stays a code outside
    // the registry even after a real language joins it — 'ja' would not.
    expect(schema.safeParse({ xx: 'unknown' }).success).toBe(false);
  });
});
