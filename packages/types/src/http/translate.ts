// Translate HTTP contracts — schema-first. Turn-based (record full utterance →
// POST → response) voice translation. Audio travels as base64 inside the standard
// ApiResponse<T> envelope. Directions: vi→en and en→vi.
import { z } from 'zod';
// Reuse the CANONICAL direction enum (vi_to_en | en_to_vi) from the domain layer
// instead of redeclaring it here.
import {
  translationDirectionSchema,
  voiceGenderSchema,
  DEFAULT_VOICE_GENDER,
  type LanguageCode,
  type TranslationDirection,
} from '../domain/transcript.js';

/** Source/target language codes for a translation direction. */
export function directionLanguages(direction: TranslationDirection): {
  source: LanguageCode;
  target: LanguageCode;
} {
  return direction === 'en_to_vi' ? { source: 'en', target: 'vi' } : { source: 'vi', target: 'en' };
}

/** POST /translate request body. */
export const translateRequestSchema = z.object({
  /** Base64-encoded recorded audio bytes (no data-url prefix). */
  audioBase64: z.string().min(1),
  /** MIME type of the recorded audio, e.g. "audio/webm". */
  audioMimeType: z.string().min(1),
  /**
   * Translation direction. Optional for backward compatibility — the server
   * defaults an omitted direction to vi→en.
   */
  direction: translationDirectionSchema.optional(),
  /**
   * Which voice speaks the translation. Applies to whichever language the
   * direction outputs — both engines have a voice for each gender.
   */
  voiceGender: voiceGenderSchema.default(DEFAULT_VOICE_GENDER),
});
export type TranslateRequest = z.infer<typeof translateRequestSchema>;

/** POST /translate success payload (inner data of the response envelope). */
export const translateResponseSchema = z.object({
  /** Recognised transcript, in the direction's source language. */
  sourceText: z.string(),
  /** Translation, in the direction's target language. */
  targetText: z.string(),
  /** Base64-encoded synthesized target-language audio (no data-url prefix). */
  audioBase64: z.string(),
  /** MIME type of the returned audio, e.g. "audio/mpeg". */
  audioMimeType: z.string(),
});
export type TranslateResponse = z.infer<typeof translateResponseSchema>;
