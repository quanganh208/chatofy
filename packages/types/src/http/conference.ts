// Conference HTTP contracts — schema-first.
import { z } from 'zod';

export const createConferenceRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});
export type CreateConferenceRequest = z.infer<typeof createConferenceRequestSchema>;

export const conferenceParticipantSchema = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string().nullable().optional(),
  sourceLanguage: z.string(),
  status: z.string(),
  joinedAt: z.coerce.date(),
  leftAt: z.coerce.date().nullable().optional(),
});
export type ConferenceParticipant = z.infer<typeof conferenceParticipantSchema>;

export const conferenceResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  title: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  ownerId: z.string(),
});
export type ConferenceResponse = z.infer<typeof conferenceResponseSchema>;

export const conferenceDetailResponseSchema = conferenceResponseSchema.extend({
  participants: z.array(conferenceParticipantSchema),
  _count: z.object({ turns: z.number().int() }),
});
export type ConferenceDetailResponse = z.infer<typeof conferenceDetailResponseSchema>;

export const conferenceListResponseSchema = z.object({
  conferences: z.array(conferenceResponseSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type ConferenceListResponse = z.infer<typeof conferenceListResponseSchema>;
