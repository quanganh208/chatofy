'use client';

import type { CapturesBySession, LiveTurn } from '@chatofy/realtime-client';
import {
  groupSourceText,
  groupTargetText,
  groupTurnsForDisplay,
  speakerFor,
  type AttributionsBySession,
  type SessionSpeaker,
} from '@chatofy/realtime-client';
import type { TranscriptSegment } from '@chatofy/types';
import { cn } from '@/lib/utils';
import { useTranslate } from '@/i18n/provider';
import { SpeakerChip } from '@/components/translate/speaker-chip';

interface ConversationTranscriptProps {
  turns: TranscriptSegment[];
  /**
   * The turns being spoken right now, in the order they started.
   *
   * A list, not one line: capture does not stop while a turn is translated, so
   * someone can start a second sentence before the first is answered.
   */
  liveTurns: (LiveTurn & { sessionId: string })[];
  /**
   * What capture measured about each finished turn.
   *
   * Needed because one utterance can arrive as several turns: the length ceiling
   * cuts a turn mid-word while the speaker is still going, so reading a
   * paragraph aloud produces two or three of them. Without this every one gets
   * its own speaker prompt and the reader is asked who spoke three times about
   * one sentence.
   */
  captures: CapturesBySession;
  /**
   * Repaired source text per turn, where a repair exists.
   *
   * Falls back to the segment's own `sourceText`, which stays the record of what
   * the recognizer actually produced.
   */
  displays: Record<string, string>;
  /** Whether a session is up, so the empty state can say the right thing. */
  running?: boolean;
  /**
   * How a turn is arranged. Defaults to `stacked` so any other caller is unaffected.
   */
  layout?: 'stacked' | 'columns';
  speakers: SessionSpeaker[];
  attributions: AttributionsBySession;
  onAttribute: (sessionId: string, speakerId: string) => void;
  onUnattribute: (sessionId: string) => void;
  onAddSpeaker: () => void;
}

/**
 * Finished turns, newest last, so the exchange reads top to bottom like a chat,
 * with the sentence currently being spoken at the bottom.
 *
 * Both sides of every turn are shown: the speaker needs to see what was heard
 * to catch a misrecognition, and the listener reads the translation while it is
 * being spoken. The translation is set larger than the source, because it is the
 * thing being read — when both were the same size the eye had to be told which
 * line to look at, every turn. **That holds in both layouts.** Columns place the
 * two side by side; they do not make them equals.
 *
 * A left rule instead of a card per turn. Twelve identical bordered boxes have no
 * rhythm and a long conversation becomes unscannable; the rule marks the turn and
 * the spacing separates it. The meeting overlay marks its own turns the same way,
 * which is the point — the two surfaces are one product. The rule belongs to the
 * turn rather than to a cell, so a two-column turn still carries exactly one, and
 * the speaker chip shares that rule rather than getting a border of its own, for
 * the same reason.
 *
 * The live line is what stops the screen going dead while someone talks — the
 * wait for a translation is the same length either way, but a still page makes
 * it feel like nothing is happening. It is styled as unfinished, because it is:
 * the recogniser revises words as it hears more, and a line that looks settled
 * and then changes reads as a mistake rather than as progress.
 *
 * **Columns collapse below `sm` in CSS, not in JavaScript.** Two prose columns do
 * not fit a phone. A `matchMedia` fork would render one thing on the server and
 * another on the client, which is a hydration mismatch and a visible flicker; a
 * grid that is one column until the breakpoint is neither. The chip spans the
 * whole grid row there rather than taking a cell: it names the turn, not one side
 * of it, and a chip in the source column would pair itself with the translation.
 *
 * **Chips appear on finished turns only.** A live turn can still be abandoned,
 * and an attribution left on one would render nowhere while still making the
 * person it named unremovable — a speaker nobody can delete because of a turn
 * nobody can see.
 *
 * **`speakerRole` is deliberately not rendered.** Every segment carries it, but
 * it is a side of a translation, constant for a whole session and derived from
 * the direction toggle. Showing it as though it named a person would put an
 * identity on screen that nobody chose, which is exactly what the chip's
 * fallback state exists to prevent.
 */
