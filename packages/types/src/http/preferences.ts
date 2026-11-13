// Account preferences — one document per user, shared by web, mobile and the
// extension.
//
// What belongs here is what a PERSON chose: how translations sound, how the
// transcript reads, which theme they like, which languages each surface opens
// in. What stays on the device is what only that device can mean: panel widths
// (a screen's size), the microphone chain (a machine's hardware), auth tokens,
// and the tab-scoped "a call is running here" marker.
//
// ## Reading is tolerant, writing is strict
//
// `parseUserPreferences` never throws and never drops the whole document: each
// field is checked on its own and falls back to its default, so a value written
// by an older or newer build costs that one field, not the reader's whole setup.
// That is the same discipline every client already applied to its local store.
//
// A PATCH is the opposite: it is merged over the stored document and the RESULT
// must pass `userPreferencesSchema` whole, or the request is refused. A client
// cannot write a state another client cannot represent.
//
// ## `reading` is owned by web
//
// The transcript's look (display mode, appearance, stage, text size, …) is a
// web concept with a large, web-owned schema and its own whitelist
// (`apps/web/src/lib/translate-settings.ts`). The contract bounds it as a plain
// object under the document's byte cap and leaves the field-level whitelist to
// the one client that renders it, instead of keeping two copies of that schema
// in step.
import { z } from 'zod';
import {
  DEFAULT_LANGUAGE_PAIR,
  languageCodeSchema,
  languagePairOf,
  languagePairSchema,
  sessionLanguagePairSchema,
  type LanguageCode,
  type LanguagePair,
  type SessionLanguagePair,
} from '../domain/languages.js';
import { voiceGenderSchema } from '../domain/transcript.js';

export const PREFERENCES_LIMITS = {
  /** Serialized size of the whole stored document. */
  MAX_DOCUMENT_BYTES: 16_384,
  /** Matches the voice token cap every client already enforced locally. */
  MAX_VOICE_TOKEN_CHARS: 64,
  /** Translation-context ids are client-minted; bounded like any opaque id. */
  MAX_CONTEXT_ID_CHARS: 64,
  MIN_SPEED: 0.5,
  MAX_SPEED: 2,
} as const;

export const themeChoiceSchema = z.enum(['light', 'dark', 'system']);
export type ThemeChoice = z.infer<typeof themeChoiceSchema>;

export const translateModeSchema = z.enum(['one-way', 'two-way']);
export type TranslateModePreference = z.infer<typeof translateModeSchema>;

export const captionSizeSchema = z.enum(['sm', 'md', 'lg', 'xl']);
export type CaptionSizePreference = z.infer<typeof captionSizeSchema>;

/**
 * How one language is spoken. Every field optional: absent means that
 * language's default on whichever client reads it, so a mobile client that only
 * knows `speak`, `gender` and `voice` round-trips the rest untouched.
 */
export const languageVoicePreferenceSchema = z
  .object({
    speak: z.boolean(),
    gender: voiceGenderSchema,
    speed: z.number().min(PREFERENCES_LIMITS.MIN_SPEED).max(PREFERENCES_LIMITS.MAX_SPEED),
    voice: z.string().min(1).max(PREFERENCES_LIMITS.MAX_VOICE_TOKEN_CHARS),
    /** Playback gain, 0..1. */
    volume: z.number().min(0).max(1),
  })
  .partial();
export type LanguageVoicePreference = z.infer<typeof languageVoicePreferenceSchema>;

/**
 * One language's voice inside a PATCH. Same as the stored shape, except that
 * `voice: null` removes the token — "speak with the gender default". JSON has
 * no `undefined`, so without it a cleared voice could never reach the server
 * and the old token would come back on the next read. The stored document
 * never holds null: {@link mergePreferences} deletes the key.
 */
export const languageVoicePatchSchema = languageVoicePreferenceSchema.extend({
  voice: languageVoicePreferenceSchema.shape.voice.unwrap().nullable().optional(),
});
export type LanguageVoicePatch = z.infer<typeof languageVoicePatchSchema>;

/** Merge a voice patch over a stored voice, honouring `voice: null`. */
function mergeVoice(
  base: LanguageVoicePreference | LanguageVoicePatch | undefined,
  patch: LanguageVoicePatch,
): LanguageVoicePatch {
  return { ...base, ...patch };
}

function withoutNullVoice(voice: LanguageVoicePatch): LanguageVoicePreference {
  const { voice: token, ...rest } = voice;
  return token === null || token === undefined ? rest : { ...rest, voice: token };
}

export const callPreferencesSchema = z.object({
  captions: z.boolean(),
  captionSize: captionSizeSchema,
  /** 0 to 1: how loud the other people's own voices are. */
  originalVolume: z.number().min(0).max(1),
});
export type CallPreferencesDocument = z.infer<typeof callPreferencesSchema>;

/**
 * The pair each surface opens with. Per surface because they are different
 * situations: a meeting capture usually translates the OTHER side, a two-way
 * conversation cannot auto-detect, and so on — one shared pair would let a
 * choice on one surface open another in a state it cannot run.
 */
