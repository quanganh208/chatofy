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
// So one row here is one DISPLAYED BLOCK, and `position` is display-block order.
//
// Deliberately standalone rather than sharing a helper with `minutes-source.ts`:
// the two projections have diverged on the rule that matters. Minutes need a
// human-readable name for a prompt and fall back to a hard-coded "Speaker A";
// history stores `null` and lets the screen compose a LOCALIZED fallback, because
// a database string is invisible to the compiler-enforced i18n parity and an
// English name written into a Vietnamese user's rows is unfixable without a data
// migration.
import type { ConversationTurn } from '@chatofy/types';
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

    rows.push({
      position: rows.length,
      speakerRole: head.speakerRole,
      // The block's speaker, read from its first member: grouping already
      // refuses to merge two turns that name different people, so every member
      // of a block resolves to the same speaker.
      speakerLabel: speakerFor(state.speakers, state.attributions, head.sessionId)?.label ?? null,
      sourceText,
      displayText: rendered === sourceText ? null : rendered,
      targetText: groupTargetText(group),
    });
  }
  return rows;
}
