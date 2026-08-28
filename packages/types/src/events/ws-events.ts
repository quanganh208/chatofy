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
/**
 * What the translator is told about the conversation before it hears any of it.
 *
 * Bounded on every axis, for the reason given on {@link turnIdSchema}: an
 * authenticated client can still be a tampered one, and these fields reach a
 * paid model's prompt on every single turn of the session rather than once. The
 * provider caps them again on its own side — this schema is what the socket will
 * accept, that one is what the prompt will carry, and neither trusts the other.
 *
 * `style` is a closed enum rather than free text because it is the one hint
 * whose purpose is to change how the model writes, which is the shape an
 * instruction has.
 */
export const translationHintsSchema = z.object({
  /** What the conversation is about — "hotel check-in", "cardiology consult". */
  topic: z.string().max(200).optional(),
  /** Names, jargon, and product terms the recognizer is likely to get wrong. */
  hotwords: z.array(z.string().max(64)).max(48).optional(),
  /** Register for the output; omitted leaves the choice to the model. */
  style: z.enum(['neutral', 'formal', 'casual']).optional(),
});
export type TranslationHints = z.infer<typeof translationHintsSchema>;

export const sessionOptionsSchema = z.object({
  // Canonical direction enum from the domain layer — do not inline the literals.
  direction: translationDirectionSchema,
  /** Defaulted rather than required, so a client may omit it entirely. */
  voiceGender: voiceGenderSchema.default(DEFAULT_VOICE_GENDER),
  /**
   * Optional, and absent means exactly what it did before hints existed: the
   * prompt is built without a context block at all, not with an empty one.
   */
  hints: translationHintsSchema.optional(),
  /**
   * Whether the translation is spoken at all.
   *
   * `.optional()` rather than `.default()`, and the difference is not stylistic:
   * `SessionOptions` is this schema's OUTPUT type, where a defaulted field is
   * REQUIRED in TypeScript. Defaulting here would break every existing
   * `SessionOptions` literal in the repo — including production ones in
   * `packages/realtime-client` and `apps/extension`, neither of which has any
   * business knowing this field exists. The server applies the default instead,
   * in `TurnSession`.
   */
  voiceOutput: z.boolean().optional(),
  /**
   * Speaking rate for the synthesized translation.
   *
   * CLAMPED, never rejected. These options are spread into
   * `client.session.start`, and a failed parse there throws a `WsException` that
   * `AllExceptionsFilter` swallows — so a refusal is not a refusal, it is silence,
   * and the client sits in "connecting" forever with no way to recover but
   * clearing its storage. The same reasoning the local TTS sidecar records for
   * accepting an unrecognised gender rather than 422-ing a turn that could still
   * have been spoken.
   *
   * Honoured for English output only; the Vietnamese engine has no rate control.
   */
  speed: z
    .number()
    .catch(1)
    // CLAMPED, not validated. `.pipe(min().max())` would REJECT an out-of-range
    // number rather than pull it into range — which is the silent hang described
    // above, not a refusal anyone can see. `.catch` alone is not enough either:
    // it only fires when the input is not a number at all, so 99 would sail past
    // it. The arithmetic is the enforcement.
    .transform((value) => Math.min(2, Math.max(0.5, value)))
    .optional(),
  /**
   * A specific voice, as an OPAQUE token the running backend published.
   *
   * One value, not one per language: the server already knows which language it
   * is about to speak from `direction`, so sending both would let the two
   * disagree. Clients that remember a choice per language pick the right one
   * before sending.
   *
   * Never an enum, at any layer. Which voices exist belongs to whichever speech
   * backend is deployed, and enumerating them in this package would hardcode one
   * backend's vocabulary into every client — the mistake that once took
   * Vietnamese synthesis down. Unknown tokens fall back to the gender voice
   * rather than failing the turn.
   */
  voice: z.string().max(64).optional(),
  /**
   * Ask for a speaker embedding per turn, so this client can guess who spoke.
   *
   * Opt-in, and `optional` rather than `default(false)` so the inferred type
   * stays absent-able and no existing caller has to start passing it.
   *
   * The opt-in is not politeness — it is what keeps `server.turn.embedding`
   * away from a client that cannot parse it. `apps/api` and `apps/web` do not
   * deploy atomically (see `turnIdSchema` above for the same fact in the other
   * direction), so a tab loaded before the deploy that added the event still
   * holds the old union; an event it cannot parse becomes an error and an auth
   * probe, once per turn. A client that never asks never receives.
   *
   * It also keeps turns that would discard the vector from paying the sidecar
   * for one. The extension captures a meeting continuously and produces far
   * more turns than the web page does.
   */
  embedSpeaker: z.boolean().optional(),
  /**
   * Ask for a punctuated, cased, digit-bearing rendering of this turn's SOURCE
   * text, for display only.
   *
   * The local Vietnamese recognizer emits lowercase words with no punctuation
   * and numbers spelled out, so `mười bảy giờ` reaches the screen where `17:00`
   * was said. A repair is a separate request on a separately metered model, made
   * after the turn is already answered — it can never delay audio, and a failed
   * one simply never arrives.
   *
   * Opt-in for the identical reason as {@link embedSpeaker} above, and that
   * reason is the whole version-coupling story for `server.transcript.display`:
   * `apps/api` and `apps/web` do not deploy atomically, and a client parses
   * server events against a strict discriminated union. A tab loaded before this
   * event existed would turn every repaired turn into "Unexpected event shape
   * from the server" — once per turn, each one also firing an auth probe. A
   * client that never asks is never sent one, so no such tab can be reached.
   *
   * Applies to whichever language is being SPOKEN, not to Vietnamese: on
   * `en_to_vi` the thing repaired is the English transcript.
   */
  repairDisplay: z.boolean().optional(),
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
 * Bounded because the server echoes it back and logs it. Every other value a
 * client sends is capped for the same reason, and an uncapped string would be the
 * one exception.
 *
 * That reason is NOT "the socket is unauthenticated", which earlier versions of
 * this comment claimed: `/ws/translate` refuses an upgrade without a valid bearer
 * token (`ws-auth.ts`, wired in `translate.gateway.ts`). The bounds exist to
 * contain a compromised or tampered client that IS authenticated, and to keep
 * values sane for the speech sidecars, which take no auth of their own.
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

/**
 * A voice fingerprint for one finished turn.
 *
 * Sent only to a client that asked for it (`embedSpeaker`), and only while the
 * server-side flag is on.
 *
 * A separate event rather than a field on the segment: `transcriptSegmentSchema`
 * is the canonical domain record, consumed by surfaces that have no use for a
 * raw vector, and hanging one on it would push biometric-derived data into all
 * of them. It also gives the feature a clean off switch — the event is simply
 * never sent, and no schema changes shape.
 *
 * **Nothing here identifies anybody.** It is a direction in the model's space,
 * derived from audio this same client just sent up, and it is compared against
 * other vectors from the same conversation and then dropped. It is never stored,
 * on either side. Anything that would change that needs to answer why first.
 */
const serverTurnEmbeddingSchema = z.object({
  type: z.literal('server.turn.embedding'),
  /** Which turn, matching every other turn-scoped event's routing field. */
  sessionId: z.string(),
  /** Unit-norm, so a caller can compare two by dot product. */
  vector: z.array(z.number()),
  dim: z.number().int().positive(),
  /**
   * How much audio the vector was built from.
   *
   * Carried because a centroid is a duration-weighted mean and the client has no
   * other way to know: `TranscriptSegment` holds no duration, and the audio
   * never reaches the client. Without it the weighting silently becomes flat,
   * which is a different algorithm from the one that was measured.
   */
  audioMs: z.number().int().nonnegative(),
});

/**
 * A readable rendering of one finished turn's SOURCE text, for display only.
 *
 * Sent only to a client that asked (`repairDisplay`), and only after that turn's
 * `server.transcript.final` — the text being repaired is the one already in that
 * segment. Arriving separately and later is inherent: the repair runs on a slow
 * reserve model precisely so it competes with nothing on the latency-critical
 * path, which costs several seconds.
 *
 * **Never replaces `segment.sourceText`.** That field is the persisted record of
 * what the local recognizer actually produced, and it stays the only input to
 * WER and every other metric — a repaired string written over it would make the
 * transcript stop being evidence about the engine. Clients hold this beside the
 * segment and render `display ?? segment.sourceText`, so a turn with no repair,
 * or a client that never asked, shows exactly what it showed before.
 *
 * Provisional and replace-wholesale, the same semantics as
 * `server.transcript.partial` and `server.translation.partial`. At most one
 * arrives per turn.
 */
const serverTranscriptDisplaySchema = z.object({
  type: z.literal('server.transcript.display'),
  /** Which finished turn this renders, matching every other routing field here. */
  sessionId: z.string(),
  text: z.string(),
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
  serverTranscriptFinalSchema,
  serverTranscriptDisplaySchema,
  serverTurnEmbeddingSchema,
  serverAudioFrameSchema,
  serverSessionEndedSchema,
  serverErrorSchema,
]);

export type ServerEvent = z.infer<typeof serverEventSchema>;
