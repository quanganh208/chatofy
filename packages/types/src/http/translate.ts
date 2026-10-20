// Translate HTTP contracts — schema-first. Turn-based (record full utterance →
// POST → response) voice translation. Audio travels as base64 inside the standard
// ApiResponse<T> envelope. Language pairs come from the language registry.
import { z } from 'zod';
import { languagePairSchema } from '../domain/languages.js';
import { voiceGenderSchema, DEFAULT_VOICE_GENDER } from '../domain/transcript.js';

/** POST /translate request body. */
export const translateRequestSchema = z.object({
  /** Base64-encoded recorded audio bytes (no data-url prefix). */
  audioBase64: z.string().min(1),
  /** MIME type of the recorded audio, e.g. "audio/webm". */
  audioMimeType: z.string().min(1),
  /** Which language is spoken and which it is translated into. Omitted means `DEFAULT_LANGUAGE_PAIR`. */
  languagePair: languagePairSchema.optional(),
  /**
   * The removed `${source}_to_${target}` string, refused rather than stripped.
   * `languagePair` is optional, so a caller still sending only this would
   * otherwise be translated vi→en whatever it asked for, with nothing to say so.
   */
  direction: z
    .never({ error: 'direction was removed; send languagePair: { source, target }' })
    .optional(),
  /**
   * Which voice speaks the translation. Applies to whichever language the
   * pair translates into — both engines have a voice for each gender.
   */
  voiceGender: voiceGenderSchema.default(DEFAULT_VOICE_GENDER),
  /**
   * Speaking rate for the synthesized translation, 0.5–2.
   *
   * Mirrors the WebSocket contract deliberately: two public surfaces that accept
   * the same turn should not disagree about what a turn can be configured with.
   *
   * CLAMPED rather than validated, for the same reason as on the socket — and
   * additionally because the value ends up at a sidecar that has no auth of its
   * own and serializes all synthesis behind one lock, where an extreme rate is a
   * denial of service rather than a bad request. That service bounds it too.
   *
   * `.optional()`, so no existing caller changes: `z.infer` is the OUTPUT type,
   * where a `.default()` field would be required in TypeScript.
   */
  speed: z
    .number()
    .catch(1)
    .transform((value) => Math.min(2, Math.max(0.5, value)))
    .optional(),
  // `voiceOutput` is deliberately NOT mirrored here, and the asymmetry is the
  // point rather than an oversight. On the socket, turning speech off means some
  // events simply do not arrive. Here, synthesized audio is a REQUIRED field of
  // the response — so the same option would either make that field empty, which
  // every existing caller would read as a synthesis failure, or force a second
  // response shape. That is a contract decision this endpoint has not needed to
  // make: nothing calls it without wanting the audio.
});
export type TranslateRequest = z.infer<typeof translateRequestSchema>;

/** POST /translate success payload (inner data of the response envelope). */
export const translateResponseSchema = z.object({
  /** Recognised transcript, in the pair's source language. */
  sourceText: z.string(),
  /** Translation, in the pair's target language. */
  targetText: z.string(),
  /** Base64-encoded synthesized target-language audio (no data-url prefix). */
  audioBase64: z.string(),
  /** MIME type of the returned audio, e.g. "audio/mpeg". */
  audioMimeType: z.string(),
});
export type TranslateResponse = z.infer<typeof translateResponseSchema>;
