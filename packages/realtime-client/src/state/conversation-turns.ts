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
} from './display-groups.js';
import { speakerFor } from './speaker-roster.js';
import type { TurnKeyedTranscript } from './turn-keyed-transcript.js';

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
 * Takes only the fields it reads, so a caller can pass the hook's return value
 * or a hand-built fixture without constructing a whole reducer state.
 */
export function toConversationTurns(
  state: Pick<TurnKeyedTranscript, 'turns' | 'speakers' | 'attributions' | 'captures' | 'displays'>,
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

    const source = splitAtCap(sourceText);
    const display = rendered === sourceText ? [] : splitAtCap(rendered);
    const target = splitAtCap(groupTargetText(group));
    const pieces = Math.max(source.length, display.length, target.length);

    for (let piece = 0; piece < pieces; piece += 1) {
      rows.push({
        position: rows.length,
        speakerRole: head.speakerRole,
        speakerLabel,
        sourceText: source[piece] ?? '',
        // Empty becomes null, never '': a reader and the minutes prompt both
        // read `displayText ?? sourceText`, so an empty string would claim the
        // block was repaired into nothing and hide the recognizer's line.
        displayText: display[piece] || null,
        targetText: target[piece] ?? '',
      });
    }
  }
  return rows;
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
 * Each field is cut independently and the block becomes as many rows as the
 * longest of them needs, so nothing is dropped and every piece is a valid stored
 * turn. Under the cap — every ordinary block — this returns the text unchanged
 * and the projection is exactly what it was.
 */
function splitAtCap(text: string): string[] {
  if (text.length <= HISTORY_LIMITS.MAX_TURN_CHARS) return [text];

  const pieces: string[] = [];
  let rest = text;
  while (rest.length > HISTORY_LIMITS.MAX_TURN_CHARS) {
    const space = rest.lastIndexOf(' ', HISTORY_LIMITS.MAX_TURN_CHARS);
    const cut =
      space >= HISTORY_LIMITS.MAX_TURN_CHARS - WORD_BOUNDARY_WINDOW
        ? space
        : HISTORY_LIMITS.MAX_TURN_CHARS;
    pieces.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}
