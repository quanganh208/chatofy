import { describe, expect, it } from 'vitest';
import {
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
