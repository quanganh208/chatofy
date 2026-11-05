/**
 * What the translate screen remembers between launches: the language pair, whether
 * to speak translations, and the voice chosen per output language.
 *
 * Parsed by whitelisting each field over the defaults rather than trusting what was
 * stored: a value written by an older build is not hostile but may be one this
 * build cannot represent, and a setting the screen cannot show is a state the user
 * cannot leave. Storage lives in `translate-settings-store.ts`.
 */

import {
  DEFAULT_LANGUAGE_PAIR,
  DEFAULT_VOICE_GENDER,
  LANGUAGE_CODES,
  sessionLanguagePairSchema,
  voiceGenderSchema,
  type LanguageCode,
  type SessionLanguagePair,
  type VoiceGender,
} from '@chatofy/types';
import { normalizePair } from './translate-mode.ts';

export interface TranslateSettings {
  pair: SessionLanguagePair;
  /** Speak the translation aloud. Off still shows it as text. */
  speak: boolean;
  voiceGender: VoiceGender;
  /** An opaque voice token per OUTPUT language; absent means the language's default. */
  voices: Partial<Record<LanguageCode, string>>;
}

export const DEFAULT_TRANSLATE_SETTINGS: TranslateSettings = {
  pair: { source: DEFAULT_LANGUAGE_PAIR.source, target: DEFAULT_LANGUAGE_PAIR.target },
  speak: true,
  voiceGender: DEFAULT_VOICE_GENDER,
  voices: {},
};

/** A token is only ever echoed back to the server, which bounds it at 64 characters. */
const MAX_VOICE_TOKEN_CHARS = 64;

export function parseTranslateSettings(raw: unknown): TranslateSettings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_TRANSLATE_SETTINGS;
  const stored = raw as Record<string, unknown>;

  const pair = sessionLanguagePairSchema.safeParse(stored['pair']);
  const gender = voiceGenderSchema.safeParse(stored['voiceGender']);

  const voices: Partial<Record<LanguageCode, string>> = {};
  const storedVoices = stored['voices'];
  if (typeof storedVoices === 'object' && storedVoices !== null) {
    for (const code of LANGUAGE_CODES) {
      const token = (storedVoices as Record<string, unknown>)[code];
      if (typeof token === 'string' && token.length > 0 && token.length <= MAX_VOICE_TOKEN_CHARS) {
        voices[code] = token;
      }
    }
  }

  return {
    pair: pair.success ? normalizePair(pair.data) : DEFAULT_TRANSLATE_SETTINGS.pair,
    speak:
      typeof stored['speak'] === 'boolean' ? stored['speak'] : DEFAULT_TRANSLATE_SETTINGS.speak,
    voiceGender: gender.success ? gender.data : DEFAULT_TRANSLATE_SETTINGS.voiceGender,
    voices,
  };
}

/**
 * The settings after a gender pick. A chosen voice has a gender and only that
 * gender's voices are listed, so a real change falls back to the defaults, as web
 * does; kept, the old voice would go on speaking with nothing in the list marked.
 */
export function withVoiceGender(
  settings: TranslateSettings,
  voiceGender: VoiceGender,
): TranslateSettings {
  return voiceGender === settings.voiceGender ? settings : { ...settings, voiceGender, voices: {} };
}
