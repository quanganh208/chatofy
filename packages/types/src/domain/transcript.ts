// Transcript segment domain types — schema-first. This is the CANONICAL segment
// shape; events/ws-events.ts imports it instead of redeclaring inline.
import { z } from 'zod';
import { speakerRoleSchema } from './session.js';

// CANONICAL language-code enum — every 'vi' | 'en' in the monorepo derives from
// this schema; do not inline the literals elsewhere.
export const languageCodeSchema = z.enum(['vi', 'en']);
export type LanguageCode = z.infer<typeof languageCodeSchema>;

export const translationDirectionSchema = z.enum(['vi_to_en', 'en_to_vi']);
export type TranslationDirection = z.infer<typeof translationDirectionSchema>;

/**
 * Which voice speaks the translation.
 *
 * CANONICAL voice selector — the only way a caller names an output voice. The
 * concrete voices it maps to (a speaker id for English, a preset name for
 * Vietnamese) belong to whichever TTS backend is running and never appear on
 * the wire, because no caller can know which backend that is.
 */
export const voiceGenderSchema = z.enum(['female', 'male']);
export type VoiceGender = z.infer<typeof voiceGenderSchema>;

/** Applied wherever the caller may leave the voice unstated. */
export const DEFAULT_VOICE_GENDER: VoiceGender = 'female';

export const transcriptSegmentSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  speakerRole: speakerRoleSchema,
  direction: translationDirectionSchema,
  sourceText: z.string(),
  targetText: z.string(),
  audioUrl: z.string().nullable(),
  createdAt: z.string(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
