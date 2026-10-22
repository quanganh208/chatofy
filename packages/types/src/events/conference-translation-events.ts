// Conference translation events — a speaker's client broadcasting its own
// translated output to every other participant in a /ws/conference room.
import { z } from 'zod';

/** ISO-639-1 language code, e.g. 'vi', 'en'. */
const langCodeSchema = z.string().length(2);

/**
 * conference.translation.subtitle
 *
 * Emitted by the speaker's client into /ws/conference to broadcast a subtitle
 * to all other participants. Partial and final frames of the same utterance
 * share one `turnId`, so a listener replaces rather than appends until `isFinal`.
 */
export const ConferenceTranslationSubtitleSchema = z.object({
  speakerSocketId: z.string(),
  speakerDisplayName: z.string(),
  /** ISO-639-1 source language, e.g. 'vi'. */
  sourceLanguage: langCodeSchema,
  /** ISO-639-1 target language, e.g. 'en'. */
  targetLang: langCodeSchema,
  sourceText: z.string(),
  translatedText: z.string(),
  isFinal: z.boolean(),
  /** Correlates partial + final frames of one utterance. */
  turnId: z.string().uuid(),
});
export type ConferenceTranslationSubtitle = z.infer<typeof ConferenceTranslationSubtitleSchema>;

/**
 * conference.translation.audio
 *
 * Emitted by the speaker's client into /ws/conference to deliver one TTS audio
 * frame to all listeners.
 */
export const ConferenceTranslationAudioSchema = z.object({
  speakerSocketId: z.string(),
  /** ISO-639-1 language of the synthesized speech. */
  lang: langCodeSchema,
  /** Monotonically increasing frame counter for ordering / loss detection. */
  sequence: z.number().int().nonnegative(),
  sampleRate: z.number().int().positive(),
  /** Base64 PCM-16 LE, same format as AudioFrame's payload. */
  payload: z.string(),
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
