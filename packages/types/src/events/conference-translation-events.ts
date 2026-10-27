// Conference translation events — a speaker's client broadcasting its own
// translated output to every other participant in a /ws/conference room.
//
// The gateway parses every inbound payload against these schemas and owns the
// identity fields: whatever a client puts in `speakerSocketId` or
// `speakerDisplayName` is overwritten with the sending socket's own values
// before anything is fanned out or persisted.
import { z } from 'zod';

import { languageCodeSchema, translationMapSchema } from '../domain/languages.js';

/** Longest accumulated text one turn may carry on either channel. */
export const MAX_CONFERENCE_TURN_TEXT_CHARS = 4000;

/**
 * Largest base64 payload one translated-speech frame may carry.
 *
 * The live backend emits 24 kHz mono pcm16 in frames of well under a second;
 * this allows about five seconds (240 000 bytes, 320 000 base64 characters) so
 * a coalesced frame still passes while a payload that could only be an attack
 * is refused before it is relayed to every listener.
 */
export const MAX_CONFERENCE_AUDIO_PAYLOAD_CHARS = 320_000;

/**
 * conference.translation.subtitle
 *
 * One turn of one speaker: the speaker's own translate session decides where a
 * turn starts and ends, and `turnId` is that server turn's session id. Every
 * frame carries the text ACCUMULATED so far on each channel, so a listener
 * replaces rather than appends; the closing frame is sent once with
 * `isFinal: true` and is the only frame the gateway persists.
 */
export const ConferenceTranslationSubtitleSchema = z.object({
  /** Overwritten by the gateway with the sending socket's id. */
  speakerSocketId: z.string().max(64).optional(),
  /** Overwritten by the gateway with the sending peer's display name. */
  speakerDisplayName: z.string().max(64).optional(),
  /** Language the speaker is talking in. */
  sourceLanguage: languageCodeSchema,
  /** Language `translatedText` is in. */
  targetLanguage: languageCodeSchema,
  /** Source-channel text heard so far in this turn. */
  sourceText: z.string().max(MAX_CONFERENCE_TURN_TEXT_CHARS),
  /** Target-channel text translated so far in this turn. */
  translatedText: z.string().max(MAX_CONFERENCE_TURN_TEXT_CHARS),
  /**
   * The same turn translated into every language the speaker asked for,
   * `targetLanguage` included, when it was translated into more than one.
   * `targetLanguage`/`translatedText` stay the primary language. The gateway
   * narrows the map to each listener's language and strips it before delivery,
   * so a listener never receives it.
   */
  translations: translationMapSchema(z.string().max(MAX_CONFERENCE_TURN_TEXT_CHARS)).optional(),
  isFinal: z.boolean(),
  /** The speaker's server turn session id; correlates every frame of one turn. */
  turnId: z.uuid(),
});
export type ConferenceTranslationSubtitle = z.infer<typeof ConferenceTranslationSubtitleSchema>;

/**
 * conference.translation.audio
 *
 * One frame of the speaker's translated speech. `sequence` is the speaker
 * leg's own counter per language: it never resets within a call attempt, so it
 * does not start at zero for a listener who joins mid-call, and a listener's
 * resequencer starts from the first sequence it sees per speaker and language.
 */
export const ConferenceTranslationAudioSchema = z.object({
  /** Overwritten by the gateway with the sending socket's id. */
  speakerSocketId: z.string().max(64).optional(),
  /** Language of the synthesized speech; only listeners of this language hear it. */
  lang: languageCodeSchema,
  /** Monotonically increasing frame counter for ordering / loss detection. */
  sequence: z.number().int().nonnegative(),
  sampleRate: z.number().int().min(8000).max(48000),
  /** Base64 PCM-16 LE, same format as AudioFrame's payload. */
  payload: z.string().max(MAX_CONFERENCE_AUDIO_PAYLOAD_CHARS),
});
export type ConferenceTranslationAudio = z.infer<typeof ConferenceTranslationAudioSchema>;

/**
 * conference.translation.broadcast
 *
 * The combined envelope the speaker's client sends — one message may carry
 * subtitle only, audio only, or both.
 */
export const ConferenceTranslationBroadcastSchema = z.object({
  subtitle: ConferenceTranslationSubtitleSchema.optional(),
  audio: ConferenceTranslationAudioSchema.optional(),
});
export type ConferenceTranslationBroadcast = z.infer<typeof ConferenceTranslationBroadcastSchema>;
