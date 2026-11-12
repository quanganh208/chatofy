'use client';

import { primaryTranslation, type ConversationTurn, type LanguageCode } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';
import { formatOffset, isoDuration, mediaOffset } from '@/lib/transcript-time';
import { speakerName } from './conversation-formatting';

interface HistoryTranscriptProps {
  turns: ConversationTurn[];
  /**
   * The conversation's declared languages, source first — what
   * {@link primaryTranslation} resolves each turn's single legacy translation
   * from, the same way `PrismaConversationStore` resolves it server-side.
   */
  languages: readonly LanguageCode[];
  /**
   * Where the recording began, relative to the conversation — see
   * `mediaOffset`. Null when there is no recording. The gutter still renders in
   * that case: `mediaOffset` treats a null offset as zero rather than as "no
   * time", so a row from before this feature or one with no upload still gets a
   * timestamp — only `onSeek` being absent is what turns it into plain text.
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
 * On the page ground, not in a card: it is the reading pane's whole content, and a
 * card around the only thing on a surface is a frame with nothing to separate. Each
 * block's text column stops at 68ch, so a wide pane still reads at a prose measure.
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
export function HistoryTranscript({
  turns,
  languages,
  audioOffsetMs = null,
  onSeek,
}: HistoryTranscriptProps) {
  const t = useTranslate();

  return (
    <ul className="flex flex-col gap-4">
      {turns.map((turn) => {
        const at = mediaOffset(turn.offsetMs, audioOffsetMs);
        const stamp =
          at === null ? null : onSeek ? (
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
          );
        return (
          <li key={turn.position} className="relative flex gap-3">
            {/* The gutter. Fixed width so every line of the transcript starts
                at the same x — a column that resized per row would make the
                left rule ragged, which is the one thing it exists to keep
                straight. A row with no time renders an empty cell rather than
                collapsing, for the same reason.

                Wide enough for `formatOffset`'s longer form: past an hour it
                prints `h:mm:ss`, not `m:ss`, and a column sized only for the
                short form would wrap it.

                `text-right` so the digits sit against the rule they belong to,
                and `tabular-nums` so 1:09 and 1:10 do not shift the column. */}
            <div className="absolute top-0 right-0 flex sm:static sm:block sm:w-16 sm:shrink-0 sm:pt-0.5 sm:text-right">
              {stamp}
            </div>
            {/* The block, unchanged: the left rule and the larger translation
                are what `conversation-transcript.tsx` established and what
                makes reading a stored conversation the same act as reading a
                live one. */}
            <div className="border-primary flex max-w-[68ch] min-w-0 flex-1 flex-col gap-1 border-l-2 pl-3 sm:pl-4">
              {/* Below `sm` the gutter is lifted out of the row and pinned to the
                  top right, on this label's line; the padding keeps a long label
                  from running under it. A 64px gutter plus the rule left a 180px
                  column at 375px — two or three words a line on a long turn. One
                  element in both layouts, so it is focused and announced once. */}
              <p
                data-slot="speaker-label"
                className="text-hint text-muted-foreground wrap-anywhere font-semibold max-sm:pr-14"
              >
                {speakerName(turn, t)}
              </p>
              <p className="text-prose text-body wrap-anywhere">
                {turn.displayText ?? turn.sourceText}
              </p>
              <p className="text-translation font-medium wrap-anywhere">
                {primaryTranslation(turn, languages)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
