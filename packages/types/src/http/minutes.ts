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
 * cost lever, not just a validation nicety — each summarization call is metered
 * and its price scales with the transcript. Two char ceilings bound that:
 *
 * - `MINUTES_CHUNK_CHARS` (~80k) is the per-CHUNK budget: a long meeting with
 *   comfortable headroom under a flash model's context, and the size of one
 *   in-budget summarization call. A meeting under it is one call; a meeting over
 *   it is summarized in parts (map-reduce), each part under this budget.
 * - `MAX_MEETING_CHARS` is the ABSOLUTE ceiling: above it the whole request is
 *   refused, because map-reduce turns one call into N+1 and unbounded chunking
 *   is a metered-call amplifier. At 10× the chunk budget it caps a pass at ~11
 *   calls — a very long meeting is served, an abusive payload is not.
 *
 * The per-field caps stop a single pathological turn or an unbounded array from
 * reaching the prompt at all; `MAX_TURNS` is raised in step with the meeting
 * ceiling so the char total, not the turn count, is the binding limit.
 */
export const MINUTES_LIMITS = {
  MAX_TURNS: 40_000,
  MAX_TURN_CHARS: 4000,
  MAX_SPEAKER_LABEL_CHARS: 120,
  MINUTES_CHUNK_CHARS: 80_000,
  MAX_MEETING_CHARS: 800_000,
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
      MINUTES_LIMITS.MAX_MEETING_CHARS,
    {
      path: ['turns'],
      message: `transcript exceeds ${MINUTES_LIMITS.MAX_MEETING_CHARS} characters`,
    },
  );
export type GenerateMinutesRequest = z.infer<typeof generateMinutesRequestSchema>;

export const minutesResponseSchema = z.object({
  minutes: meetingMinutesSchema,
});
export type MinutesResponse = z.infer<typeof minutesResponseSchema>;
