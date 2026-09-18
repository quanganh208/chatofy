// Turn the finished conversation the reducer holds into the rows the history
// endpoint stores.
//
// The projection GROUPS FIRST. The live screen never renders raw turns: the
// 8-second utterance ceiling splits one spoken sentence into several, and
// `groupTurnsForDisplay` merges them back using capture timestamps and the
// measured gap constant. Storing raw turns would make `/history` show a
// paragraph as three separately-attributed rows of unpunctuated recognizer
// output — the exact defect display grouping was built and measured to prevent —
// and a search for a phrase the user actually saw would find nothing.
//
// So one row here is one DISPLAYED BLOCK — except where a block is longer than a
// stored field may be, which is what `splitAtCap` below handles — and `position`
// is display-block order.
//
// The speaker rule here is deliberately NOT the one the minutes projection uses.
// Minutes need a human-readable name for a prompt and fall back to a hard-coded
// "Speaker A"; history stores `null` and lets the screen compose a LOCALIZED
// fallback, because a database string is invisible to the compiler-enforced i18n
// parity and an English name written into a Vietnamese user's rows is unfixable
// without a data migration.
import { HISTORY_LIMITS, type ConversationTurn } from '@chatofy/types';
import {
  groupRawSourceText,
  groupSourceText,
  groupTargetText,
  groupTurnsForDisplay,
  type DisplayGroup,
} from './display-groups.js';
import { speakerFor } from './speaker-roster.js';
import type { CapturesBySession, TurnKeyedTranscript } from './turn-keyed-transcript.js';

/**
 * Project the finished turns onto stored rows, in display order.
 *
 * - `sourceText` is the block's recognizer text.
 * - `displayText` is the repaired rendering, present ONLY when it differs —
 *   the same "presence is the claim" rule the reducer's `displays` map uses,
 *   and what lets a reader tell a repair from a misrecognition.
 * - `speakerLabel` is the roster label the user confirmed, or `null` when they
 *   never attributed the block.
 * - `speakerRole` is always present; it is the localizable primitive a screen
 *   builds its fallback name from.
 * - A block the recognizer produced nothing for is dropped, and `position` is
 *   assigned after that, so stored positions are contiguous from zero.
 * - A block over the per-field storage cap becomes several rows rather than one
 *   refused save — see {@link splitAtCap}.
 *
 * - `offsetMs` is when the block was spoken, relative to `startedAtMs` — see
 *   below for why it is the block's FIRST member and why it clamps.
 *
 * Takes only the fields it reads, so a caller can pass the hook's return value
 * or a hand-built fixture without constructing a whole reducer state.
 *
 * `startedAtMs` is the conversation's start as epoch milliseconds. Both clocks
 * are `Date.now()` in the same tab — `openedAt` is stamped in the turn pipeline,
 * `startedAt` when the session starts — so the subtraction is meaningful without
 * introducing a second time source.
 *
 * Defaulted to 0 rather than required. This export is shared with the extension
 * and mobile, and it gained this parameter with conversation recording; a caller
 * still on the previous signature would otherwise pass `undefined`, and
 * `Math.max(0, openedAt - undefined)` is `NaN` for every row — a save the server
 * 400s outright rather than one row losing its timestamp.
 */
