// Conversation history domain types — schema-first (zod source, types inferred).
//
// A stored conversation is what a user READ, not what the recognizer emitted.
// The live screen renders `groupTurnsForDisplay(...)`, which merges the several
// raw turns an 8-second utterance ceiling splits a sentence into back into one
// displayed block and substitutes the repaired rendering. That merge happens on
// the client BEFORE the save, so one `ConversationTurn` here is one displayed
// block — which is why `position` is display-block order and why there is no
// per-turn timestamp: the capture times grouping needed never have to travel.
import { z } from 'zod';
import { speakerRoleSchema } from './session.js';
import { translationDirectionSchema } from './transcript.js';

/**
 * One displayed block of a stored conversation.
 *
 * `speakerLabel` is nullable rather than defaulted: it carries the roster name
 * the user confirmed, and NULL means they never attributed this block. Baking a
 * fallback in would put an English "Speaker A" permanently on a Vietnamese
 * screen — a database string is invisible to the compiler-enforced i18n parity,
 * which only sees dictionary keys. The renderer composes the fallback from
 * `speakerRole` and the dictionary instead.
 *
 * `displayText` is present ONLY when the repaired rendering differs from what
 * the recognizer produced — the same "presence is the claim" rule the live
 * reducer already applies to its `displays` map. Read it as
 * `displayText ?? sourceText`, which is also what search matches on.
 */
export const conversationTurnSchema = z.object({
  /** Display-block order, 0-based. Not a spoken-turn index. */
  position: z.number().int().min(0),
  speakerRole: speakerRoleSchema,
  speakerLabel: z.string().nullable(),
  sourceText: z.string(),
  displayText: z.string().nullable(),
  targetText: z.string(),
});
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

/**
 * A conversation as the history LIST renders it — no turns.
 *
 * `startedAt`/`endedAt` are reported by the browser and exist to show a
 * duration on a card. They are deliberately not the list's sort key: a client
 * clock can lie, and the server-stamped creation instant is the only one the
 * API can vouch for.
 *
 * `preview` is the first block's text, computed at read.
 */
export const conversationSummarySchema = z.object({
  conversationId: z.string(),
  direction: translationDirectionSchema,
  startedAt: z.string(),
  endedAt: z.string(),
  turnCount: z.number().int().min(0),
  preview: z.string(),
  /**
   * Whether a minutes artifact exists for this conversation.
   *
   * Populated from the relation, not assumed: a hard-coded `false` would make a
   * "shows a marker only when minutes exist" test pass trivially while the
   * marker never appeared for anyone.
   */
  hasMinutes: z.boolean(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

/** One conversation with its full transcript, for the detail screen. */
export const conversationSchema = conversationSummarySchema.extend({
  turns: z.array(conversationTurnSchema),
});
export type Conversation = z.infer<typeof conversationSchema>;
