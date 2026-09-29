// Conversation history domain types — schema-first (zod source, types inferred).
//
// A stored conversation is what a user READ, not what the recognizer emitted.
// The live screen renders `groupTurnsForDisplay(...)`, which merges the several
// raw turns an 8-second utterance ceiling splits a sentence into back into one
// displayed block and substitutes the repaired rendering. That merge happens on
// the client BEFORE the save, so one `ConversationTurn` here is one displayed
// block — which is why `position` is display-block order.
//
// ONE capture time now travels, and the change is narrow on purpose. This file
// used to say the capture times "never have to travel", which was true while
// nothing could ask when something was said. Conversation recording is what
// asks: a reader checking a suspect line needs to find it in the audio, so each
// block carries the offset at which it was spoken. The pair `openedAt`/`closedAt`
// still stays on the client — only the first member's `openedAt`, relative to the
// conversation's start, is persisted, because that is the whole of what a
// timestamp gutter reads.
import { z } from 'zod';
import { speakerRoleSchema } from './session.js';
import {
  type LanguageCode,
  conversationLanguagesSchema,
  sourceLanguagesSchema,
  translationDirectionSchema,
  translationMapSchema,
} from './languages.js';

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
 *
 * `sourceLanguages` and `translations` are the language-keyed record of what
 * was said and what it became; `targetText` is the pre-fan-out field, KEPT
 * rather than replaced, mirroring `TranscriptSegment`'s own `direction`/
 * `targetText` pair (`domain/transcript.ts`). A SERVER response always carries
 * both — `PrismaConversationStore` fills `targetText` from `translations` via
 * {@link primaryTranslation} on every read — so a caller reading this type from
 * an API response can treat `sourceLanguages`/`translations` as present.
 *
 * STRICT: `sourceLanguages`/`translations` are REQUIRED, no preprocessing.
 * `packages/realtime-client`'s `toConversationTurns` and `apps/web`'s
 * `use-conversation-save.ts` build every field of this shape directly — there is
 * no client left that constructs one without them — so a caller that forgot to
 * fill a new one fails to typecheck rather than being quietly patched here.
 * Backward-compatible PARSING of a turn that predates these two fields is a
 * separate concern that belongs only to a RESPONSE a rolled-back API sent, and
 * lives in `http/conversations.ts`'s wire schemas via `fillTurnLanguages`
 * (`language-fields-compat.ts`).
 */
export const conversationTurnSchema = z.object({
  /** Display-block order, 0-based. Not a spoken-turn index. */
  position: z.number().int().min(0),
  speakerRole: speakerRoleSchema,
  speakerLabel: z.string().nullable(),
  sourceText: z.string(),
  displayText: z.string().nullable(),
  /** The language(s) this block was spoken in. One, except for a mixed block. */
  sourceLanguages: sourceLanguagesSchema,
  /** A translation per destination language; only the targets this block needed. */
  translations: translationMapSchema(z.string()),
  targetText: z.string(),
  /**
   * Milliseconds from the conversation's `startedAt` to the moment capture
   * opened on this block — its FIRST member's `openedAt`, the same measurement
   * display grouping already trusts to decide whether two turns were one
   * utterance.
   *
   * NULL for a row written before this field existed, and for a block whose
   * capture record never arrived (the turn may still have been in flight, or its
   * record may have aged out of the pipeline's bounded buffer). Null is read as
   * "no time to show", never as zero — a block that renders `0:00` because
   * nothing was measured is a lie a reader cannot detect.
   *
   * Conversation time, not media time. The recording starts after `startedAt` —
   * the permission prompt, the worklet load and the socket connect all sit
   * between them — so a player position is this minus the conversation's
   * `audioOffsetMs`, never this on its own.
   *
   * Defaulted to null on the READ side for the same reason the write side
   * defaults it — see `saveConversationTurnSchema.offsetMs` — plus one more: an
   * API rollback to a build that predates this field would otherwise fail every
   * detail response's validation and render every conversation as "deleted",
   * which is a worse lie than a missing timestamp.
   */
  offsetMs: z.number().int().min(0).nullable().default(null),
});
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

/**
 * The turn's legacy `targetText` — the ONE translation an old reader shows —
 * derived from the language-keyed record rather than stored twice.
 *
 * The target is the conversation's first declared language the turn was NOT
 * spoken in — `languages` is declared-source-first (see `conversationLanguagesOf`),
 * so for an ordinary single-source turn this is simply "the other one". A mixed
 * turn (several `sourceLanguages`) has no single right answer either way;
 * picking the conversation's first uncovered language keeps the choice
 * deterministic rather than undefined. When the turn covers EVERY declared
 * language (always the case for a mixed turn in a two-language conversation),
 * the pick falls back to the first declared language with a non-empty
 * translation.
 *
 * Shared by two callers that must agree byte-for-byte: `PrismaConversationStore`
 * uses it to fill the DROPPED `targetText` column's replacement on every read,
 * and the history UI (`HistoryTranscript`) reads the same field to render a
 * block, so a reader watching a live conversation and the same conversation read
 * back from history sees the identical translation picked out of the map.
 *
 * Takes its own inline shape rather than `Pick<ConversationTurn, ...>` for
 * clarity at the call site: both fields are required on `ConversationTurn`
 * already, but spelling out exactly the two this function reads keeps its
 * signature legible without following the import.
 */
