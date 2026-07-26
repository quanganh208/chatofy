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

/**
 * The speaker has probably stopped, but the endpoint is not confirmed yet.
 *
 * Sent on a short silence, well before the hangover that decides the turn is
 * over. It lets the server transcribe and translate what it already has while
 * the client keeps listening, so a confirmed endpoint finds that work already
 * done. Nothing is emitted in response; the result is only used if the audio
 * has not grown by the time `client.session.end` arrives.
 */
const clientTurnSpeculateSchema = z.object({
  type: z.literal('client.turn.speculate'),
});

const clientSessionEndSchema = z.object({
  type: z.literal('client.session.end'),
});

export const clientEventSchema = z.discriminatedUnion('type', [
  clientSessionStartSchema,
  clientAudioFrameSchema,
  clientTurnSpeculateSchema,
  clientSessionEndSchema,
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ClientSessionStart = z.infer<typeof clientSessionStartSchema>;
export type ClientAudioFrame = z.infer<typeof clientAudioFrameSchema>;
export type ClientTurnSpeculate = z.infer<typeof clientTurnSpeculateSchema>;
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

/**
 * A translation of what has been said so far, while the speaker is still going.
 *
 * Separate from `server.transcript.partial` rather than a field on it because
 * the two move at different speeds: the transcript is re-read every few hundred
 * milliseconds and costs nothing, while each translation is a metered request.
 * Carrying them together would resend one of them unchanged every time the
 * other moved.
 *
 * Provisional by nature — the sentence is unfinished, so the translation of it
 * is a guess that later text can overturn. Clients should show it as such and
 * replace it wholesale, never append.
 */
const serverTranslationPartialSchema = z.object({
  type: z.literal('server.translation.partial'),
  text: z.string(),
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
  serverTranslationPartialSchema,
  serverTranscriptFinalSchema,
  serverAudioFrameSchema,
  serverSessionEndedSchema,
  serverErrorSchema,
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ServerSessionReady = z.infer<typeof serverSessionReadySchema>;
export type ServerTranscriptPartial = z.infer<typeof serverTranscriptPartialSchema>;
export type ServerTranslationPartial = z.infer<typeof serverTranslationPartialSchema>;
export type ServerTranscriptFinal = z.infer<typeof serverTranscriptFinalSchema>;
export type ServerAudioFrame = z.infer<typeof serverAudioFrameSchema>;
export type ServerSessionEnded = z.infer<typeof serverSessionEndedSchema>;
export type ServerError = z.infer<typeof serverErrorSchema>;
