'use client';

import type { CapturesBySession, LiveTurn } from '@chatofy/realtime-client';
import {
  groupIsRepaired,
  groupRawSourceText,
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
import { SpeakerLabel } from '@/components/translate/speaker-label';
import { TranscriptSourceLine } from '@/components/translate/transcript-source-line';

/** Which halves of a turn this stream renders. */
export type TranscriptSide = 'both' | 'source' | 'target';

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
  /** Which halves this stream draws. Defaults to both, which is `list`. */
  side?: TranscriptSide;
  /** Whether a turn says who spoke it at all. */
  speakerLabels?: boolean;
  /**
   * Whether the name on a turn is the CONTROL or a copy of it.
   *
   * Exactly one stream on screen may be interactive — see `transcript-panes.tsx`
   * for which one and why.
   */
  interactive?: boolean;
  speakers: SessionSpeaker[];
  attributions: AttributionsBySession;
  onAttribute: (sessionId: string, speakerId: string) => void;
  onUnattribute: (sessionId: string) => void;
  onAddSpeaker: () => void;
  /**
   * Renaming and removing, threaded through to the chip's manage face.
   *
   * They arrive here rather than at a roster beside the transcript because there
   * is no longer a roster — see `speaker-manager.tsx`.
   */
  onRenameSpeaker: (speakerId: string, label: string) => void;
  onRemoveSpeaker: (speakerId: string) => void;
}

