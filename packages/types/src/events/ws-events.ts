// WebSocket event schemas — discriminated unions for client↔server messaging
import { z } from 'zod';
import { audioFrameSchema } from './audio-frame.js';
import { speakerRoleSchema } from '../domain/session.js';
import {
  translationDirectionSchema,
  transcriptSegmentSchema,
  voiceGenderSchema,
  DEFAULT_VOICE_GENDER,
} from '../domain/transcript.js';

// ---------------------------------------------------------------------------
// Client → Server events
// ---------------------------------------------------------------------------

/**
 * Everything a turn needs to be decided before the first frame arrives.
 *
 * Exported on its own because these settings travel together the whole way
 * down — socket, gateway, session — and passing them as one object keeps that
 * chain from growing a positional argument per setting.
 */
export const sessionOptionsSchema = z.object({
  // Canonical direction enum from the domain layer — do not inline the literals.
  direction: translationDirectionSchema,
  /** Defaulted rather than required, so a client may omit it entirely. */
  voiceGender: voiceGenderSchema.default(DEFAULT_VOICE_GENDER),
  /**
   * Speak each settled clause while the speaker is still talking, instead of
   * waiting for the turn to end.
   *
   * Opt-in per turn and defaulted to `false` for the same reason `voiceGender`
   * is defaulted: the two apps do not deploy together, so a tab that is already
   * open keeps sending messages without this field and they must stay valid.
   * A turn that omits it behaves exactly as it does today, which is also the
   * rollback — turning it off client-side needs no server change.
   */
  streaming: z.boolean().default(false),
});
export type SessionOptions = z.infer<typeof sessionOptionsSchema>;

/**
 * A client-chosen name for a turn, carried so both sides can talk about a turn
 * that has no server id yet.
 *
 * The server assigns `sessionId` inside `start()`, which means every refusal to
 * open a turn — the concurrency ceiling above all — happens before any id
 * exists. Without a client-side name, a client told `too_many_turns` cannot tell
 * which of its in-flight turns was refused, and an ordered playback queue that
 * has already reserved a slot for it waits on a turn that will never arrive.
 *
 * Bounded because the server echoes it back and logs it. Every other number a
 * client sends is capped for the same stated reason — "the socket is
 * unauthenticated" — and an uncapped string would be the one exception.
 */
const turnIdSchema = z.string().max(64);

/**
 * A turn id the client picked, when it picked one.
 *
 * Optional on every client → server event, and deliberately so: `apps/api` and
 * `apps/web` do not deploy atomically, so a tab loaded before a deploy is still
 * sending the old shape. A field the server requires would make every one of
 * that tab's messages fail validation. The client always sends it; the server
 * falls back to the socket's only turn when it is missing.
 */
const clientSessionStartSchema = sessionOptionsSchema.extend({
  type: z.literal('client.session.start'),
  turnId: turnIdSchema.optional(),
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
  /** Which turn to guess at. Optional for the reason on {@link turnIdSchema}. */
  sessionId: turnIdSchema.optional(),
});

const clientSessionEndSchema = z.object({
  type: z.literal('client.session.end'),
  /** Which turn to close. Optional for the reason on {@link turnIdSchema}. */
  sessionId: turnIdSchema.optional(),
});

/**
 * How a turn ended, from the client's point of view.
 *
 * Recorded for every turn, not only the ones that played. A turn refused at the
 * concurrency ceiling, dropped at a backlog ceiling, or failed never produces
 * audio — so a coverage figure that counted only turns which played would measure
 * the success rate of playback rather than the coverage of capture, and would
 * improve precisely when the pipeline was breaking.
 */
export const turnOutcomeSchema = z.enum(['played', 'no_audio', 'rejected', 'dropped', 'error']);
export type TurnOutcome = z.infer<typeof turnOutcomeSchema>;

/**
 * Timings only the client can know, reported when a turn closes.
 *
 * The server's own metrics measure from the endpoint onwards, because that is the
 * first moment it knows anything about the turn. It cannot know when the speaker
 * started, and it cannot know when a loudspeaker actually produced sound — which
 * are the two ends of the only latency a listener experiences. Coverage and drift
 * are therefore measurable on the client and nowhere else.
 *
 * This is the ONLY data a client writes to the server's disk, on an endpoint that
 * takes no authentication, so every field is bounded. The times are epoch
 * milliseconds in the CLIENT's clock and are never compared against server times;
 * the two sides are joined by `sessionId` alone.
 */
const clientTurnMetricsSchema = z.object({
  type: z.literal('client.turn.metrics'),
  /** The turn these numbers describe. Validated against the socket's own turns. */
  sessionId: z.string().max(64),
  /** Epoch ms when the gate opened the turn. */
  speechStartedAt: z.number().int().min(0).max(4_000_000_000_000),
  /** Epoch ms when the gate closed it. */
  speechEndedAt: z.number().int().min(0).max(4_000_000_000_000),
  /** Audio actually sent for this turn. The numerator of coverage. */
  capturedMs: z.number().int().min(0).max(3_600_000),
  /** Audio held back and never sent, e.g. silence inside the utterance. */
  heldMs: z.number().int().min(0).max(3_600_000),
  /** Epoch ms when the first sample of translated audio was scheduled. */
  firstAudioPlayedAt: z.number().int().min(0).max(4_000_000_000_000).optional(),
  lastAudioPlayedAt: z.number().int().min(0).max(4_000_000_000_000).optional(),
  /** Translated audio waiting ahead of this turn when it was released. */
  queuedAheadMs: z.number().int().min(0).max(3_600_000).optional(),
  /** True when the length ceiling cut the turn rather than the speaker stopping. */
  cutForced: z.boolean(),
  outcome: turnOutcomeSchema,
  /** Times the microphone heard our own playback during this turn. */
  echoEvents: z.number().int().min(0).max(100_000),
});

