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
 * produces a PATCH of only what changed, which the API validates whole — so it must
 * never carry a value the contract refuses (an empty voice token, a rate outside
 * 0.5..2), or the save would be refused and the reader's change dropped.
 */
import {
  DEFAULT_LANGUAGE_PAIR,
  LANGUAGE_CODES,
  PREFERENCES_LIMITS,
  type LanguageVoicePatch,
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

/** Every language's setup as the page shows it: the document's fields over the defaults. */
function voiceByLanguageOf(preferences: UserPreferences): VoiceByLanguage {
  return storedVoiceByLanguageSchema.parse(
    Object.fromEntries(
      LANGUAGE_CODES.map((code) => [
        code,
        { ...DEFAULT_LANGUAGE_VOICE, ...preferences.voices[code] },
      ]),
    ),
  );
}

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
  const voiceByLanguage = voiceByLanguageOf(preferences);
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
 * The fields of one language's setup that differ from what the page shows now,
 * as the contract accepts them — or null when nothing changed.
 *
 * Only changed fields, never the whole setup: the server merges voices per
 * language and then per field, so a field this tab did not change must not be
 * sent, or a stale copy here would overwrite a choice made on another device. A
 * field the document leaves out stays out (absent means "that client's default")
 * unless the reader actually changed what it shows.
 *
 * A token removed or replaced by one the contract refuses (empty, over-long) is
 * sent as `voice: null`, which REMOVES the stored one: a gender change means
 * "that gender's default voice", and leaving the field out would keep the old
 * voice named.
 */
function changedVoiceFields(
  setup: LanguageVoiceSetup,
  shown: LanguageVoiceSetup,
): LanguageVoicePatch | null {
  const out: LanguageVoicePatch = {};
  if (setup.speak !== shown.speak) out.speak = setup.speak;
  if (setup.gender !== shown.gender) out.gender = setup.gender;
  const speed = clamp(setup.speed, PREFERENCES_LIMITS.MIN_SPEED, PREFERENCES_LIMITS.MAX_SPEED);
  if (speed !== shown.speed) out.speed = speed;
  const volume = clamp(setup.volume, 0, 1);
  if (volume !== shown.volume) out.volume = volume;
  const voice =
    setup.voice && setup.voice.length <= PREFERENCES_LIMITS.MAX_VOICE_TOKEN_CHARS
      ? setup.voice
      : null;
  if (voice !== (shown.voice ?? null)) out.voice = voice;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The document PATCH a settings change makes.
 *
 * Only the fields the change names, so two devices editing different settings do
 * not overwrite each other. `micProcessing` is dropped: it never leaves the device.
 *
 * `voiceByLanguage` arrives as a whole map (every caller builds the next map from
 * the one it rendered), so it is diffed against `base` — the document this tab
 * holds — and only the languages and fields that changed are sent.
 */
export function preferencesPatchFromTranslateSettings(
  patch: Partial<TranslateSettings>,
  base: UserPreferences = currentPreferences(),
): UserPreferencesPatch {
  const out: UserPreferencesPatch = {};

  const pairs: NonNullable<UserPreferencesPatch['pairs']> = {};
  if (patch.languagePair) pairs.webOneWay = patch.languagePair;
  if (patch.twoWayPair) pairs.webTwoWay = patch.twoWayPair;
  if (Object.keys(pairs).length > 0) out.pairs = pairs;

  if (patch.voiceByLanguage) {
    const shown = voiceByLanguageOf(base);
    const voices: NonNullable<UserPreferencesPatch['voices']> = {};
    for (const code of LANGUAGE_CODES) {
      const setup = patch.voiceByLanguage[code];
      const changed = setup ? changedVoiceFields(setup, shown[code]) : null;
      if (changed) voices[code] = changed;
    }
    if (Object.keys(voices).length > 0) out.voices = voices;
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
