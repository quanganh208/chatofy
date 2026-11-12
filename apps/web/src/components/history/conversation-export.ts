import type { Translate } from '@chatofy/i18n';
import type { Conversation, MinutesContent } from '@chatofy/types';
import { minutesMarkdown } from '@/lib/minutes-markdown';
import { formatOffset } from '@/lib/transcript-time';
import { speakerName } from './conversation-formatting';
import {
  exportMetaLine,
  exportTitle,
  exportTurns,
  textLines,
  turnStart,
  turnText,
  turnTranslations,
} from './conversation-export-turns';

/**
 * A stored conversation as plain text and as Markdown (subtitles are in
 * `conversation-export-srt.ts`). Pure: a conversation, a translator and a locale
 * in, a string out.
 */

/** The `.txt` export, and also what Copy transcript puts on the clipboard. */
export function transcriptText(conversation: Conversation, t: Translate, locale: string): string {
  const lines = [exportTitle(conversation, t), exportMetaLine(conversation, t, locale), ''];
  for (const turn of exportTurns(conversation)) {
    const at = turnStart(turn, conversation);
    const speaker = speakerName(turn, t);
    lines.push(at === null ? speaker : `[${formatOffset(at)}] ${speaker}`);
    lines.push(...textLines(turnText(turn)));
    // Every line of a translation carries the arrow, so a multi-line one still
    // reads as one rendering rather than as a translation followed by source text.
    for (const translation of turnTranslations(turn, conversation.languages)) {
      lines.push(...textLines(translation).map((line) => `→ ${line}`));
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Text a reader typed or spoke, made inert in Markdown: inline emphasis, code and
 * link brackets are backslash-escaped, and so is a block marker that opens the
 * line — so a title "# Plan" or a turn "1. first" renders as written rather than
 * as a heading or a list.
 */
export function escapeMarkdown(line: string): string {
  return line
    .replace(/[\\`*_[\]]/g, '\\$&')
    .replace(/^(\s*)([#>+-])/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/, '$1\\$2');
}

/**
 * The `.md` export: the same transcript, plus the minutes when they are ready.
 *
 * Lines end in two spaces — Markdown's hard line break — wherever the next line
 * belongs to the same turn, so the speaker, the source and its continuation lines
 * stay on their own lines instead of joining into one paragraph. Every line of the
 * translations is quoted, so a multi-line one does not fall out of its quote.
 */
export function transcriptMarkdown(
  conversation: Conversation,
  t: Translate,
  locale: string,
  minutes: MinutesContent | null = null,
): string {
  const lines = [
    `# ${escapeMarkdown(exportTitle(conversation, t))}`,
    '',
    `_${exportMetaLine(conversation, t, locale)}_`,
    '',
    `## ${t('common.transcript')}`,
    '',
  ];
  for (const turn of exportTurns(conversation)) {
    const at = turnStart(turn, conversation);
    const speaker = escapeMarkdown(speakerName(turn, t));
    const source = textLines(turnText(turn)).map(escapeMarkdown);
    const quoted = turnTranslations(turn, conversation.languages)
      .flatMap(textLines)
      .map((line) => `> ${escapeMarkdown(line)}`);
    const block = [`**${at === null ? speaker : `${formatOffset(at)} · ${speaker}`}**`, ...source];
    lines.push(...block.map((line, index) => (index < block.length - 1 ? `${line}  ` : line)));
    lines.push(...quoted.map((line, index) => (index < quoted.length - 1 ? `${line}  ` : line)));
    lines.push('');
  }
  if (minutes?.status === 'ready') {
    lines.push(minutesMarkdown(minutes, t, { depth: 2, title: t('web.history.tabMinutes') }));
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
