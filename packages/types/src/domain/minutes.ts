// Meeting-minutes domain types — schema-first (zod source, types inferred).
//
// The product already translates a conversation turn by turn; these types are
// what an LLM pass over the FINISHED conversation produces: a summary, the
// decisions reached, and the action items owed. They are deliberately a
// separate artifact from the live transcript — a session can end without ever
// being summarized, and a summary can be regenerated without touching the turns
// it was drawn from.
import { z } from 'zod';

/**
 * Where a conversation's minutes are in their lifecycle.
 *
 * `generating` exists because the LLM pass is not instant: a caller that polls
 * needs to tell "no minutes yet" (`pending`) apart from "a pass is in flight"
 * (`generating`) apart from "the last pass threw" (`failed`), and collapsing any
 * two of those hides a state the UI has to render differently.
 */
export const minutesStatusSchema = z.enum(['pending', 'generating', 'ready', 'failed']);
export type MinutesStatus = z.infer<typeof minutesStatusSchema>;

/**
 * One thing somebody agreed to do.
 *
 * `owner` and `dueDate` are nullable rather than optional: the LLM is asked for
 * them on every item, and a null says "the model looked and the transcript did
 * not name one", which is a different fact from a field that was never modelled.
 */
export const actionItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  owner: z.string().nullable(),
  dueDate: z.string().nullable(),
});
export type ActionItem = z.infer<typeof actionItemSchema>;

/**
 * What a minutes artifact SAYS, apart from what it summarizes.
 *
 * Shared by the two owners of minutes — a stored conversation on `/translate`
 * and a conference room — so the rendering, the status machine and the failure
 * semantics are one contract, and only the parent id differs between them.
 *
 * `model` records which LLM actually produced it, so a regeneration on a
 * different model is distinguishable in storage rather than silently overwriting
 * with no trace of what changed — the same reason the translation result carries
 * the model that ran.
 */
export const minutesContentSchema = z.object({
  status: minutesStatusSchema,
  /** Two or three sentences over the whole conversation. */
  summary: z.string(),
  /** Salient points, each a single line — order is the model's. */
  keyPoints: z.array(z.string()),
  /** Decisions the parties reached, stated as settled facts. */
  decisions: z.array(z.string()),
  actionItems: z.array(actionItemSchema),
  /** ISO-8601 instant the READY artifact was produced; null until then. */
  generatedAt: z.string().nullable(),
  /** The model that produced it; null for a pending/failed record. */
  model: z.string().nullable(),
});
export type MinutesContent = z.infer<typeof minutesContentSchema>;

/** The complete minutes artifact for one stored conversation. */
export const meetingMinutesSchema = z.object({
  /** The conversation these minutes summarize — the id that appears in URLs. */
  conversationId: z.string(),
  ...minutesContentSchema.shape,
});
export type MeetingMinutes = z.infer<typeof meetingMinutesSchema>;

/**
 * The minutes of one conference room.
 *
 * One stored copy per room, readable by every participant, written in the
 * language of whoever generated it last — a regenerate by anyone replaces it.
 */
export const conferenceMinutesSchema = z.object({
  /** The conference these minutes summarize — the room id in URLs. */
  conferenceId: z.string(),
  ...minutesContentSchema.shape,
});
export type ConferenceMinutes = z.infer<typeof conferenceMinutesSchema>;
