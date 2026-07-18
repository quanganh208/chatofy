// Session HTTP contracts — schema-first. Request/response shapes for the
// conversation session endpoints.
import { z } from 'zod';
import { conversationSessionSchema } from '../domain/session.js';
import { languageCodeSchema } from '../domain/transcript.js';

export const createSessionRequestSchema = z.object({
  preferredLanguage: languageCodeSchema.optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const sessionResponseSchema = z.object({
  session: conversationSessionSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
