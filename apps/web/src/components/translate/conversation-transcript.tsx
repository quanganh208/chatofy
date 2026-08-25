'use client';

import type { LiveTurn } from '@chatofy/realtime-client';
import type { TranscriptSegment } from '@chatofy/types';
import { cn } from '@/lib/utils';

interface ConversationTranscriptProps {
  turns: TranscriptSegment[];
  /**
   * The turns being spoken right now, in the order they started.
   *
   * A list, not one line: capture does not stop while a turn is translated, so
   * someone can start a second sentence before the first is answered.
   */
  liveTurns: (LiveTurn & { sessionId: string })[];
  /** Whether a session is up, so the empty state can say the right thing. */
  running?: boolean;
  /**
   * How a turn is arranged. Defaults to `stacked` so any other caller is unaffected.
   */
  layout?: 'stacked' | 'columns';
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
 * turn rather than to a cell, so a two-column turn still carries exactly one.
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
 * grid that is one column until the breakpoint is neither.
 */
export function ConversationTranscript({
  turns,
  liveTurns,
  running,
  layout = 'stacked',
}: ConversationTranscriptProps) {
  if (turns.length === 0 && liveTurns.length === 0) {
    // An empty state that says what to do. Rendering nothing left the page
    // looking broken before the first turn, which is exactly when a new user is
    // deciding whether it works.
    return (
      <p className="text-prose border-hairline text-body rounded-lg border border-dashed px-6 py-10 text-center">
        {running
          ? 'Listening. The conversation will appear here as it is translated.'
          : 'Nothing yet — start a conversation and both sides appear here.'}
      </p>
    );
  }

  const columns = layout === 'columns';
  // `items-start` on purpose: a long Vietnamese source beside a short English
  // translation is ragged, and the alternative — equalising the two — can only be
  // done by truncating, which loses the thing someone is reading.
  const turnLayout = columns
    ? 'grid grid-cols-1 items-start gap-x-6 gap-y-1.5 sm:grid-cols-2'
    : 'flex flex-col gap-1.5';

  return (
    <ol className="flex flex-col gap-6">
      {turns.map((turn) => (
        <li key={turn.id} className={cn('border-primary border-l-2 pl-4', turnLayout)}>
          <p className="text-prose text-body">{turn.sourceText}</p>
          <p className="text-translation font-medium">{turn.targetText}</p>
        </li>
      ))}

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
