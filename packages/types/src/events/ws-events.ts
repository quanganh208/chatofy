// WebSocket event schemas — discriminated unions for client↔server messaging
import { z } from 'zod';
import { audioFrameSchema } from './audio-frame.js';
import { speakerRoleSchema } from '../domain/session.js';
import { translationDirectionSchema, transcriptSegmentSchema } from '../domain/transcript.js';

// ---------------------------------------------------------------------------
// Client → Server events
// ---------------------------------------------------------------------------

const clientSessionStartSchema = z.object({
  type: z.literal('client.session.start'),
  // Canonical direction enum from the domain layer — do not inline the literals.
  direction: translationDirectionSchema,
});

const clientAudioFrameSchema = z.object({
  type: z.literal('client.audio.frame'),
  frame: audioFrameSchema,
});

const clientSessionEndSchema = z.object({
  type: z.literal('client.session.end'),
});

export const clientEventSchema = z.discriminatedUnion('type', [
  clientSessionStartSchema,
  clientAudioFrameSchema,
  clientSessionEndSchema,
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ClientSessionStart = z.infer<typeof clientSessionStartSchema>;
export type ClientAudioFrame = z.infer<typeof clientAudioFrameSchema>;
export type ClientSessionEnd = z.infer<typeof clientSessionEndSchema>;

// ---------------------------------------------------------------------------
// Server → Client events
// ---------------------------------------------------------------------------

const serverSessionReadySchema = z.object({
  type: z.literal('server.session.ready'),
  sessionId: z.string(),
});

const serverTranscriptPartialSchema = z.object({
  type: z.literal('server.transcript.partial'),
  text: z.string(),
  speaker: speakerRoleSchema,
  direction: translationDirectionSchema,
});

const serverTranscriptFinalSchema = z.object({
  type: z.literal('server.transcript.final'),
  /** Full TranscriptSegment record persisted to DB — canonical domain schema. */
  segment: transcriptSegmentSchema,
});

const serverAudioFrameSchema = z.object({
  type: z.literal('server.audio.frame'),
  frame: audioFrameSchema,
});

const serverSessionEndedSchema = z.object({
  type: z.literal('server.session.ended'),
  reason: z.string(),
});

const serverErrorSchema = z.object({
  type: z.literal('server.error'),
  code: z.string(),
  message: z.string(),
});

export const serverEventSchema = z.discriminatedUnion('type', [
  serverSessionReadySchema,
  serverTranscriptPartialSchema,
  serverTranscriptFinalSchema,
  serverAudioFrameSchema,
  serverSessionEndedSchema,
  serverErrorSchema,
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ServerSessionReady = z.infer<typeof serverSessionReadySchema>;
export type ServerTranscriptPartial = z.infer<typeof serverTranscriptPartialSchema>;
export type ServerTranscriptFinal = z.infer<typeof serverTranscriptFinalSchema>;
export type ServerAudioFrame = z.infer<typeof serverAudioFrameSchema>;
export type ServerSessionEnded = z.infer<typeof serverSessionEndedSchema>;
export type ServerError = z.infer<typeof serverErrorSchema>;