export const surfacePairsSchema = z.object({
  webOneWay: sessionLanguagePairSchema,
  webTwoWay: languagePairSchema,
  mobile: sessionLanguagePairSchema,
  extension: languagePairSchema,
});
export type SurfacePairs = z.infer<typeof surfacePairsSchema>;
export type PreferenceSurface = keyof SurfacePairs;

const plainObjectSchema = z.record(z.string(), z.unknown());

export const userPreferencesSchema = z.object({
  theme: themeChoiceSchema,
  voices: z.partialRecord(languageCodeSchema, languageVoicePreferenceSchema),
  /** The saved AI Context a new conversation starts with, or null for none. */
  contextId: z.string().min(1).max(PREFERENCES_LIMITS.MAX_CONTEXT_ID_CHARS).nullable(),
  /** Which `/translate` page the sidebar opens. */
  translateMode: translateModeSchema,
  call: callPreferencesSchema,
  /** The language a meeting is joined in, or null to ask. */
  conferenceLanguage: languageCodeSchema.nullable(),
  pairs: surfacePairsSchema,
  /** Web-owned transcript look; whitelisted by web. See the file header. */
  reading: plainObjectSchema,
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

/**
 * A partial document: any top-level field may be absent, and the object-valued
 * ones (`voices`, its entries, `call`, `pairs`, `reading`) are merged one level
 * further by {@link mergePreferences} rather than replaced.
 *
 * `null` on a nullable field (`contextId`, `conferenceLanguage`) sets it to
 * null; it never means "delete".
 */
export const userPreferencesPatchSchema = z
  .object({
    theme: themeChoiceSchema,
    voices: z.partialRecord(languageCodeSchema, languageVoicePatchSchema),
    contextId: userPreferencesSchema.shape.contextId,
    translateMode: translateModeSchema,
    call: callPreferencesSchema.partial(),
    conferenceLanguage: userPreferencesSchema.shape.conferenceLanguage,
    pairs: surfacePairsSchema.partial(),
    reading: plainObjectSchema,
  })
  .partial()
  .strict();
export type UserPreferencesPatch = z.infer<typeof userPreferencesPatchSchema>;

/** `PATCH /me/preferences` body. */
export const updatePreferencesRequestSchema = z.object({
  preferences: userPreferencesPatchSchema,
});
export type UpdatePreferencesRequest = z.infer<typeof updatePreferencesRequestSchema>;

/** `GET`, `PATCH` and `DELETE /me/preferences` all answer with this. */
export const preferencesResponseSchema = z.object({
  preferences: userPreferencesSchema,
  /** When the stored row last changed; null while the account holds only defaults. */
  updatedAt: z.string().nullable(),
});
export type PreferencesResponse = z.infer<typeof preferencesResponseSchema>;

/**
 * The same answer as a CLIENT reads it: the document is left unparsed.
 *
 * A newer API may store a language, theme or field this build has never heard
 * of. Parsed strictly, one such value would fail the whole response — the client
 * would stop seeing remote changes, and a save the server DID store would look
 * failed and be retried forever. Clients hand `preferences` to
 * `parseUserPreferences`, which drops only the fields it cannot read.
 */
export const preferencesReadResponseSchema = z.object({
  preferences: z.unknown(),
  updatedAt: z.string().nullable(),
});
export type PreferencesReadResponse = z.infer<typeof preferencesReadResponseSchema>;

/**
 * The document a new account starts with.
 *
 * "Smart" in one place only: the language the account's UI and mail are in is
 * the language a reader most likely wants translations INTO, so every surface's
 * target is that language when the registry can pair it. Theme is `system`, so a
 * first visit follows the device. Everything else is each client's own default.
 */
export function defaultUserPreferences(locale?: string | null): UserPreferences {
  const target = localeLanguage(locale);
  // Into the account's language, from English — or from Vietnamese when the
  // account's language IS English. No known language keeps the registry default.
  const pair: LanguagePair =
    target === null ? DEFAULT_LANGUAGE_PAIR : languagePairOf(target === 'en' ? 'vi' : 'en', target);
  return {
    theme: 'system',
    voices: {},
    contextId: null,
    translateMode: 'one-way',
    call: { captions: true, captionSize: 'md', originalVolume: 1 },
    conferenceLanguage: null,
    pairs: {
      webOneWay: { ...pair } as SessionLanguagePair,
      webTwoWay: { ...pair },
      mobile: { ...pair } as SessionLanguagePair,
      extension: { ...pair },
    },
    reading: {},
  };
}

function localeLanguage(locale?: string | null): LanguageCode | null {
  const parsed = languageCodeSchema.safeParse(locale ?? '');
  return parsed.success ? parsed.data : null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read a stored or cached document without trusting it.
 *
 * Field by field over `fallback`: one bad field falls back alone. `voices` is
 * checked per language and `pairs` per surface, for the same reason.
 */
export function parseUserPreferences(raw: unknown, fallback: UserPreferences): UserPreferences {
  if (!isPlainObject(raw)) return fallback;
  const pick = <T>(schema: z.ZodType<T>, value: unknown, otherwise: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : otherwise;
  };

  const voices: UserPreferences['voices'] = {};
  if (isPlainObject(raw['voices'])) {
    for (const [code, value] of Object.entries(raw['voices'])) {
      const language = languageCodeSchema.safeParse(code);
      const voice = languageVoicePreferenceSchema.safeParse(value);
      if (language.success && voice.success) voices[language.data] = voice.data;
    }
  }

  const rawPairs = isPlainObject(raw['pairs']) ? raw['pairs'] : {};
  const rawCall = isPlainObject(raw['call']) ? raw['call'] : {};
  const shape = surfacePairsSchema.shape;
  const callShape = callPreferencesSchema.shape;

  return {
    theme: pick(themeChoiceSchema, raw['theme'], fallback.theme),
    voices,
    contextId: pick(userPreferencesSchema.shape.contextId, raw['contextId'], fallback.contextId),
    translateMode: pick(translateModeSchema, raw['translateMode'], fallback.translateMode),
    call: {
      captions: pick(callShape.captions, rawCall['captions'], fallback.call.captions),
      captionSize: pick(callShape.captionSize, rawCall['captionSize'], fallback.call.captionSize),
      originalVolume: pick(
        callShape.originalVolume,
        rawCall['originalVolume'],
        fallback.call.originalVolume,
      ),
    },
    conferenceLanguage: pick(
      userPreferencesSchema.shape.conferenceLanguage,
      raw['conferenceLanguage'],
      fallback.conferenceLanguage,
    ),
    pairs: {
      webOneWay: pick(shape.webOneWay, rawPairs['webOneWay'], fallback.pairs.webOneWay),
      webTwoWay: pick(shape.webTwoWay, rawPairs['webTwoWay'], fallback.pairs.webTwoWay),
      mobile: pick(shape.mobile, rawPairs['mobile'], fallback.pairs.mobile),
      extension: pick(shape.extension, rawPairs['extension'], fallback.pairs.extension),
    },
    reading: isPlainObject(raw['reading']) ? raw['reading'] : fallback.reading,
  };
}

/**
 * Apply a patch to a document. Pure: neither argument is mutated.
 *
 * Scalars and nullable fields replace. `call`, `pairs` and `reading` merge one
 * level; `voices` merges per language and then per field, so changing the
 * English speed never resets the English voice, and never touches Vietnamese.
 * Used by the API to apply a PATCH and by clients to apply one optimistically,
 * so both sides compute the same result.
 */
export function mergePreferences(
  base: UserPreferences,
  patch: UserPreferencesPatch,
): UserPreferences {
  const voices: UserPreferences['voices'] = { ...base.voices };
  for (const [code, value] of Object.entries(patch.voices ?? {}) as [
    LanguageCode,
    LanguageVoicePatch | undefined,
  ][]) {
    if (value) voices[code] = withoutNullVoice(mergeVoice(base.voices[code], value));
  }
  return {
    theme: patch.theme ?? base.theme,
    voices,
    contextId: patch.contextId !== undefined ? patch.contextId : base.contextId,
    translateMode: patch.translateMode ?? base.translateMode,
    call: { ...base.call, ...patch.call },
    conferenceLanguage:
      patch.conferenceLanguage !== undefined ? patch.conferenceLanguage : base.conferenceLanguage,
    pairs: { ...base.pairs, ...patch.pairs },
    reading: { ...base.reading, ...patch.reading },
  };
}

/**
 * Combine two pending patches into one, the later winning per field, with the
 * same depth {@link mergePreferences} merges at. What a client sends when
 * several changes queued while a save was in flight or offline.
 */
export function combinePreferencePatches(
  earlier: UserPreferencesPatch,
  later: UserPreferencesPatch,
): UserPreferencesPatch {
  const out: UserPreferencesPatch = { ...earlier, ...later };
  if (earlier.voices || later.voices) {
    const voices: NonNullable<UserPreferencesPatch['voices']> = { ...earlier.voices };
    for (const [code, value] of Object.entries(later.voices ?? {}) as [
      LanguageCode,
      LanguageVoicePatch | undefined,
    ][]) {
      // Keeps `voice: null` so the combined patch still clears the token.
      if (value) voices[code] = mergeVoice(earlier.voices?.[code], value);
    }
    out.voices = voices;
  }
  if (earlier.call || later.call) out.call = { ...earlier.call, ...later.call };
  if (earlier.pairs || later.pairs) out.pairs = { ...earlier.pairs, ...later.pairs };
  if (earlier.reading || later.reading) out.reading = { ...earlier.reading, ...later.reading };
  return out;
}

/** Bytes the document takes once serialized, as the API measures its cap. */
export function preferencesByteLength(preferences: UserPreferences): number {
  return new TextEncoder().encode(JSON.stringify(preferences)).length;
}
