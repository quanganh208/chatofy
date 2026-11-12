import type { Translate } from '@chatofy/i18n';
import {
  primaryTranslation,
  type Conversation,
  type ConversationTurn,
  type LanguageCode,
  type MinutesContent,
} from '@chatofy/types';
import { minutesMarkdown } from '@/lib/minutes-markdown';
import { formatOffset, mediaOffset } from '@/lib/transcript-time';
import { formatTimeRange, speakerName } from './conversation-formatting';

/**
 * A stored conversation as a file a reader takes away: plain text, Markdown, and
 * (in `conversation-export-srt.ts`) subtitles.
 *
 * Pure: a conversation, a translator and a locale in, a string out. Everything a
 * reader sees in the transcript is read through the same helpers the screen uses —
 * `speakerName` for who spoke, `mediaOffset` + `formatOffset` for when — so a line
 * marked `0:06` on screen is `0:06` in the file, and a turn the screen shows no time
 * for has none here either. Inventing `0:00` for it would be a time nobody measured.
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
 * Every translation a turn carries, the one the screen shows FIRST.
 *
 * The transcript shows one (`primaryTranslation`); a file has room for all of them,
 * which matters for a mixed turn translated into several languages. Empty
 * renderings are dropped, and so is a repeat of one already listed.
 */
export function turnTranslations(
  turn: Pick<ConversationTurn, 'sourceLanguages' | 'translations'>,
  languages: readonly LanguageCode[],
): string[] {
  const codes = [
    ...languages,
    ...(Object.keys(turn.translations) as LanguageCode[]).filter((c) => !languages.includes(c)),
  ];
  const all = [
    primaryTranslation(turn, languages),
    ...codes.map((c) => turn.translations[c] ?? ''),
  ];
  return [...new Set(all.map((text) => text.trim()).filter((text) => text !== ''))];
}

/** What the turn reads as on screen: the repaired rendering when there is one. */
export function turnText(turn: Pick<ConversationTurn, 'displayText' | 'sourceText'>): string {
  return turn.displayText ?? turn.sourceText;
}

/** Where a turn sits in the recording, or null when nothing was measured for it. */
export function turnStart(
  turn: Pick<ConversationTurn, 'offsetMs'>,
  conversation: Pick<Conversation, 'audioOffsetMs'>,
): number | null {
  return mediaOffset(turn.offsetMs, conversation.audioOffsetMs);
}

/** The `.txt` export, and also what Copy transcript puts on the clipboard. */
export function transcriptText(conversation: Conversation, t: Translate, locale: string): string {
  const lines = [exportTitle(conversation, t), exportMetaLine(conversation, t, locale), ''];
  for (const turn of conversation.turns) {
    const at = turnStart(turn, conversation);
    const speaker = speakerName(turn, t);
    lines.push(at === null ? speaker : `[${formatOffset(at)}] ${speaker}`);
    lines.push(turnText(turn));
    for (const translation of turnTranslations(turn, conversation.languages)) {
      lines.push(`→ ${translation}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * The `.md` export: the same transcript, plus the minutes when they are ready.
 *
 * The speaker line ends in two spaces — Markdown's hard line break — so the source
 * line renders under it instead of being joined onto it. A `>` line may interrupt
 * a paragraph, so each translation starts its quote without a blank line, and
 * several translations share one quote with the same hard break between them.
 */
export function transcriptMarkdown(
  conversation: Conversation,
  t: Translate,
  locale: string,
  minutes: MinutesContent | null = null,
): string {
  const lines = [
    `# ${exportTitle(conversation, t)}`,
    '',
    `_${exportMetaLine(conversation, t, locale)}_`,
    '',
    `## ${t('common.transcript')}`,
    '',
  ];
  for (const turn of conversation.turns) {
    const at = turnStart(turn, conversation);
    const speaker = speakerName(turn, t);
    lines.push(`**${at === null ? speaker : `${formatOffset(at)} · ${speaker}`}**  `);
    lines.push(turnText(turn));
    const translations = turnTranslations(turn, conversation.languages);
    translations.forEach((translation, index) => {
      lines.push(`> ${translation}${index < translations.length - 1 ? '  ' : ''}`);
    });
    lines.push('');
  }
  if (minutes?.status === 'ready') {
    lines.push(minutesMarkdown(minutes, t, { depth: 2, title: t('web.history.tabMinutes') }));
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
