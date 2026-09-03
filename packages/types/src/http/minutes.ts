// Meeting-minutes HTTP contracts — schema-first.
//
// The generate request used to CARRY the transcript, because the API kept no
// copy of it. It no longer has to: a finished conversation is stored, so this is
// the "generate from the stored session" form the previous comment reserved,
// arriving as a REPLACEMENT for the carrying form rather than beside it.
//
// What that changes about cost is worth stating here, where the limits live. The
// body is now ~20 bytes while the server loads up to MAX_TOTAL_CHARS of stored
// transcript into a billed call — roughly a 4000:1 amplifier — which is why the
// route carries its own throttle rather than relying on a global one that does
// not exist.
import { z } from 'zod';
import { meetingMinutesSchema } from '../domain/minutes.js';
import { languageCodeSchema } from '../domain/transcript.js';

/**
 * Ceilings on a generate pass.
 *
 * The turns are now LOADED rather than submitted, but their size is still a cost
 * lever rather than a validation nicety — one request is one metered
 * summarization call whose price scales with the transcript, so the ceiling has
 * to be enforced somewhere. It moved from the request body to the point the
 * stored turns are read.
 *
 * `MAX_TOTAL_CHARS` at ~80k is a long meeting with comfortable headroom under a
 * flash model's context. It is deliberately NOT
 * `HISTORY_LIMITS.MAX_TOTAL_CHARS` (400k): a conversation past the storage
 * ceiling cannot be SAVED, while one past this ceiling saves fine and is
 * readable and simply cannot be summarized. Coupling them would let a model swap
 * that raises the prompt budget silently raise the Postgres row cap too.
 */
export const MINUTES_LIMITS = {
  MAX_TURNS: 4000,
  MAX_TURN_CHARS: 4000,
  MAX_SPEAKER_LABEL_CHARS: 120,
  MAX_TOTAL_CHARS: 80_000,
} as const;

/**
 * One turn as the prompt sees it.
 *
 * `speakerLabel` is a display label ("Speaker 1", or a name the user typed on
 * the roster), NOT the internal `speaker_a`/`speaker_b` role — the minutes are
 * written for a human to read, so the label the human assigned is what belongs
 * in them. `text` is the settled source-language line; the model is given the
 * conversation in the language it happened in, not the translation.
 *
 * No longer part of any request body. It survives as the shape the projection on
 * each client produces — the extension's `minutes-source.ts` imports this type —
 * and as what the API builds from the turns it loaded.
 */
export const minutesSourceTurnSchema = z.object({
  speakerLabel: z.string().min(1).max(MINUTES_LIMITS.MAX_SPEAKER_LABEL_CHARS),
  text: z.string().min(1).max(MINUTES_LIMITS.MAX_TURN_CHARS),
});
export type MinutesSourceTurn = z.infer<typeof minutesSourceTurnSchema>;

/**
 * The whole body: which language to WRITE the minutes in, and nothing else.
 *
 * The transcript is named by the URL now. A client that still sends `turns` is
 * not refused — no request schema in this repo uses `.strict()`, and zod strips
 * unknown keys — it is simply ignored, and the stored conversation is what gets
 * summarized.
 */
export const generateMinutesRequestSchema = z.object({
  /** Defaults to the app's UI language. */
  language: languageCodeSchema.optional(),
});
export type GenerateMinutesRequest = z.infer<typeof generateMinutesRequestSchema>;

export const minutesResponseSchema = z.object({
  minutes: meetingMinutesSchema,
});
export type MinutesResponse = z.infer<typeof minutesResponseSchema>;
