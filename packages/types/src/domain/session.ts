// Conversation session domain types — schema-first (zod source, types inferred).
import { z } from 'zod';

export const speakerRoleSchema = z.enum(['speaker_a', 'speaker_b']);
export type SpeakerRole = z.infer<typeof speakerRoleSchema>;

export const sessionStatusSchema = z.enum(['idle', 'active', 'ended']);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const conversationSessionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: sessionStatusSchema,
});
export type ConversationSession = z.infer<typeof conversationSessionSchema>;