export const clientEventSchema = z.discriminatedUnion('type', [
  clientSessionStartSchema,
  clientAudioFrameSchema,
  clientTurnSpeculateSchema,
  clientSessionEndSchema,
  clientTurnMetricsSchema,
]);

/** The client-reported half of one turn's measurements. */
export type ClientTurnMetrics = Omit<z.infer<typeof clientTurnMetricsSchema>, 'type'>;

// Only the union is exported. The per-member aliases had no consumer in either
// app: callers discriminate on `type` and let TypeScript narrow the union, which
// is what the discriminated union is for.
export type ClientEvent = z.infer<typeof clientEventSchema>;

// ---------------------------------------------------------------------------
// Server → Client events
// ---------------------------------------------------------------------------

/**
 * The client's own name for the turn, echoed back.
 *
 * Optional rather than required, because it echoes an optional field: the server
 * can only return what it was given, and a derived field declared stricter than
 * its source is a shape nothing can satisfy. In practice every client sends one,
 * so it is present on every event a current client sees.
 */
const echoedTurnIdSchema = z.string().max(64).optional();

const serverSessionReadySchema = z.object({
  type: z.literal('server.session.ready'),
  sessionId: z.string(),
  turnId: echoedTurnIdSchema,
});

const serverTranscriptPartialSchema = z.object({
  type: z.literal('server.transcript.partial'),
  /** Which turn is being transcribed. Required: several may be open at once. */
  sessionId: z.string(),
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
  /** Which turn this guess belongs to. */
  sessionId: z.string(),
  text: z.string(),
  direction: translationDirectionSchema,
});

/**
 * A clause of the translation that has been settled and spoken.
 *
 * The opposite contract to `server.translation.partial` in the one way that
 * matters: this one APPENDS. Each event carries the next piece of the
 * translation, never a replacement for what came before, because by the time it
 * arrives the audio for the previous pieces has already been played and cannot
 * be taken back.
 *
 * A separate event rather than a flag on the partial, deliberately. The partial
 * is documented above as "replace wholesale, never append" and clients already
 * implement it that way; putting both meanings behind one type is a reliable
 * way for someone to later read one of them as the other.
 *
 * `seq` counts commits within the turn from 0, so a client can tell a dropped
 * event from a quiet stretch — the difference matters here, where a gap means
 * the listener heard audio whose text never arrived.
 */
const serverTranslationCommitSchema = z.object({
  type: z.literal('server.translation.commit'),
  /** Which turn this clause belongs to. */
  sessionId: z.string(),
  text: z.string(),
  direction: translationDirectionSchema,
  seq: z.number().int().nonnegative(),
});

const serverTranscriptFinalSchema = z.object({
  type: z.literal('server.transcript.final'),
  /**
   * Which turn finished.
   *
   * Duplicates `segment.sessionId` on purpose. That one is part of the persisted
   * domain record; this one is the envelope's routing field, and a client that
   * reaches into the record to decide where an event goes breaks the next time
   * `TranscriptSegment` changes shape. Every other turn-scoped event here reads
   * the same way, which is what lets a reducer key on one field.
   */
  sessionId: z.string(),
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
  /** Which turn ended. The server always knows this one — it assigned it. */
  sessionId: z.string(),
  /**
   * Carried alongside `sessionId` so a client can close a turn it never learnt
   * the server id for. A turn refused or failed before `server.session.ready`
   * reached the client is only nameable by the name the client gave it.
   */
  turnId: echoedTurnIdSchema,
});

const serverErrorSchema = z.object({
  type: z.literal('server.error'),
  code: z.string(),
  message: z.string(),
  /**
   * Which turn failed, when a turn did.
   *
   * Both optional, and each covers a case the other cannot. `sessionId` names a
   * turn that was open. `turnId` names one that was refused inside `start()`,
   * before any `sessionId` existed — the concurrency ceiling is exactly that
   * case, and a client that cannot identify the refused turn leaves an ordered
   * playback queue waiting on it forever. Neither is present for a
   * connection-level fault, which belongs to no turn at all.
   */
  sessionId: z.string().optional(),
  turnId: echoedTurnIdSchema,
});

export const serverEventSchema = z.discriminatedUnion('type', [
  serverSessionReadySchema,
  serverTranscriptPartialSchema,
  serverTranslationPartialSchema,
  serverTranslationCommitSchema,
  serverTranscriptFinalSchema,
  serverAudioFrameSchema,
  serverSessionEndedSchema,
  serverErrorSchema,
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
