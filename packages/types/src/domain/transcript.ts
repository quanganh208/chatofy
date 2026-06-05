// Transcript segment domain types — schema-first. This is the CANONICAL segment
// shape; events/ws-events.ts imports it instead of redeclaring inline.
import { z } from 'zod';
import { speakerRoleSchema } from './session.js';

export const translationDirectionSchema = z.enum(['vi_to_en', 'en_to_vi']);
export type TranslationDirection = z.infer<typeof translationDirectionSchema>;

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
