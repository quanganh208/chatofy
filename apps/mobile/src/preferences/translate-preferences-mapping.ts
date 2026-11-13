/**
 * How the phone's `TranslateSettings` sits inside the account's preferences
 * document, and back.
 *
 * The document is shared with web and the extension, so the phone owns only its
 * own slice of it: the pair under `pairs.mobile`, and the spoken-voice choices
 * under `voices`. Everything else in the document (theme, speeds, volumes,
 * reading) is left untouched, because a patch only names the fields it changes.
 *
 * The microphone chain is not here: it describes this phone's hardware and stays
 * on the device (`mic-processing-store.ts`).
 */

import {
  LANGUAGE_CODES,
  type LanguageCode,
  type UserPreferences,
  type UserPreferencesPatch,
} from '@chatofy/types';
import type { MicProcessing } from '@chatofy/types';
import { normalizePair } from '../translate/translate-mode.ts';
import { parseTranslateSettings, type TranslateSettings } from '../translate/translate-settings.ts';

/**
 * The settings the screens read. `speak` and the gender belong to the language
 * being spoken aloud, which is the pair's target, so changing the pair shows that
 * language's own choice. Whatever the document holds goes through the same
 * whitelist a stored value always did.
 */
export function settingsFromPreferences(
  preferences: UserPreferences,
  micProcessing: MicProcessing,
): TranslateSettings {
  const pair = normalizePair(preferences.pairs.mobile);
  const spoken = preferences.voices[pair.target];

  const voices: Partial<Record<LanguageCode, string>> = {};
  for (const code of LANGUAGE_CODES) {
    const token = preferences.voices[code]?.voice;
    if (token !== undefined) voices[code] = token;
  }

  return parseTranslateSettings({
    pair,
    speak: spoken?.speak,
    voiceGender: spoken?.gender,
    voices,
    micProcessing,
  });
}

/**
 * The patch that takes the document from `previous` to `next`, or null when
 * nothing the account stores changed (a microphone change alone).
 *
 * Only fields that differ are named, so a pair change never rewrites the voice
 * and a voice change never rewrites the pair. `speak` and the gender are written
 * against the NEXT pair's target, the language they now apply to; a pair change
 * alone does not write them, since they are read back per target.
 *
 * A voice removed locally (a gender change clears them) is sent as `voice: null`,
 * which the document reads as "the gender's default voice".
 */
export function patchFromSettings(
  previous: TranslateSettings,
  next: TranslateSettings,
): UserPreferencesPatch | null {
  const patch: UserPreferencesPatch = {};

  if (previous.pair.source !== next.pair.source || previous.pair.target !== next.pair.target) {
    patch.pairs = { mobile: { source: next.pair.source, target: next.pair.target } };
  }

  const voices: NonNullable<UserPreferencesPatch['voices']> = {};
  const spoken: NonNullable<UserPreferencesPatch['voices']>[LanguageCode] = {};
  if (previous.speak !== next.speak) spoken.speak = next.speak;
  if (previous.voiceGender !== next.voiceGender) spoken.gender = next.voiceGender;
  if (Object.keys(spoken).length > 0) voices[next.pair.target] = spoken;

  for (const code of LANGUAGE_CODES) {
    const token = next.voices[code];
    const before = previous.voices[code];
    if (token === before) continue;
    // `null`, not undefined: JSON drops undefined, so the old token would come back.
    voices[code] = { ...voices[code], voice: token ?? null };
  }
  if (Object.keys(voices).length > 0) patch.voices = voices;

  return Object.keys(patch).length > 0 ? patch : null;
}
