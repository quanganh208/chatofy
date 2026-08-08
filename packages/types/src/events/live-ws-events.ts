// Wire contract for the continuous speech-to-speech mode of /ws/translate.
//
// A SEPARATE union from ws-events.ts, not an extension of it. The turn contract
// is validated by the web app, the extension and mobile, and only the web app
// speaks this one; a branch inside the shared union would expose every other
// client to a shape it never asked for. Keeping them apart means the turn
// contract changes by zero lines.
//
// What IS shared is the audio envelope, because a frame of PCM is a frame of PCM
// in either direction — see `audioFrameSchema`.
import { z } from 'zod';
import { audioFrameSchema } from './audio-frame.js';
import { languageCodeSchema, translationDirectionSchema } from '../domain/transcript.js';

/**
 * Every string here is bounded, for the same reason the turn contract bounds
 * its own: this socket takes no authentication, and the server echoes and logs
 * what it is sent.
 */
const boundedIdSchema = z.string().max(64);

/**
 * Largest base64 payload one live frame may carry.
 *
 * The client sends 100 ms of 16 kHz mono pcm16 — 3200 bytes, about 4270 base64
 * characters. This allows roughly a second and a half, generous for a late or
 * coalesced chunk while still refusing a frame that could only be an attack.
 * It lives beside the schema for the same reason `MIN_SAMPLE_RATE` does: the
 * bound and the contract it belongs to must not be able to drift apart.
 */
const MAX_LIVE_FRAME_PAYLOAD_CHARS = 65536;

const liveClientStartSchema = z.object({
  type: z.literal('client.live.start'),
  direction: translationDirectionSchema,
});

/**
 * One chunk of microphone audio.
 *
 * Unlike the turn path, quiet frames matter and must NOT be withheld: the model
 * has no endpoint event and reads trailing silence as the end of an utterance.
 * A client that stops sending at the last speech sample gets a truncated
 * translation back — measured, not theorised.
 */
const liveClientAudioSchema = z.object({
  type: z.literal('client.live.audio'),
  /**
   * The payload is bounded here and nowhere else on this path.
   *
   * `audioFrameSchema.payload` is a bare string, which the turn path gets away
   * with because `MAX_TURN_BYTES` catches an oversized frame downstream when it
   * lands in the turn's buffer. A live frame is forwarded, never buffered, so
   * there is no downstream cap to catch it — this socket takes no
   * authentication, and an unbounded string is what one message would need to
   * be to cost the process real memory.
   */
  frame: audioFrameSchema.extend({
    payload: z.string().max(MAX_LIVE_FRAME_PAYLOAD_CHARS),
  }),
});

const liveClientStopSchema = z.object({
  type: z.literal('client.live.stop'),
});

export const liveClientEventSchema = z.discriminatedUnion('type', [
  liveClientStartSchema,
  liveClientAudioSchema,
  liveClientStopSchema,
]);

export type LiveClientEvent = z.infer<typeof liveClientEventSchema>;

const liveServerReadySchema = z.object({
  type: z.literal('server.live.ready'),
  sessionId: boundedIdSchema,
});

/**
 * Incremental transcript text.
 *
 * Two channels rather than one with a finality flag, because the backend hears
 * one language and speaks another: "the transcript" is two different texts. The
 * source channel carries the language the model DETECTED, which is the only way
 * a client can notice auto-detection failing rather than silently believing it.
 */
const liveServerTranscriptSchema = z.object({
  type: z.literal('server.live.transcript'),
  sessionId: boundedIdSchema,
  channel: z.enum(['source', 'target']),
  delta: z.string().max(4000),
  lang: languageCodeSchema,
});

const liveServerAudioSchema = z.object({
  type: z.literal('server.live.audio'),
  /** 24 kHz on this backend; `audioFrameSchema` already permits 8000–48000. */
  frame: audioFrameSchema,
});

const liveServerEndedSchema = z.object({
  type: z.literal('server.live.ended'),
  sessionId: boundedIdSchema,
  reason: z.string().max(200),
});

/**
 * Longest human-readable reason a `server.live.error` may carry.
 *
 * Exported because the server has to clamp to it before emitting. Most of these
 * messages originate upstream — an SDK transport failure, a rejected key — and
 * nothing about their length is this contract's to assume. A server that emits
 * a longer one produces an event its own clients cannot parse: the client
 * `safeParse`s against this union, so an over-long message is dropped and
 * reported as "unexpected event shape", which hides the fault it was carrying.
 */
export const MAX_LIVE_ERROR_MESSAGE_CHARS = 500;

const liveServerErrorSchema = z.object({
  type: z.literal('server.live.error'),
  code: z.string().max(64),
  message: z.string().max(MAX_LIVE_ERROR_MESSAGE_CHARS),
  /** Absent for a fault that belongs to the connection rather than a session. */
  sessionId: boundedIdSchema.optional(),
});

export const liveServerEventSchema = z.discriminatedUnion('type', [
  liveServerReadySchema,
  liveServerTranscriptSchema,
  liveServerAudioSchema,
  liveServerEndedSchema,
  liveServerErrorSchema,
]);

export type LiveServerEvent = z.infer<typeof liveServerEventSchema>;