export function toConversationTurns(
  state: Pick<TurnKeyedTranscript, 'turns' | 'speakers' | 'attributions' | 'captures' | 'displays'>,
  startedAtMs: number = 0,
): ConversationTurn[] {
  const groups = groupTurnsForDisplay(state.turns, state.captures, state.attributions);

  const rows: ConversationTurn[] = [];
  for (const group of groups) {
    const head = group.turns[0];
    if (!head) continue;

    const sourceText = groupRawSourceText(group);
    const rendered = groupSourceText(group, state.displays);
    if (!sourceText.trim() && !rendered.trim()) continue;

    // The block's speaker, read from its first member: grouping already refuses
    // to merge two turns that name different people, so every member of a block
    // resolves to the same speaker — and every piece the block is split into
    // keeps it, or the split would strip the attribution off the tail.
    const speakerLabel =
      speakerFor(state.speakers, state.attributions, head.sessionId)?.label ?? null;

    const offsetMs = displayGroupOffsetMs(group, state.captures, startedAtMs);

    // One row count for the whole block, with every field cut into that many
    // pieces — see {@link spreadOver} for why a field that needed fewer is cut
    // again rather than left short.
    const source = splitAtCap(sourceText);
    const display = rendered === sourceText ? [] : splitAtCap(rendered);
    const target = splitAtCap(groupTargetText(group));
    const pieces = Math.max(source.length, display.length, target.length);
    const sourceRows = spreadOver(source, pieces);
    const displayRows = spreadOver(display, pieces);
    const targetRows = spreadOver(target, pieces);

    for (let piece = 0; piece < pieces; piece += 1) {
      rows.push({
        position: rows.length,
        speakerRole: head.speakerRole,
        speakerLabel,
        sourceText: sourceRows[piece] ?? '',
        // Empty becomes null, never '': a reader and the minutes prompt both
        // read `displayText ?? sourceText`, so an empty string would claim the
        // block was repaired into nothing and hide the recognizer's line.
        displayText: displayRows[piece] || null,
        targetText: targetRows[piece] ?? '',
        // Every piece of a split block carries the BLOCK's offset. A split is
        // one utterance shown as several rows because a field outgrew its
        // column — the pieces were all said at one moment, and giving the tail
        // a later time would invent a pause that never happened.
        offsetMs,
      });
    }
  }
  return rows;
}

/**
 * When a displayed block was spoken, in milliseconds from `startedAtMs`.
 *
 * **Exported because the live screen must show the number it is going to
 * STORE.** `/translate` renders a timestamp on every finished block and
 * `/history` renders one for the same block read back; those two agree only
 * because both come from this one rule, applied to the same capture record. A
 * second implementation on the live side would be a second rounding, a second
 * clamp and a second decision about which member of a block to read — three
 * ways for the two screens to disagree by a second on the sentence somebody is
 * looking at.
 *
 * Read from the block's FIRST member for the same reason the speaker is: a
 * block is one utterance the ceiling split, so its start is the start of the
 * first piece. Reading the last would put the timestamp at the end of a long
 * sentence, which is not where a reader wants the player.
 *
 * **The capture's pre-roll comes off here, and only here.** `openedAt` is when
 * the gate confirmed speech, and the pump prepends what it kept from just
 * before — so the turn's audio, and every recording of it, begins that much
 * earlier than `openedAt` says. A seek to the uncorrected number lands past the
 * syllable the pre-roll exists to save, measured at +217ms against true onset.
 * Subtracting at the stamp instead was rejected: `openedAt` is also what
 * `groupTurnsForDisplay` measures its 1200ms gap with, and shrinking every gap
 * by the pre-roll merges turns that were never one utterance.
 *
 * The amount is the capture's own, not a constant, and a capture that recorded
 * none is not moved: a turn whose pre-roll was empty — the state
 * `CapturePumpOptions.continuous` documents — contains no audio before
 * `openedAt` to point at.
 *
 * A missing capture record yields null rather than 0. The record arrives
 * separately and may be absent for a turn still in flight or one that aged out
 * of the pipeline's bounded buffer — the same "never merge on missing evidence"
 * rule grouping applies. Zero would render `0:00` and claim the block opened the
 * conversation.
 *
 * The floor is not defensive noise: `startedAt` is stamped just BEFORE
 * `session.start()`, and a turn cannot open before the microphone does, so a
 * negative here means the clocks disagree rather than that time ran backwards —
 * or, since the subtraction above, that someone began speaking inside the first
 * pre-roll of the conversation, where the audio really does reach back past t=0.
 * Clamping costs one row's precision; refusing would cost the save. The ceiling
 * is the same trade for the opposite fault: a caller that failed to parse its
 * own `startedAt` and fell back to the epoch would otherwise turn `offsetMs`
 * into a value decades past `HISTORY_LIMITS.MAX_DURATION_MS`, which the write
 * schema refuses outright. A non-finite `startedAtMs` — the same failure, one
 * step earlier — reads as "no time to show" rather than propagating `NaN` into
 * every row.
 */
