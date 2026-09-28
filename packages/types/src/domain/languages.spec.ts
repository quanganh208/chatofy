import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  DEFAULT_TRANSLATION_DIRECTION,
  TRANSLATION_DIRECTIONS,
  allDirections,
  conversationLanguagesOf,
  conversationLanguagesSchema,
  directionLanguages,
  directionOf,
  reverseDirection,
  sourceLanguagesSchema,
  speakerRoleFor,
  toLanguageCode,
  translationDirectionSchema,
  translationMapSchema,
  translationTargets,
  type TranslationDirection,
} from './languages.js';
import { z } from 'zod';

// The helpers are generic, so a third language is exercised here without adding
// it to the registry: these cases are what keep "adding a language" a data change.
const THREE = ['vi', 'en', 'ja'] as const;

describe('directions', () => {
  it('the registry generates exactly the two directions the wire already carries', () => {
    expect(new Set(TRANSLATION_DIRECTIONS)).toEqual(new Set(['vi_to_en', 'en_to_vi']));
    expectTypeOf<TranslationDirection>().toEqualTypeOf<'vi_to_en' | 'en_to_vi'>();
  });

  it('three languages generate every ordered pair and no self-pair', () => {
    const directions = allDirections(THREE);
    expect(directions).toHaveLength(6);
    expect(directions).not.toContain('vi_to_vi');
    expect(directions).toContain('ja_to_en');
  });

  it('directionOf and directionLanguages round-trip', () => {
    for (const direction of allDirections(THREE)) {
      const { source, target } = directionLanguages(direction);
      expect(directionOf(source, target)).toBe(direction);
    }
  });

  it('reverseDirection swaps both ways', () => {
    expect(reverseDirection('vi_to_en')).toBe('en_to_vi');
    expect(reverseDirection('en_to_vi')).toBe('vi_to_en');
    expect(reverseDirection(directionOf<(typeof THREE)[number]>('ja', 'vi'))).toBe('vi_to_ja');
  });

  it('the default is Vietnamese into English', () => {
    expect(DEFAULT_TRANSLATION_DIRECTION).toBe('vi_to_en');
  });

  it('an existing payload direction still parses', () => {
    expect(translationDirectionSchema.parse('en_to_vi')).toBe('en_to_vi');
    expect(translationDirectionSchema.safeParse('vi_to_vi').success).toBe(false);
  });

  it('the conversation languages put the declared source first', () => {
    expect(conversationLanguagesOf('en_to_vi')).toEqual(['en', 'vi']);
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