/**
 * One stream of turns, newest last, so the exchange reads top to bottom like a
 * chat with the sentence currently being spoken at the bottom.
 *
 * ## One stream, and `side` decides which half of a turn it holds
 *
 * This drew both halves side by side in a two-column grid for a release, which is
 * why the grid is worth explaining in its absence: `split` is now TWO PANES, one
 * per side, each mounting this component with its own `side`. A pane is a single
 * column of prose, so the grid, the chip spanning both cells, and the two-sentence
 * empty state that had to name which column was which are all gone. `list` mounts
 * one of these with `side="both"` and gets the interleaved reading the grid was
 * an alternative to.
 *
 * The translation is set larger than the source, because it is the thing being
 * read — when both were the same size the eye had to be told which line to look
 * at, every turn. `text-source` and `text-target` carry that ratio through the
 * reader's own size choice; see `app/globals.css` for why they are utilities
 * rather than a redefinition of the two role tokens.
 *
 * A left rule instead of a card per turn. Twelve identical bordered boxes have no
 * rhythm and a long conversation becomes unscannable; the rule marks the turn and
 * the spacing separates it. The meeting overlay marks its own turns the same way,
 * which is the point — the two surfaces are one product.
 *
 * The live line is what stops the screen going dead while someone talks — the
 * wait for a translation is the same length either way, but a still page makes
 * it feel like nothing is happening. It is styled as unfinished, because it is:
 * the recogniser revises words as it hears more, and a line that looks settled
 * and then changes reads as a mistake rather than as progress.
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
  side = 'both',
  speakerLabels = true,
  interactive = true,
  speakers,
  attributions,
  onAttribute,
  onUnattribute,
  onAddSpeaker,
  onRenameSpeaker,
  onRemoveSpeaker,
}: ConversationTranscriptProps) {
  const t = useTranslate();
  const showsSource = side !== 'target';
  const showsTarget = side !== 'source';

  // A live turn this stream has nothing to draw for is not a live turn HERE.
  //
  // The translation of a sentence arrives after the sentence does, so between the
  // first syllable and the first guess `live.translation` is the empty string —
  // and on the target pane that turn renders no source line and no translation
  // line. Counting it as content anyway is what emptied the pane: the empty
  // sentence was dropped as "no longer empty", the settled list was still `null`,
  // and what replaced them was a wrapper with no children.
  //
  // The two-column grid this replaced held the row open with an empty cell, which
  // is a fix a pane cannot use — there is no other cell to stay level with.
  const visibleLive = liveTurns.filter(
    (live) => (showsSource && live.text) || (showsTarget && live.translation),
  );
  const empty = turns.length === 0 && visibleLive.length === 0;

  // One utterance the ceiling split into several turns reads as one block. Pure
  // derivation over the turns already in state — nothing about how the audio was
  // chunked, translated or measured changes.
  const groups = groupTurnsForDisplay(turns, captures, attributions);

  // The rule belongs to the TURN and runs down its left edge. The right inset
  // matches the left so a pane's prose is not visibly pushed toward one side.
  const turnFrame = 'mr-8 ml-3.5 flex flex-col gap-1.5 border-l-2 pl-4';

  return (
    <div>
      {empty ? (
        // An empty state that says what to do. Rendering nothing left the page
        // looking broken before the first turn, which is exactly when a new user
        // is deciding whether it works.
        //
        // Each pane says its own sentence. A pane cannot borrow the other's
        // explanation, and in `split` the two are separated by a gap or by half
        // the screen.
        <div className="flex flex-col gap-4 px-8 py-7">
          <p className={cn('text-prose text-body', side === 'both' && 'text-center')}>
            {side === 'source'
              ? t('web.translate.panelSourceEmpty')
              : side === 'target'
                ? t('web.translate.panelTargetEmpty')
                : `${running ? t('web.translate.transcriptListening') : t('web.translate.transcriptEmpty')} ${t('web.translate.transcriptAttribution')}`}
          </p>
          {/* That turns can be marked with who said them used to be said by the
              roster sitting under this panel. The roster is now a face of the
              chip, and a chip only exists once a turn does — so with nothing on
              screen yet, this is the only place left that can say it. On the
              interactive stream only: it points at a control the other stream
              does not have. */}
          {interactive && speakerLabels && speakers.length === 0 ? (
            <p className="text-muted-foreground text-hint">
              {t('web.translate.speakerRosterHint')}
            </p>
          ) : null}
        </div>
      ) : groups.length === 0 ? null : (
        // Rendered only when there is something settled to list. A live-only
        // transcript used to draw an empty `<ol>` — an empty list in the
        // accessibility tree, plus its padding stacked on the region's, for 36px
        // of nothing above the first line anybody is waiting to read.
        <ol className="flex flex-col gap-5 pt-4">
          {groups.map((group) => {
            // Read the member with the most authority, not simply the first.
            //
            // A group splits only when both sides are confirmed and name
            // different people, so a group can hold one named member beside
            // unnamed ones — and it routinely does: capture records arrive after
            // the segments they describe, so the halves render separately for a
            // moment and a name can land on one of them in that window. Reading
            // `sessionIds[0]` there would show `fallback` while state says
            // otherwise, and the next tap would silently overwrite the name the
            // screen never showed.
            //
            // `suggested` joined this order on 2026-09-01, when the acoustic
            // layer started naming turns on its own. Before that nothing produced
            // it and preferring `confirmed` alone was complete; after it, most
            // members of most groups are `suggested`, and stopping at `confirmed`
            // would have shown an empty chip over a block state had labelled.
            const chipSessionId =
              (['confirmed', 'suggested', 'pending'] as const)
                .map((origin) =>
                  group.sessionIds.find((sessionId) => attributions[sessionId]?.origin === origin),
                )
                .find((sessionId) => sessionId !== undefined) ?? group.sessionIds[0]!;
            const origin = attributions[chipSessionId]?.origin ?? 'fallback';
            const speaker = speakerFor(speakers, attributions, chipSessionId);
            return (
              <li key={group.key} className={cn('border-primary', turnFrame)}>
                {speakerLabels ? (
                  interactive ? (
                    <SpeakerChip
                      speakers={speakers}
                      speaker={speaker}
                      origin={origin}
                      attributions={attributions}
                      onRenameSpeaker={onRenameSpeaker}
                      onRemoveSpeaker={onRemoveSpeaker}
                      // Written to EVERY member, not just the one the chip reads.
                      // Attribution state is per turn, so leaving the rest
                      // unattributed would split the block the moment somebody
                      // tapped it — the tap would visibly undo the grouping it was
                      // meant to label.
                      //
                      // Worth knowing before the acoustic layer is switched on: only
                      // CONFIRMED turns seed a voice profile, so one tap here
                      // confirms every member and a wrongly merged block would fold
                      // a second person's voice into one centroid. The merge is
                      // display-only today; that is what would make it acoustically
                      // load-bearing.
                      onAttribute={(speakerId) =>
                        group.sessionIds.forEach((sessionId) => onAttribute(sessionId, speakerId))
                      }
                      onUnattribute={() =>
                        group.sessionIds.forEach((sessionId) => onUnattribute(sessionId))
                      }
                      onAddSpeaker={onAddSpeaker}
                    />
                  ) : (
                    <SpeakerLabel speaker={speaker} origin={origin} />
                  )
                ) : null}
                {showsSource ? (
                  <TranscriptSourceLine
                    text={groupSourceText(group, displays)}
                    raw={groupRawSourceText(group)}
                    repaired={groupIsRepaired(group, displays)}
                  />
                ) : null}
                {showsTarget ? (
                  <p className="text-target font-medium">{groupTargetText(group)}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {/* ONE live region, and it is rendered in EVERY state including the empty
          one. It used to be an `aria-live` on each unsettled `<li>`, which is a
          region that is created together with the content it should announce —
          and a live region that did not exist a moment before its content
          arrives announces nothing. That made the very first spoken sentence,
          the one most worth hearing, the one guaranteed to be silent.

          It sits outside the `<ol>` rather than inside it because a persistent
          wrapper inside an ordered list is not a list item, and the alternative —
          an always-present empty `<li>` — is a list entry announced as blank.

          In `split` there are two of these, one per pane, and that is correct:
          each announces the half its own pane shows, and a reader hearing both
          hears the sentence and then its translation. */}
      <div
        aria-live="polite"
        className={cn('flex flex-col gap-5', visibleLive.length > 0 ? 'pt-5 pb-4' : 'pb-4')}
      >
        {visibleLive.map((live) => (
          <div
            key={live.sessionId}
            className={cn('border-border border-dashed opacity-80', turnFrame)}
          >
            {showsSource && live.text ? (
              <p className="text-source text-prose italic">{live.text}</p>
            ) : null}
            {/* Only on turns long enough for the wait to be felt; short ones have
                their real translation before a guess would be read. */}
            {showsTarget && live.translation ? (
              <p className="text-muted-foreground text-target italic">{live.translation}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
