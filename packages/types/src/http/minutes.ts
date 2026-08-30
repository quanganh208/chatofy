// Meeting-minutes HTTP contracts — schema-first.
//
// The finished transcript lives client-side (the realtime-client reducer owns
// the turns and their speaker attributions; the API keeps no copy). So the
// generate request CARRIES the turns rather than naming a server-held
// transcript — the one shape that does not require the API to first grow a
// transcript store it does not have today. When persistence lands, this
// contract gains an alternative "generate from the stored session" form; it
// does not change this one.
import { z } from 'zod';
import { meetingMinutesSchema } from '../domain/minutes.js';
import { languageCodeSchema } from '../domain/transcript.js';

/**
 * One turn as the client submits it for summarization.
 *
 * `speakerLabel` is a display label ("Speaker 1", or a name the user typed on
 * the roster), NOT the internal `speaker_a`/`speaker_b` role — the minutes are
 * written for a human to read, so the label the human assigned is what belongs
 * in them. `text` is the settled source-language line; the model is given the
 * conversation in the language it happened in, not the translation.
 */
export const minutesSourceTurnSchema = z.object({
  speakerLabel: z.string(),
  text: z.string(),
});
export type MinutesSourceTurn = z.infer<typeof minutesSourceTurnSchema>;

export const generateMinutesRequestSchema = z.object({
  turns: z.array(minutesSourceTurnSchema).min(1),
  /** Language to WRITE the minutes in. Defaults to the app's UI language. */
  language: languageCodeSchema.optional(),
});
export type GenerateMinutesRequest = z.infer<typeof generateMinutesRequestSchema>;

export const minutesResponseSchema = z.object({
  minutes: meetingMinutesSchema,
});
export type MinutesResponse = z.infer<typeof minutesResponseSchema>;
