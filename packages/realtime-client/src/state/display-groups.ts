import type { TranscriptSegment } from '@chatofy/types';
import { attributionFor, type AttributionsBySession } from './speaker-roster.js';
import type { CapturesBySession } from './turn-keyed-transcript.js';

/**
 * How a run of turns is shown when one utterance became several of them.
 *
 * The length ceiling (`maxUtteranceMs`) cuts a turn while the speaker is still
 * going, so reading a paragraph aloud produces two or three turns rather than
 * one. Each arrives with its own speaker prompt, and the reader is asked who
 * spoke two or three times about one sentence.
 *
 * This groups those back together **for display only**. Nothing about how the
 * audio was chunked, translated, or measured changes: the turns are still turns,
 * `cutForced` still counts what it counted, and no VAD constant moves. Raising
 * the ceiling would have fixed the same symptom by letting a translation fall
 * arbitrarily far behind the speaker, which is the trade the ceiling exists to
 * refuse.
 */

/**
 * Longest silence between one turn closing and the next opening that still
 * counts as one utterance.
 *
 * The gap between CLOSE and OPEN, not between two opens: a turn cut at the
 * ceiling ran for the whole ceiling, so its neighbours' `openedAt` values are a
 * ceiling apart no matter how continuous the speech was. What says the speaker
 * never stopped is how little time passed after the cut.
 *
 * This bounds how long the gate takes to RE-OPEN on continuing speech, which is
 * not the same thing as how long a pause lasts. Re-opening waits for the level
 * to clear the adaptive noise floor for `MIN_SPEECH_MS`, and after a cut that
 * landed on a quiet block the next syllable can be soft — so the interval runs
 * well past the 500ms hangover even though nobody stopped talking.
 *
 * Measured over 22 forced cuts, replaying three real recordings of one speaker
 * through the real `CapturePump` at ceilings from 4s to 10s: min 128ms, median
 * 202ms, p90 427ms, max 597ms. An earlier 400ms — reasoned from a single ~130ms
 * observation, never measured — merged only 18 of those 22, and failed on two of
 * the three recordings at the shipped 8s ceiling. 1200ms is twice the observed
 * maximum.
 *
 * Widening it is safe because it is not what keeps separate utterances apart:
 * `cutForced` is. A turn that ended on the hangover is a complete utterance and
 * never reaches this check, so no pause — however short — can merge across it.
 */
const MAX_CAPTURE_GAP_MS = 1200;

/** One rendered block: a run of turns that were one utterance. */
export interface DisplayGroup {
  /** Every turn in the block, in speaking order. */
  turns: TranscriptSegment[];
  /**
   * Every turn's session id, for attribution.
   *
   * Attributing the block has to write all of them: the chip names one speaker
   * but the state underneath is still per-turn, and leaving members unattributed
   * would split the block the moment somebody tapped it.
   */
  sessionIds: string[];
  /** Stable across re-renders; the first member's id, which never moves. */
  key: string;
}

/**
 * Whether two adjacent turns are one utterance the ceiling split.
 *
 * All four conditions are required, and each rules out a different way of being
 * wrong.
 */
function continues(
  previous: TranscriptSegment,
  next: TranscriptSegment,
  captures: CapturesBySession,
  attributions: AttributionsBySession,
): boolean {
  const previousCapture = captures[previous.sessionId];
  const nextCapture = captures[next.sessionId];

  // No capture record means the turn's close was never reported — it may still
  // be in flight, or its record may have aged out of the pipeline's bounded
  // buffer. Never merge on missing evidence.
  if (!previousCapture || !nextCapture) return false;

  // The whole premise. `cutForced` is the gate ending a turn while the speaker
  // was still going — both the hard ceiling cut and the armed-lookahead cut at a
  // quiet block. Either way the utterance continues into the next turn. A turn
  // that ended on the hangover is a complete utterance and keeps its own block.
  if (!previousCapture.cutForced) return false;

  // Capture time, not `createdAt`. `createdAt` is stamped when the SERVER
  // finished translating, so the gap between two segments is the difference of
  // two translation durations — routinely seconds, and negative whenever the
  // second turn reused a speculation while the first walked the model ladder.
  const gap = nextCapture.openedAt - previousCapture.closedAt;
  if (gap < 0 || gap > MAX_CAPTURE_GAP_MS) return false;

  // A person who has said these are two different speakers outranks anything
  // inferred here. Same rule the acoustic layer states for suggestions: a
  // confirmation always wins. Only CONFIRMED attributions split — a suggestion
  // is not evidence anybody looked.
  const previousAttribution = attributionFor(attributions, previous.sessionId);
  const nextAttribution = attributionFor(attributions, next.sessionId);
  const bothConfirmed =
    previousAttribution.origin === 'confirmed' && nextAttribution.origin === 'confirmed';
  if (bothConfirmed && previousAttribution.speakerId !== nextAttribution.speakerId) return false;

  return true;
}

/**
 * Finished turns as the blocks they should be read in.
 *
 * Ordered by capture time before grouping, because `turns` is COMPLETION order:
 * the reducer appends each segment as it arrives, and with several turns in
 * flight a first half whose translation walked the ladder can land after a
 * second half that reused a speculation. Grouping that order directly renders an
 * utterance backwards.
 *
 * Turns with no capture record keep their arrival position rather than being
 * dropped or sorted to one end — they are un-mergeable either way, and moving
 * them would reorder the transcript on missing evidence.
 */
export function groupTurnsForDisplay(
  turns: readonly TranscriptSegment[],
  captures: CapturesBySession,
  attributions: AttributionsBySession,
): DisplayGroup[] {
  // Sort the turns that HAVE a capture record among themselves, and write them
  // back into the slots they occupied. The obvious `sort` with a comparator that
  // returns 0 for a missing record is not a total order, and V8 does not rescue
  // it: `[B(100), A(none), C(50)]` comes back `B, A, C`, and six turns where only
  // three have records come back untouched. Both leave an utterance rendered
  // backwards, which is the failure this ordering exists to prevent.
  const ordered = [...turns];
  const slots = ordered
    .map((turn, index) => (captures[turn.sessionId] ? index : -1))
    .filter((index) => index !== -1);
  const sorted = slots
    .map((index) => ordered[index]!)
    .sort(
      (left, right) => captures[left.sessionId]!.openedAt - captures[right.sessionId]!.openedAt,
    );
  slots.forEach((slot, position) => {
    ordered[slot] = sorted[position]!;
  });

  const groups: DisplayGroup[] = [];
  for (const turn of ordered) {
    const open = groups[groups.length - 1];
    const previous = open?.turns[open.turns.length - 1];
    if (open && previous && continues(previous, turn, captures, attributions)) {
      open.turns.push(turn);
      open.sessionIds.push(turn.sessionId);
      continue;
    }
    groups.push({ turns: [turn], sessionIds: [turn.sessionId], key: turn.id });
  }
  return groups;
}

/**
 * One block's source text, repaired where a repair exists.
 *
 * Joined with a space and nothing cleverer. A forced cut lands mid-word, so the
 * seam can read badly — repairing it would mean guessing at a word neither half
 * contains, which is the one thing the translation prompt is also forbidden to
 * do. The roughness is accepted and visible rather than papered over.
 */
export function groupSourceText(group: DisplayGroup, displays: Record<string, string>): string {
  return group.turns.map((turn) => displays[turn.sessionId] ?? turn.sourceText).join(' ');
}

/** One block's translated text, in speaking order. */
export function groupTargetText(group: DisplayGroup): string {
  return group.turns.map((turn) => turn.targetText).join(' ');
}