export function displayGroupOffsetMs(
  group: DisplayGroup,
  captures: CapturesBySession,
  startedAtMs: number,
): number | null {
  const head = group.turns[0];
  if (!head) return null;
  const capture = captures[head.sessionId];
  if (capture === undefined || !Number.isFinite(startedAtMs)) return null;
  // The turn's audio starts at its pre-roll, not at `openedAt` — see above.
  const spokenAt = capture.openedAt - (capture.preRollMs ?? 0);
  return Math.min(Math.max(0, spokenAt - startedAtMs), HISTORY_LIMITS.MAX_DURATION_MS);
}

/**
 * How much of a cut-sized piece may be given back to land on a word boundary.
 *
 * Small enough that a split is still near the cap — it exists to stop a word
 * being sliced in half, not to reflow the text — and large enough to clear any
 * ordinary word. Text with no space in that window (a URL, a long unspaced run)
 * is cut at the cap: a boundary that is not there cannot be honoured, and
 * refusing the save instead would cost the whole conversation.
 */
const WORD_BOUNDARY_WINDOW = 200;

/**
 * One text as pieces that each fit a stored field.
 *
 * Grouping has no ceiling on block size: it merges every consecutive turn the
 * capture gap says was one utterance, so a few minutes of speech with no pause
 * becomes ONE block, and `HISTORY_LIMITS.MAX_TURN_CHARS` bounds each stored
 * field. Without this the save is refused 400, the client reads 400 as terminal,
 * and the whole conversation is discarded — precisely on the long conversations
 * history exists for.
 *
 * The block becomes as many rows as the longest field needs, and every field is
 * then spread over exactly that many — see {@link spreadOver} — so nothing is
 * dropped, nothing is stored twice, and every piece is a valid stored turn.
 * Under the cap — every ordinary block — this returns the text unchanged and the
 * projection is exactly what it was.
 */
function splitAtCap(text: string): string[] {
  if (text.length <= HISTORY_LIMITS.MAX_TURN_CHARS) return [text];

  const pieces: string[] = [];
  let rest = text;
  while (rest.length > HISTORY_LIMITS.MAX_TURN_CHARS) {
    const cut = cutPoint(rest, HISTORY_LIMITS.MAX_TURN_CHARS);
    pieces.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * A field's pieces spread over `count` rows.
 *
 * A block's fields do not split alike. A rendering that repairs 4,010 characters
 * into 3,990 fits a stored field where the recognizer text did not, so one field
 * asks for two rows and the other for one — and the same happens to a
 * translation that is longer or shorter than what was said.
 *
 * A short field cannot simply be left short. Every reader — the history screen
 * and the minutes prompt — resolves a row as `displayText ?? sourceText`, so a
 * rendering that stopped after row 0 would put the repaired tail in row 0 and
 * the RAW tail in row 1, and the end of the block would be read twice.
 *
 * So the tail is cut again, once per missing row. That holds the invariant the
 * readers depend on — concatenating a block's rows in position order reproduces
 * each field exactly once, in order — for any field within a constant factor of
 * the longest one, which is what a repair or a translation of the same speech
 * is. It halves the tail each time, so a field an order of magnitude shorter
 * runs out of text before it runs out of rows and pads with empty pieces; those
 * read back as `null` and fall through to the raw text, which is the duplicate
 * this exists to prevent. That needs a degenerate rendering, not a short one.
 * No piece can grow past the cap either, because cutting a piece that already
 * fits only makes it smaller.
 *
 * An empty list stays empty: it means the block was never repaired, and
 * inventing pieces for it would claim a repair that does not exist.
 */
function spreadOver(pieces: string[], count: number): string[] {
  if (pieces.length === 0) return pieces;

  const spread = [...pieces];
  while (spread.length < count) {
    const tail = spread.pop() ?? '';
    const cut = cutPoint(tail, Math.ceil(tail.length / 2));
    spread.push(tail.slice(0, cut).trimEnd(), tail.slice(cut).trimStart());
  }
  return spread;
}

/**
 * Where to cut so a piece of at most `limit` characters ends on a word boundary.
 *
 * Falls back to `limit` itself when the nearest space is further back than
 * {@link WORD_BOUNDARY_WINDOW}, or when there is none at all — a boundary that
 * is not there cannot be honoured.
 */
function cutPoint(text: string, limit: number): number {
  const space = text.lastIndexOf(' ', limit);
  return space > 0 && space >= limit - WORD_BOUNDARY_WINDOW ? space : limit;
}
