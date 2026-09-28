// Transcript segment domain types — schema-first. This is the CANONICAL segment
// shape; events/ws-events.ts imports it instead of redeclaring inline.
import { z } from 'zod';
import { speakerRoleSchema } from './session.js';
// Language codes and directions are owned by the registry (`languages.ts`).
import { translationDirectionSchema } from './languages.js';

/**
 * Which voice speaks the translation.
 *
 * The only PORTABLE voice selector: gender is the one way of naming a voice that
 * means the same thing to every backend, so it is what a caller uses when it
 * knows nothing about what is running.
 *
 * A caller may also name a specific voice, and this comment used to say it could
 * not. It does so with an opaque token discovered at runtime from the backend
 * itself (`sessionOptions.voice`), never with a value any client hardcodes — the
 * concrete voices are still a speaker id for English and a preset name for
 * Vietnamese, and those vocabularies still belong to the backend alone. An
 * unrecognised token falls back to the gender voice rather than failing the turn,
 * which is what keeps a stale saved choice from costing someone their audio.
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
