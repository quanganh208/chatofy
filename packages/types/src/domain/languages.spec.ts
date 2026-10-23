import { describe, expect, it } from 'vitest';
import {
  AUTO_DETECT,
  DEFAULT_LANGUAGE_PAIR,
  IDENTIFIABLE_LANGUAGES,
  LANGUAGE_CODES,
  allLanguagePairs,
  canIdentify,
  detectConversationLanguages,
  isAutoDetectConversation,
  sessionLanguagePairSchema,
  turnCandidates,
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

describe('session language pairs', () => {
  it('a session pair takes a declared pair or an undeclared source', () => {
    expect(sessionLanguagePairSchema.safeParse({ source: 'vi', target: 'en' }).success).toBe(true);
    expect(sessionLanguagePairSchema.safeParse({ source: AUTO_DETECT, target: 'zh' }).success).toBe(
      true,
    );
  });

  it('a session pair still refuses one language twice, a detect target, and unknown codes', () => {
    expect(sessionLanguagePairSchema.safeParse({ source: 'en', target: 'en' }).success).toBe(false);
    expect(sessionLanguagePairSchema.safeParse({ source: 'vi', target: AUTO_DETECT }).success).toBe(
      false,
    );
    expect(sessionLanguagePairSchema.safeParse({ source: 'xx', target: 'en' }).success).toBe(false);
  });

  it('the declared pair schema stays two codes, so REST and live never see detect', () => {
    expect(languagePairSchema.safeParse({ source: AUTO_DETECT, target: 'en' }).success).toBe(false);
  });
});

describe('turnCandidates', () => {
  it('a declared one-way turn can only be in its source', () => {
    expect(turnCandidates({ source: 'vi', target: 'en' }, false)).toEqual(['vi']);
  });

  it('a two-way turn is either side of the pair, source first', () => {
    expect(turnCandidates({ source: 'en', target: 'vi' }, true)).toEqual(['en', 'vi']);
  });

  it('an undeclared source may be any identifiable language, whatever twoWay says', () => {
    expect(turnCandidates({ source: AUTO_DETECT, target: 'en' }, false)).toEqual([
      ...IDENTIFIABLE_LANGUAGES,
    ]);
    expect(turnCandidates({ source: AUTO_DETECT, target: 'en' }, true)).toEqual([
      ...IDENTIFIABLE_LANGUAGES,
    ]);
  });
});

describe('canIdentify', () => {
  it('only Vietnamese and English are told apart', () => {
    expect(IDENTIFIABLE_LANGUAGES).toEqual(['vi', 'en']);
  });

  it('a two-way pair of identifiable languages can be identified', () => {
    expect(canIdentify({ source: 'vi', target: 'en' }, true)).toBe(true);
    expect(canIdentify({ source: 'en', target: 'vi' }, true)).toBe(true);
  });

  it('a two-way pair with Chinese cannot', () => {
    expect(canIdentify({ source: 'vi', target: 'zh' }, true)).toBe(false);
    expect(canIdentify({ source: 'zh', target: 'en' }, true)).toBe(false);
  });

  it('a declared one-way pair has nothing to decide between', () => {
    expect(canIdentify({ source: 'vi', target: 'en' }, false)).toBe(false);
  });

  it('an undeclared source decides between the identifiable languages', () => {
    expect(canIdentify({ source: AUTO_DETECT, target: 'zh' }, false)).toBe(true);
  });
});

describe('auto-detected conversations', () => {
  it('store the target first, then the rest of the registry in registry order', () => {
    expect(detectConversationLanguages('en')).toEqual(['en', 'vi', 'zh']);
    expect(detectConversationLanguages('vi')).toEqual(['vi', 'en', 'zh']);
    expect(detectConversationLanguages('zh')).toEqual(['zh', 'vi', 'en']);
  });

  it('are told from declared ones by holding more than two languages', () => {
    expect(isAutoDetectConversation(detectConversationLanguages('en'))).toBe(true);
    expect(isAutoDetectConversation(['vi', 'en'])).toBe(false);
  });

  it('are valid stored conversation languages', () => {
    expect(conversationLanguagesSchema.safeParse(detectConversationLanguages('zh')).success).toBe(
      true,
    );
  });

  it('keep Vietnamese as speaker_a and give every other language speaker_b', () => {
    for (const target of LANGUAGE_CODES) {
      const languages = detectConversationLanguages(target);
      expect(speakerRoleFor('vi', languages)).toBe('speaker_a');
      expect(speakerRoleFor('en', languages)).toBe('speaker_b');
      expect(speakerRoleFor('zh', languages)).toBe('speaker_b');
    }
  });
});
