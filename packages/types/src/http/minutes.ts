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
 * Ceilings on a generate request.
 *
 * The turns arrive from a client and become an LLM prompt, so their size is a
 * cost lever, not just a validation nicety — one request is one metered
 * summarization call whose price scales with the transcript. The caps bound that
 * before it is spent: `MAX_TOTAL_CHARS` is the real limit (it is what the model
 * is billed on), and the per-field caps stop a single pathological turn or an
 * unbounded array from reaching the prompt at all. `MAX_TOTAL_CHARS` at ~80k is
 * a long meeting with comfortable headroom under a flash model's context, chosen
 * so a legitimate conversation is never refused while an abusive payload is.
 */
export const MINUTES_LIMITS = {
  MAX_TURNS: 4000,
  MAX_TURN_CHARS: 4000,
  MAX_SPEAKER_LABEL_CHARS: 120,
  MAX_TOTAL_CHARS: 80_000,
} as const;

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
  speakerLabel: z.string().min(1).max(MINUTES_LIMITS.MAX_SPEAKER_LABEL_CHARS),
  text: z.string().min(1).max(MINUTES_LIMITS.MAX_TURN_CHARS),
});
export type MinutesSourceTurn = z.infer<typeof minutesSourceTurnSchema>;

export const generateMinutesRequestSchema = z
  .object({
    turns: z.array(minutesSourceTurnSchema).min(1).max(MINUTES_LIMITS.MAX_TURNS),
    /** Language to WRITE the minutes in. Defaults to the app's UI language. */
    language: languageCodeSchema.optional(),
  })
  // The per-turn caps bound one line; this bounds the whole prompt. Checked here
  // rather than per field because it is the sum that is billed, and a thousand
  // short turns can exceed the ceiling every one of them passes individually.
  .refine(
    (body) =>
      body.turns.reduce((sum, t) => sum + t.speakerLabel.length + t.text.length, 0) <=
      MINUTES_LIMITS.MAX_TOTAL_CHARS,
    {
      path: ['turns'],
      message: `transcript exceeds ${MINUTES_LIMITS.MAX_TOTAL_CHARS} characters`,
    },
  );
export type GenerateMinutesRequest = z.infer<typeof generateMinutesRequestSchema>;

export const minutesResponseSchema = z.object({
  minutes: meetingMinutesSchema,
});
export type MinutesResponse = z.infer<typeof minutesResponseSchema>;
