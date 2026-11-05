import { describe, expect, it } from 'vitest';
import {
  ConferenceTranslationBroadcastSchema,
  ConferenceTranslationRevisionSchema,
  ConferenceTranslationSubtitleSchema,
  MAX_CONFERENCE_TURN_TEXT_CHARS,
} from './conference-translation-events.js';

/** A subtitle as every client before multi-language turns sends it. */
const subtitle = (over: Record<string, unknown> = {}) => ({
  sourceLanguage: 'vi',
  targetLanguage: 'en',
  sourceText: 'xin chào',
  translatedText: 'hello',
  isFinal: true,
  turnId: '3f1c2a54-7d2e-4b8a-9c11-2a6b5e0d4f10',
  ...over,
});

describe('ConferenceTranslationSubtitleSchema translations', () => {
  it('parses a subtitle without translations', () => {
    const parsed = ConferenceTranslationSubtitleSchema.parse(subtitle());
    expect(parsed.translations).toBeUndefined();
    expect(parsed.translatedText).toBe('hello');
  });

  it('carries a translation per language beside the primary one', () => {
    const parsed = ConferenceTranslationSubtitleSchema.parse(
      subtitle({ translations: { en: 'hello', zh: '你好' } }),
    );
    expect(parsed.translations).toEqual({ en: 'hello', zh: '你好' });
  });

  it('refuses a language outside the registry and an over-long entry', () => {
    expect(
      ConferenceTranslationSubtitleSchema.safeParse(subtitle({ translations: { fr: 'salut' } }))
        .success,
    ).toBe(false);
    expect(
      ConferenceTranslationSubtitleSchema.safeParse(
        subtitle({ translations: { zh: 'x'.repeat(MAX_CONFERENCE_TURN_TEXT_CHARS + 1) } }),
      ).success,
    ).toBe(false);
  });

  it('still requires the primary target fields', () => {
    const { translatedText: _dropped, ...rest } = subtitle({ translations: { en: 'hello' } });
    expect(ConferenceTranslationSubtitleSchema.safeParse(rest).success).toBe(false);
  });
});

describe('ConferenceTranslationRevisionSchema', () => {
  const turnId = '6f1d2a8e-3b4c-4d5e-8f60-718293a4b5c6';

  it('travels in the broadcast envelope', () => {
    const parsed = ConferenceTranslationBroadcastSchema.parse({
      revision: { turnId, translations: { en: 'hello' } },
    });
    expect(parsed.revision?.translations.en).toBe('hello');
  });

  it('refuses a turn id that is not a uuid', () => {
    expect(
      ConferenceTranslationRevisionSchema.safeParse({ turnId: 'x', translations: { en: 'a' } })
        .success,
    ).toBe(false);
  });

  it('refuses a language the registry does not hold', () => {
    expect(
      ConferenceTranslationRevisionSchema.safeParse({ turnId, translations: { fr: 'salut' } })
        .success,
    ).toBe(false);
  });
});
