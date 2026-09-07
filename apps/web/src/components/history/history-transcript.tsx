'use client';

import type { ConversationTurn } from '@chatofy/types';
import { Card, CardContent } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

interface HistoryTranscriptProps {
  turns: ConversationTurn[];
}

/**
 * A stored conversation, read back exactly as it was on screen.
 *
 * Trivial on purpose, and that is the payoff of grouping at SAVE time: a stored
 * row is already one displayed block carrying the repaired text, so rendering is
 * `displayText ?? sourceText` and nothing else.
 *
 * Deliberately NOT `ConversationTranscript`. That component needs
 * `onAttribute`, `onUnattribute`, `onAddSpeaker`, `attributions`, `liveTurns`,
 * `captures` and `displays` — machinery for making a LIVE conversation editable —
 * and it would re-run the grouping that was already applied before the write.
 * Reusing it would mean inventing empty versions of six props to render
 * something that cannot change.
 *
 * **A turn is marked by a left rule, and the translation is the larger line.**
 * Both come from `conversation-transcript.tsx`, which records why: twelve
 * identical bordered boxes have no rhythm, and the translation is the thing
 * being read, so the eye should not have to be told which line to look at once
 * per turn. Reading a conversation back is the same act as reading it live, and
 * a stored turn that were set differently would say the two are different
 * products.
 */
export function HistoryTranscript({ turns }: HistoryTranscriptProps) {
  const t = useTranslate();

  return (
    <Card>
      <CardContent>
        <ul className="flex flex-col gap-4">
          {turns.map((turn) => (
            <li key={turn.position} className="border-primary flex flex-col gap-1 border-l-2 pl-4">
              <p className="text-label text-muted-foreground uppercase">
                {/* The label the reader confirmed, or a fallback composed HERE from
                    the role and the dictionary. Storing the fallback would have put
                    an English name permanently into a Vietnamese reader's rows. */}
                {turn.speakerLabel ??
                  t(
                    turn.speakerRole === 'speaker_a'
                      ? 'web.history.speakerA'
                      : 'web.history.speakerB',
                  )}
              </p>
              <p className="text-prose text-body">{turn.displayText ?? turn.sourceText}</p>
              <p className="text-translation font-medium">{turn.targetText}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
