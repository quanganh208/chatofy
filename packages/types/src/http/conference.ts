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

/**
 * When a meeting ended: `endedAt` if the owner ended it, otherwise the moment the
 * last participant left. Only the owner's End writes `endedAt`; a room everyone
 * simply left stays joinable by link and is never marked ended, and that is how
 * most meetings finish. Null while anyone is still in the room.
 */
export function conferenceEndedAt(
  conference: Pick<ConferenceDetailResponse, 'endedAt' | 'participants'>,
): string | null {
  if (conference.endedAt) return conference.endedAt;
  let last: string | null = null;
  for (const { leftAt } of conference.participants) {
    if (!leftAt) return null;
    if (last === null || Date.parse(leftAt) > Date.parse(last)) last = leftAt;
  }
  return last;
}

/** How long a meeting ran, in whole minutes (at least 1); null while it is not over. */
export function conferenceDurationMinutes(
  conference: Pick<ConferenceDetailResponse, 'startedAt' | 'endedAt' | 'participants'>,
): number | null {
  const endedAt = conferenceEndedAt(conference);
  if (!conference.startedAt || !endedAt) return null;
  const ms = Date.parse(endedAt) - Date.parse(conference.startedAt);
  if (!Number.isFinite(ms)) return null;
  return Math.max(1, Math.round(ms / 60_000));
}

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
