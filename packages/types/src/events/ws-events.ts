// WebSocket event schemas — discriminated unions for client↔server messaging
import { z } from 'zod';
import { AudioFrameSchema } from './audio-frame.js';
import { speakerRoleSchema } from '../domain/session.js';
import { translationDirectionSchema, transcriptSegmentSchema } from '../domain/transcript.js';

// ---------------------------------------------------------------------------
// Client → Server events
// ---------------------------------------------------------------------------

const ClientSessionStartSchema = z.object({
  type: z.literal('client.session.start'),
  direction: z.enum(['vi_to_en', 'en_to_vi']),
});

const ClientAudioFrameSchema = z.object({
  type: z.literal('client.audio.frame'),
  frame: AudioFrameSchema,
});

const ClientSessionEndSchema = z.object({
  type: z.literal('client.session.end'),
});

export const ClientEventSchema = z.discriminatedUnion('type', [
  ClientSessionStartSchema,
  ClientAudioFrameSchema,
  ClientSessionEndSchema,
]);

export type ClientEvent = z.infer<typeof ClientEventSchema>;
export type ClientSessionStart = z.infer<typeof ClientSessionStartSchema>;
export type ClientAudioFrame = z.infer<typeof ClientAudioFrameSchema>;
export type ClientSessionEnd = z.infer<typeof ClientSessionEndSchema>;

// ---------------------------------------------------------------------------
// Server → Client events
// ---------------------------------------------------------------------------

const ServerSessionReadySchema = z.object({
  type: z.literal('server.session.ready'),
  sessionId: z.string(),
});

const ServerTranscriptPartialSchema = z.object({
  type: z.literal('server.transcript.partial'),
  text: z.string(),
  speaker: speakerRoleSchema,
  direction: translationDirectionSchema,
});

const ServerTranscriptFinalSchema = z.object({
  type: z.literal('server.transcript.final'),
  /** Full TranscriptSegment record persisted to DB — canonical domain schema. */
  segment: transcriptSegmentSchema,
});

const ServerAudioFrameSchema = z.object({
  type: z.literal('server.audio.frame'),
  frame: AudioFrameSchema,
});

const ServerSessionEndedSchema = z.object({
  type: z.literal('server.session.ended'),
  reason: z.string(),
});

const ServerErrorSchema = z.object({
  type: z.literal('server.error'),
  code: z.string(),
  message: z.string(),
});

export const ServerEventSchema = z.discriminatedUnion('type', [
  ServerSessionReadySchema,
  ServerTranscriptPartialSchema,
  ServerTranscriptFinalSchema,
  ServerAudioFrameSchema,
  ServerSessionEndedSchema,
  ServerErrorSchema,
]);

export type ServerEvent = z.infer<typeof ServerEventSchema>;
export type ServerSessionReady = z.infer<typeof ServerSessionReadySchema>;
export type ServerTranscriptPartial = z.infer<typeof ServerTranscriptPartialSchema>;
export type ServerTranscriptFinal = z.infer<typeof ServerTranscriptFinalSchema>;
export type ServerAudioFrame = z.infer<typeof ServerAudioFrameSchema>;
export type ServerSessionEnded = z.infer<typeof ServerSessionEndedSchema>;
export type ServerError = z.infer<typeof ServerErrorSchema>;