export function primaryTranslation(
  turn: {
    sourceLanguages: readonly LanguageCode[];
    translations: Partial<Record<LanguageCode, string>>;
  },
  languages: readonly LanguageCode[],
): string {
  const target = languages.find((code) => !turn.sourceLanguages.includes(code));
  if (target !== undefined) return turn.translations[target] ?? '';
  // Every declared language was spoken in this turn, so there is no uncovered
  // one — but a mixed turn is translated into the whole set, sources included,
  // so the map normally holds a rendering for each. Showing nothing would read
  // as a lost translation; the first declared language that has one is the
  // same deterministic pick, made among what was actually stored.
  const rendered = languages.find((code) => (turn.translations[code] ?? '') !== '');
  return rendered === undefined ? '' : (turn.translations[rendered] ?? '');
}

/**
 * A conversation as the history LIST renders it — no turns.
 *
 * `startedAt`/`endedAt` are reported by the browser and exist to show a
 * duration on a card. They are deliberately not the list's sort key: a client
 * clock can lie, and the server-stamped creation instant is the only one the
 * API can vouch for.
 *
 * `preview` is the first block's text, computed at read.
 *
 * `languages` is the stored column — declared source first, so `direction` is
 * `legacyDirectionOf(languages)` and not a second fact about the row.
 * `direction` is KEPT rather than replaced, for the same reason
 * `ConversationTurn.targetText` is: `apps/api` does not deploy atomically with
 * every open client tab, so a reader ahead of a rollback still needs the field
 * it has always read.
 *
 * STRICT, mirroring `ConversationTurn.sourceLanguages`/`translations`:
 * `apps/web` reads `languages` directly now (`DirectionLabel`'s `from`/`to`) and
 * sends it on every save, and `PrismaConversationStore.toSummary` fills it on
 * every read — so a hand-built value missing it fails to typecheck. Backward-
 * compatible parsing of a rolled-back API's response, which predates this
 * column, lives in `http/conversations.ts`'s wire schemas via
 * `fillConversationLanguages`.
 */
export const conversationSummarySchema = z.object({
  conversationId: z.string(),
  direction: translationDirectionSchema,
  languages: conversationLanguagesSchema,
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

/**
 * One conversation with its full transcript, for the detail screen.
 *
 * The three recording fields are on the DETAIL contract only.
 * `conversationSummarySchema` is deliberately untouched: the list card shows no
 * recording marker, and adding one is scope this feature was not asked for.
 *
 * Note what is absent — the object KEY. The detail screen needs to know whether
 * a recording exists and how to place a timestamp inside it; it never needs to
 * address the object, because the API route is the way in. Putting the key in a
 * contract would publish it to every caller and make the storage layout a public
 * interface.
 */
export const conversationSchema = conversationSummarySchema.extend({
  turns: z.array(conversationTurnSchema),
  /**
   * Whether a playable recording was stored.
   *
   * Derived server-side from the stored DURATION, not from the object key. The
   * key is claimed before a single byte is written — that is what stops two
   * concurrent uploads minting two objects — so a key is present during an
   * upload that has not finished, and stays present after one that failed.
   * The duration is written only once the bytes are stored, which is the
   * question this field is actually asked: is there something to play.
   *
   * Defaulted to `false` — see `audioOffsetMs` below for why the whole detail
   * response tolerates a build that predates it.
   */
  hasRecording: z.boolean().default(false),
  /**
   * Milliseconds between the conversation's `startedAt` and the first recorded
   * sample, or NULL when the client never reported one.
   *
   * Not zero, and not derivable: `startedAt` is stamped before the microphone is
   * even requested, so this absorbs the permission prompt, the worklet load and
   * the socket connect. It is what turns a turn's `offsetMs` into a position in
   * the media, and getting it wrong moves every timestamp by the same constant.
   *
   * **Present without a recording, and that is the point.** The transcript save
   * carries it as well as the audio upload, because it is not a fact about the
   * stored object — it is the shift every timestamp is READ through, and the
   * live screen applied it to the very same turns while they were being spoken.
   * A conversation whose audio was refused therefore still reads the way it read
   * on `/translate`. `hasRecording` is what says whether there is anything to
   * play; this never was.
   *
   * Defaulted to null rather than required. This is a RESPONSE the client
   * validates, and the write side of this same feature already treats "a build
   * that predates a field" as routine — see `saveConversationTurnSchema.offsetMs`.
   * An API-only rollback here is the same event from the other direction: it
   * would stop sending these three recording fields, and a required schema would
   * fail every detail fetch's validation and render every conversation as
   * "deleted" rather than merely as one with no recording.
   */
  audioOffsetMs: z.number().int().min(0).nullable().default(null),
  /**
   * The recording's length in milliseconds, or NULL when there is none.
   *
   * Stored rather than read from the media element. `MediaRecorder` writes no
   * Duration into the WebM Segment Info, so `audio.duration` on the resulting
   * blob commonly reads `Infinity` — a scrubber needs a real total, and this is
   * the only place one exists.
   */
  audioDurationMs: z.number().int().min(0).nullable().default(null),
});
export type Conversation = z.infer<typeof conversationSchema>;
