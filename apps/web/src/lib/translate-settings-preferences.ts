/**
 * The web's `TranslateSettings`, read from and written to the account's
 * preferences document.
 *
 * The document is shared by three clients, so its shape is theirs in common:
 * a pair per surface, a partial voice setup per language, and one plain `reading`
 * object only web interprets. This file is the one place that translates between
 * that shape and the flat object every web screen reads:
 *
 * | `TranslateSettings`       | document                  |
 * | ------------------------- | ------------------------- |
 * | `languagePair`            | `pairs.webOneWay`         |
 * | `twoWayPair`              | `pairs.webTwoWay`         |
 * | `voiceByLanguage`         | `voices`                  |
 * | `contextId`               | `contextId`               |
 * | {@link READING_FIELDS}    | `reading`                 |
 * | `micProcessing`           | — (local, see `mic-processing-store.ts`) |
 *
 * Reading goes through the same whitelist the local store used, field by field, so
 * one value this build cannot represent costs that value and nothing else. Writing
 * produces a PATCH that the API validates whole — so it must never carry a value the
 * contract refuses (an empty voice token, a rate outside 0.5..2), or the save would
 * be refused and retried forever.
 */
import {
  DEFAULT_LANGUAGE_PAIR,
  LANGUAGE_CODES,
  PREFERENCES_LIMITS,
  type LanguageVoicePreference,
  type MicProcessing,
  type UserPreferences,
  type UserPreferencesPatch,
} from '@chatofy/types';
import { loadMicProcessing } from '@/lib/mic-processing-store';
import { currentPreferences } from '@/lib/preferences/active-preferences';
import {
  DEFAULT_LANGUAGE_VOICE,
  DEFAULT_TRANSLATE_SETTINGS,
  READING_FIELDS,
  canRunTwoWay,
  readingSettingsSchema,
  representablePair,
  storedVoiceByLanguageSchema,
  type LanguageVoiceSetup,
  type TranslateSettings,
  type VoiceByLanguage,
} from '@/lib/translate-settings';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The reading defaults, so a document with no `reading` yet reads as today's look. */
const DEFAULT_READING: Record<string, unknown> = Object.fromEntries(
  READING_FIELDS.map((field) => [field, DEFAULT_TRANSLATE_SETTINGS[field]]),
);

/**
 * The web settings a document describes.
 *
 * `micProcessing` comes from the device, not the document, and is passed in.
 */
export function translateSettingsFromPreferences(
  preferences: UserPreferences,
  micProcessing: MicProcessing,
): TranslateSettings {
  const reading = readingSettingsSchema.parse({
    ...DEFAULT_READING,
    ...(isPlainObject(preferences.reading) ? preferences.reading : {}),
  });
  const voiceByLanguage = storedVoiceByLanguageSchema.parse(
    Object.fromEntries(
      LANGUAGE_CODES.map((code) => [
        code,
        { ...DEFAULT_LANGUAGE_VOICE, ...preferences.voices[code] },
      ]),
    ),
  ) as VoiceByLanguage;
  const twoWay = preferences.pairs.webTwoWay;
  return {
    // A stored pair the current UI cannot show is a state the reader cannot leave;
    // both are pulled onto one it can, exactly as the pickers do on every pick.
    languagePair: representablePair(preferences.pairs.webOneWay),
    twoWayPair: canRunTwoWay(twoWay) ? twoWay : DEFAULT_LANGUAGE_PAIR,
    voiceByLanguage,
    ...reading,
    contextId: preferences.contextId,
    micProcessing,
  };
}

/**
 * One mapping per (document, mic chain) pair, so a render that changed neither gets
 * the same object back — consumers put `settings` in effect deps.
 */
const mapped = new WeakMap<UserPreferences, { mic: MicProcessing; settings: TranslateSettings }>();

export function translateSettingsOf(
  preferences: UserPreferences,
  mic: MicProcessing,
): TranslateSettings {
  const hit = mapped.get(preferences);
  if (hit && hit.mic === mic) return hit.settings;
  const settings = translateSettingsFromPreferences(preferences, mic);
  mapped.set(preferences, { mic, settings });
  return settings;
}

/** The settings as of now, outside React: the meeting's speaker leg and call attempt. */
export function currentTranslateSettings(): TranslateSettings {
  return translateSettingsOf(currentPreferences(), loadMicProcessing());
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * One language's setup as the contract accepts it.
 *
 * Every field present, so a setup written here reads back the same on a client
 * that fills absent fields with a different default.
 */
function voicePreference(setup: LanguageVoiceSetup): LanguageVoicePreference {
  const out: LanguageVoicePreference = {
    speak: setup.speak,
    gender: setup.gender,
    speed: clamp(setup.speed, PREFERENCES_LIMITS.MIN_SPEED, PREFERENCES_LIMITS.MAX_SPEED),
    volume: clamp(setup.volume, 0, 1),
  };
  const voice = setup.voice;
  if (voice && voice.length <= PREFERENCES_LIMITS.MAX_VOICE_TOKEN_CHARS) out.voice = voice;
  return out;
}

/**
 * The document PATCH a settings change makes.
 *
 * Only the fields the change names, so two devices editing different settings do
 * not overwrite each other. `micProcessing` is dropped: it never leaves the device.
 */
export function preferencesPatchFromTranslateSettings(
  patch: Partial<TranslateSettings>,
): UserPreferencesPatch {
  const out: UserPreferencesPatch = {};

  const pairs: NonNullable<UserPreferencesPatch['pairs']> = {};
  if (patch.languagePair) pairs.webOneWay = patch.languagePair;
  if (patch.twoWayPair) pairs.webTwoWay = patch.twoWayPair;
  if (Object.keys(pairs).length > 0) out.pairs = pairs;

  if (patch.voiceByLanguage) {
    const voices: NonNullable<UserPreferencesPatch['voices']> = {};
    for (const code of LANGUAGE_CODES) {
      const setup = patch.voiceByLanguage[code];
      if (setup) voices[code] = voicePreference(setup);
    }
    out.voices = voices;
  }

  if (patch.contextId !== undefined) {
    const id = patch.contextId;
    // The contract has no empty id; an empty or over-long one is "no context".
    out.contextId = id && id.length <= PREFERENCES_LIMITS.MAX_CONTEXT_ID_CHARS ? id : null;
  }

  const reading: Record<string, unknown> = {};
  for (const field of READING_FIELDS) {
    if (patch[field] !== undefined) reading[field] = patch[field];
  }
  if (Object.keys(reading).length > 0) out.reading = reading;

  return out;
}
