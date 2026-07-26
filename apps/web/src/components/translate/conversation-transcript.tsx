'use client';

import type { TranscriptSegment } from '@chatofy/types';
import { Card, CardContent } from '@/components/ui/card';

interface ConversationTranscriptProps {
  turns: TranscriptSegment[];
  /** What is being said right now; empty between turns. */
  liveText: string;
  /** A translation of the unfinished sentence; empty unless the turn runs long. */
  liveTranslation: string;
}

/**
 * Finished turns, newest last, so the exchange reads top to bottom like a chat,
 * with the sentence currently being spoken at the bottom.
 *
 * Both sides of every turn are shown: the speaker needs to see what was heard
 * to catch a misrecognition, and the listener reads the translation while it is
 * being spoken.
 *
 * The live line is what stops the screen going dead while someone talks — the
 * wait for a translation is the same length either way, but a still page makes
 * it feel like nothing is happening. It is styled as unfinished, because it is:
 * the recogniser revises words as it hears more, and a line that looks settled
 * and then changes reads as a mistake rather than as progress.
 */
export function ConversationTranscript({
  turns,
  liveText,
  liveTranslation,
}: ConversationTranscriptProps) {
  if (turns.length === 0 && !liveText) return null;

  return (
    <div className="flex flex-col gap-3">
      {turns.map((turn) => (
        <Card key={turn.id}>
          <CardContent className="flex flex-col gap-1 py-4">
            <p className="text-sm text-[var(--color-muted-foreground)]">{turn.sourceText}</p>
            <p className="text-lg">{turn.targetText}</p>
          </CardContent>
        </Card>
      ))}

      {liveText ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col gap-1 py-4">
            <p className="text-sm text-[var(--color-muted-foreground)] italic" aria-live="polite">
              {liveText}
            </p>
            {/* Only on turns long enough for the wait to be felt; short ones
                have their real translation before a guess would be read. */}
            {liveTranslation ? (
              <p className="text-lg text-[var(--color-muted-foreground)] italic" aria-live="polite">
                {liveTranslation}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
