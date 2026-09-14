'use client';

import type { ConversationTurn } from '@chatofy/types';
import { Card, CardContent } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { formatOffset, mediaOffset } from './conversation-formatting';

interface HistoryTranscriptProps {
  turns: ConversationTurn[];
  /**
   * Where the recording began, relative to the conversation — see
   * `mediaOffset`. Null when there is no recording, which is also what makes the
   * gutter silent.
   */
  audioOffsetMs?: number | null;
  /**
   * Jump the player to a moment. Absent when there is nothing to jump — an old
   * conversation, a failed upload — and the gutter is then plain text rather than
   * a button that would do nothing.
   */
  onSeek?: (ms: number) => void;
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
export function HistoryTranscript({ turns, audioOffsetMs = null, onSeek }: HistoryTranscriptProps) {
  const t = useTranslate();

  return (
    <Card>
      <CardContent>
        <ul className="flex flex-col gap-4">
          {turns.map((turn) => {
            const at = mediaOffset(turn.offsetMs, audioOffsetMs);
            return (
              <li key={turn.position} className="flex gap-3">
                {/* The gutter. Fixed width so every line of the transcript starts
                    at the same x — a column that resized per row would make the
                    left rule ragged, which is the one thing it exists to keep
                    straight. A row with no time renders an empty cell rather than
                    collapsing, for the same reason.

                    `text-right` so the digits sit against the rule they belong to,
                    and `tabular-nums` so 1:09 and 1:10 do not shift the column. */}
                <div className="w-12 shrink-0 pt-0.5 text-right">
                  {at === null ? null : onSeek ? (
                    <button
                      type="button"
                      onClick={() => onSeek(at)}
                      className="text-label text-muted-foreground hover:text-foreground tabular-nums"
                      aria-label={t('web.history.playFrom', { time: formatOffset(at) })}
                    >
                      <time dateTime={isoDuration(at)}>{formatOffset(at)}</time>
                    </button>
                  ) : (
                    <span className="text-label text-muted-foreground tabular-nums">
                      <time dateTime={isoDuration(at)}>{formatOffset(at)}</time>
                    </span>
                  )}
                </div>
                {/* The block, unchanged: the left rule and the larger translation
                    are what `conversation-transcript.tsx` established and what
                    makes reading a stored conversation the same act as reading a
                    live one. */}
                <div className="border-primary flex min-w-0 flex-col gap-1 border-l-2 pl-4">
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
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * `PT1M12S` — the machine-readable half of `<time>`.
 *
 * A screen reader announces the visible `1:12` either way; this is what makes the
 * element a real duration rather than a styled span, so the markup says what the
 * number means without a second visible string to translate.
 */
function isoDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `PT${Math.floor(total / 60)}M${total % 60}S`;
}
