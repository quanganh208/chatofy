// Conference HTTP contracts — schema-first.
import { z } from 'zod';
import { conferenceMinutesSchema } from '../domain/minutes.js';

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
  joinedAt: z.iso.datetime(),
  leftAt: z.iso.datetime().nullable().optional(),
});
export type ConferenceParticipant = z.infer<typeof conferenceParticipantSchema>;

export const conferenceResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  title: z.string().nullable().optional(),
  createdAt: z.iso.datetime(),
  ownerId: z.string(),
});
export type ConferenceResponse = z.infer<typeof conferenceResponseSchema>;

export const conferenceDetailResponseSchema = conferenceResponseSchema.extend({
  /** When the first participant joined; absent for a room nobody entered. */
  startedAt: z.iso.datetime().nullable().optional(),
  /** When the owner ended it; absent while the room is still open. */
  endedAt: z.iso.datetime().nullable().optional(),
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

/**
 * `POST /conference/:id/minutes` answers with the copy it just wrote. The body is
 * `generateMinutesRequestSchema` from the minutes contracts — only the language
 * to write in; the transcript is the room's stored turns.
 */
export const conferenceMinutesResponseSchema = z.object({
  minutes: conferenceMinutesSchema,
});
export type ConferenceMinutesResponse = z.infer<typeof conferenceMinutesResponseSchema>;

/**
 * `GET /conference/:id/minutes`: null when nobody has generated them yet.
 *
 * Null rather than the 404 the conversation minutes answer with, because on a
 * conference 404 already means "not a room you were in" — an end screen must be
 * able to tell "no minutes yet" from "no access" without reading error text.
 */
export const storedConferenceMinutesResponseSchema = z.object({
  minutes: conferenceMinutesSchema.nullable(),
});
export type StoredConferenceMinutesResponse = z.infer<typeof storedConferenceMinutesResponseSchema>;
