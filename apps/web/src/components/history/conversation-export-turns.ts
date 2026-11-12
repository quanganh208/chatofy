import type { Translate } from '@chatofy/i18n';
import {
  primaryTranslation,
  type Conversation,
  type ConversationTurn,
  type LanguageCode,
} from '@chatofy/types';
import { mediaOffset } from '@/lib/transcript-time';
import { formatTimeRange } from './conversation-formatting';

/**
 * What every export format reads off a stored conversation, through the same
 * helpers the screen uses — so a line the transcript marks `0:06` is `0:06` in the
 * file, a turn the screen shows no time for has none, and a translation the screen
 * would not show is not in the file either.
 */

/** The fallback the header uses for a conversation that was never titled. */
export function exportTitle(conversation: Pick<Conversation, 'title'>, t: Translate): string {
  return conversation.title ?? t('web.history.untitled');
}

/**
 * "Vietnamese ⇆ English", "Auto-detect → English": the pair the meta line draws
 * with an icon, written with the matching arrow character, because a file has no
 * icons and no screen reader to speak a hidden word in its place.
 */
export function languagePairText(
  conversation: Pick<Conversation, 'kind' | 'languages'>,
  t: Translate,
): string {
  const name = (code: LanguageCode) => t(`common.languageName.${code}`);
  const [first, second] = conversation.languages as [LanguageCode, LanguageCode];
  if (conversation.kind === 'auto-detect') return `${t('web.history.autoDetect')} → ${name(first)}`;
  const arrow = conversation.kind === 'two-way' ? '⇆' : '→';
  return `${name(first)} ${arrow} ${name(second)}`;
}

/** "Nov 12, 2026 · 7:58 AM–8:00 AM · Vietnamese ⇆ English", the file's subtitle. */
export function exportMetaLine(conversation: Conversation, t: Translate, locale: string): string {
  const date = new Date(conversation.startedAt).toLocaleDateString(locale, { dateStyle: 'medium' });
  return [date, formatTimeRange(conversation, locale, t), languagePairText(conversation, t)].join(
    ' · ',
  );
}

/**
 * The turn's translations, the one the screen shows FIRST.
 *
 * A file has room for more than the screen's one — a mixed turn can be rendered
 * into several languages — but not for an ECHO: a rendering into a language the
 * turn was itself spoken in repeats the source line back. The screen's own pick
 * (`primaryTranslation`) is always kept, even when it is such a rendering, because
 * that is what the reader saw. Empty and repeated renderings are dropped.
 */
export function turnTranslations(
  turn: Pick<ConversationTurn, 'sourceLanguages' | 'translations'>,
  languages: readonly LanguageCode[],
): string[] {
  const codes = [
    ...languages,
    ...(Object.keys(turn.translations) as LanguageCode[]).filter((c) => !languages.includes(c)),
  ].filter((code) => !turn.sourceLanguages.includes(code));
  const all = [
    primaryTranslation(turn, languages),
    ...codes.map((code) => turn.translations[code] ?? ''),
  ];
  return [...new Set(all.map((text) => text.trim()).filter((text) => text !== ''))];
}

/** What the turn reads as on screen: the repaired rendering when there is one. */
export function turnText(turn: Pick<ConversationTurn, 'displayText' | 'sourceText'>): string {
  return (turn.displayText ?? turn.sourceText).trim();
}

/**
 * The turns a file carries: every one with something to read. A turn whose source
 * and translations are all empty would print a speaker over nothing — and in SRT,
 * a cue with no text, which strict parsers reject.
 */
export function exportTurns(conversation: Pick<Conversation, 'turns' | 'languages'>) {
  return conversation.turns.filter(
    (turn) => turnText(turn) !== '' || turnTranslations(turn, conversation.languages).length > 0,
  );
}

/** Where a turn sits in the recording, or null when nothing was measured for it. */
export function turnStart(
  turn: Pick<ConversationTurn, 'offsetMs'>,
  conversation: Pick<Conversation, 'audioOffsetMs'>,
): number | null {
  return mediaOffset(turn.offsetMs, conversation.audioOffsetMs);
}

/**
 * A text as its non-blank lines. A blank line inside a turn would read as the end
 * of the turn in `.txt`, end a quote in Markdown and end a cue in SRT.
 */
export function textLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