export function ConversationTranscript({
  turns,
  liveTurns,
  captures,
  displays,
  running,
  layout = 'stacked',
  speakers,
  attributions,
  onAttribute,
  onUnattribute,
  onAddSpeaker,
}: ConversationTranscriptProps) {
  const t = useTranslate();
  if (turns.length === 0 && liveTurns.length === 0) {
    // An empty state that says what to do. Rendering nothing left the page
    // looking broken before the first turn, which is exactly when a new user is
    // deciding whether it works.
    return (
      <p className="text-prose border-hairline text-body rounded-lg border border-dashed px-6 py-10 text-center">
        {running ? t('web.translate.transcriptListening') : t('web.translate.transcriptEmpty')}{' '}
        {t('web.translate.transcriptAttribution')}
      </p>
    );
  }

  // One utterance the ceiling split into several turns reads as one block. Pure
  // derivation over the turns already in state — nothing about how the audio was
  // chunked, translated or measured changes.
  const groups = groupTurnsForDisplay(turns, captures, attributions);

  const columns = layout === 'columns';
  // `items-start` on purpose: a long Vietnamese source beside a short English
  // translation is ragged, and the alternative — equalising the two — can only be
  // done by truncating, which loses the thing someone is reading.
  const turnLayout = columns
    ? 'grid grid-cols-1 items-start gap-x-6 gap-y-1.5 sm:grid-cols-2'
    : 'flex flex-col gap-1.5';

  return (
    <ol className="flex flex-col gap-6">
      {groups.map((group) => {
        // Read the first CONFIRMED member, not simply the first.
        //
        // A group splits only when both sides are confirmed and name different
        // people, so a group can hold one confirmed member beside unattributed
        // ones — and it routinely does: capture records arrive after the segments
        // they describe, so the halves render separately for a moment and somebody
        // can attribute one of them in that window. Reading `sessionIds[0]` there
        // would show `fallback` while state says otherwise, and the next tap would
        // silently overwrite the confirmation the screen never showed.
        const chipSessionId =
          group.sessionIds.find((sessionId) => attributions[sessionId]?.origin === 'confirmed') ??
          group.sessionIds[0]!;
        return (
          <li key={group.key} className={cn('border-primary border-l-2 pl-4', turnLayout)}>
            <div className={cn(columns && 'sm:col-span-2')}>
              <SpeakerChip
                speakers={speakers}
                speaker={speakerFor(speakers, attributions, chipSessionId)}
                origin={attributions[chipSessionId]?.origin ?? 'fallback'}
                // Written to EVERY member, not just the one the chip reads.
                // Attribution state is per turn, so leaving the rest unattributed
                // would split the block the moment somebody tapped it — the tap
                // would visibly undo the grouping it was meant to label.
                //
                // Worth knowing before the acoustic layer is switched on: only
                // CONFIRMED turns seed a voice profile, so one tap here confirms
                // every member and a wrongly merged block would fold a second
                // person's voice into one centroid. The merge is display-only
                // today; that is what would make it acoustically load-bearing.
                onAttribute={(speakerId) =>
                  group.sessionIds.forEach((sessionId) => onAttribute(sessionId, speakerId))
                }
                onUnattribute={() =>
                  group.sessionIds.forEach((sessionId) => onUnattribute(sessionId))
                }
                onAddSpeaker={onAddSpeaker}
              />
            </div>
            <p className="text-prose text-body">{groupSourceText(group, displays)}</p>
            <p className="text-translation font-medium">{groupTargetText(group)}</p>
          </li>
        );
      })}

      {liveTurns.map((live) => (
        <li
          key={live.sessionId}
          className={cn('border-border border-l-2 border-dashed pl-4 opacity-80', turnLayout)}
          aria-live="polite"
        >
          <p className="text-prose text-body italic">{live.text}</p>
          {/* Only on turns long enough for the wait to be felt; short ones
              have their real translation before a guess would be read.

              In columns the cell is rendered empty rather than omitted, so the
              source stays in its own column instead of widening across both and
              then jumping back when the guess arrives. */}
          {live.translation ? (
            <p className="text-muted-foreground text-translation italic">{live.translation}</p>
          ) : columns ? (
            <p aria-hidden />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
