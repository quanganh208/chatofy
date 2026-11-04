'use client';

import type { ReactNode } from 'react';
import { ArrowLeftRight, ArrowRight, AudioLines } from 'lucide-react';
import type { ConversationSummary, LanguageCode } from '@chatofy/types';
import type { Translate } from '@chatofy/i18n';
import { useLocale, useTranslate } from '@/i18n/provider';
import { durationMinutes, formatTimeRange } from './conversation-formatting';
import { turnCountLabel } from './turn-count-label';

interface ConversationMetaLineProps {
  conversation: ConversationSummary;
  /**
   * Print "09:12–09:40". The list leaves it off: its rows already show the start
   * in their own column, and the end is the duration's job there.
   */
  showTimeRange?: boolean;
  /** A fact printed before the kind, on the same line — the detail page's date. */
  leading?: ReactNode;
}

/**
 * Everything a stored conversation is, besides what it was about — one muted
 * line shared by the history row and the detail header, so the two cannot drift
 * into naming the same fact two ways.
 *
 * The kind leads, in full words: "Two-way · Vietnamese [⇄] English". It replaced
 * a bold "VI → EN", which was the loudest thing on a row whose subject is the
 * title, and said less — it could not tell two-way from one-way at all.
 */
export function ConversationMetaLine({
  conversation,
  showTimeRange,
  leading,
}: ConversationMetaLineProps) {
  const t = useTranslate();
  const locale = useLocale();

  const parts = [
    leading ? <span key="leading">{leading}</span> : null,
    <span key="kind" className="text-foreground font-medium">
      <KindLabel conversation={conversation} />
    </span>,
    showTimeRange ? (
      <span key="time" className="tabular-nums">
        {formatTimeRange(conversation, locale, t)}
      </span>
    ) : null,
    <span key="duration">
      {t('web.history.duration', { minutes: durationMinutes(conversation) })}
    </span>,
    <span key="turns">{turnCountLabel(t, conversation.turnCount)}</span>,
    conversation.speakerCount > 0 ? (
      <span key="speakers">{speakersLabel(t, conversation)}</span>
    ) : null,
    conversation.hasRecording ? (
      <span key="recording" className="inline-flex items-center gap-1">
        <AudioLines aria-hidden className="size-3.5" />
        {t('web.history.recording')}
      </span>
    ) : null,
  ].filter((part) => part !== null);

  return (
    <p className="text-hint text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {/* Each separator travels WITH the fact after it, so a wrap never leaves
          a dot hanging alone at the end of a line on a phone. */}
      {parts.map((part, index) =>
        index === 0 ? (
          part
        ) : (
          <span key={part.key} className="inline-flex items-center gap-x-1.5">
            <Dot />
            {part}
          </span>
        ),
      )}
    </p>
  );
}

/**
 * "Two-way · Vietnamese [⇄] English", "One-way · Auto-detect [→] English" — the
 * direction is an ICON, not an arrow character: a text arrow renders in
 * whatever glyph the font has and reads as typography rather than as the
 * sidebar's own two-way mark. The icon is hidden from screen readers, so the
 * direction is spoken as a word ("to", "and") they read instead.
 */
function KindLabel({
  conversation,
}: {
  conversation: Pick<ConversationSummary, 'kind' | 'languages'>;
}) {
  const t = useTranslate();
  const name = (code: LanguageCode) => t(`common.languageName.${code}`);
  // `conversationLanguagesSchema` guarantees at least two.
  const [first, second] = conversation.languages as [LanguageCode, LanguageCode];
  const twoWay = conversation.kind === 'two-way';
  // Auto-detected conversations store the TARGET first, then every language
  // that may have been heard — so the destination is `first`, and the source is
  // named as the act of detecting rather than as one of the candidates.
  const [from, to] =
    conversation.kind === 'auto-detect'
      ? [t('web.history.autoDetect'), name(first)]
      : [name(first), name(second)];
  const Direction = twoWay ? ArrowLeftRight : ArrowRight;

  return (
    <span className="inline-flex items-center gap-1">
      {/* The spaces are for screen readers, which skip the dot and the icon;
          a flex row drops whitespace-only text from the layout. */}
      {twoWay ? t('web.history.kindTwoWay') : t('web.history.kindOneWay')} <Dot /> {from}
      <Direction aria-hidden className="size-3.5 shrink-0" strokeWidth={2} />
      <span className="sr-only">
        {` ${twoWay ? t('web.history.pairAndSpoken') : t('web.history.pairToSpoken')} `}
      </span>
      {to}
    </span>
  );
}

/** "2 speakers: Lan, John", or the count alone when nobody was named. */
function speakersLabel(
  t: Translate,
  conversation: Pick<ConversationSummary, 'speakerCount' | 'speakers'>,
): string {
  const { speakerCount: count, speakers } = conversation;
  if (speakers.length === 0) {
    return count === 1
      ? t('web.history.speakerCountOne')
      : t('web.history.speakerCount', { count });
  }
  const names = speakers.join(', ');
  return count === 1
    ? t('web.history.speakersNamedOne', { names })
    : t('web.history.speakersNamed', { count, names });
}

export function Dot() {
  return (
    <span aria-hidden className="text-border-strong">
      ·
    </span>
  );
}
