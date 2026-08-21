'use client';

import type { LiveTurn } from '@chatofy/realtime-client';
import type { TranscriptSegment } from '@chatofy/types';

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
}

/**
 * Finished turns, newest last, so the exchange reads top to bottom like a chat,
 * with the sentence currently being spoken at the bottom.
 *
 * Both sides of every turn are shown: the speaker needs to see what was heard
 * to catch a misrecognition, and the listener reads the translation while it is
 * being spoken. The translation is set larger than the source, because it is the
 * thing being read — when both were the same size the eye had to be told which
 * line to look at, every turn.
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
 */
export function ConversationTranscript({ turns, liveTurns, running }: ConversationTranscriptProps) {
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

  return (
    <ol className="flex flex-col gap-6">
      {turns.map((turn) => (
        <li key={turn.id} className="border-primary flex flex-col gap-1.5 border-l-2 pl-4">
          <p className="text-prose text-body">{turn.sourceText}</p>
          <p className="text-translation font-medium">{turn.targetText}</p>
        </li>
      ))}

      {liveTurns.map((live) => (
        <li
          key={live.sessionId}
          className="border-border flex flex-col gap-1.5 border-l-2 border-dashed pl-4 opacity-80"
          aria-live="polite"
        >
          <p className="text-prose text-body italic">{live.text}</p>
          {/* Only on turns long enough for the wait to be felt; short ones
              have their real translation before a guess would be read. */}
          {live.translation ? (
            <p className="text-muted-foreground text-translation italic">{live.translation}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
