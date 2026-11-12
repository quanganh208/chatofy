import type { Translate } from '@chatofy/i18n';
import type { MinutesContent } from '@chatofy/types';

/**
 * Meeting minutes as plain Markdown, in the reader's language.
 *
 * One rendering for both places minutes leave the screen as text: the minutes
 * panel's Copy, which puts them on the clipboard on their own, and a conversation's
 * `.md` download, which appends them under its transcript. Two copies of this
 * would drift the first time a section is added to the minutes.
 *
 * `depth` is the heading level of the minutes' own title. Standalone (`1`) it is
 * the document's `#` heading and the summary follows it unlabelled, as the panel
 * always copied it. Nested (`2`) it sits under a transcript's `#` title, every
 * section moves down a level, and the summary gets its own heading — beside a
 * transcript, an unlabelled paragraph under "Minutes" is not obviously a summary.
 */
export function minutesMarkdown(
  minutes: MinutesContent,
  t: Translate,
  options: { depth?: 1 | 2; title?: string } = {},
): string {
  const depth = options.depth ?? 1;
  const title = '#'.repeat(depth);
  const section = '#'.repeat(depth + 1);
  const lines: string[] = [`${title} ${options.title ?? t('common.minutes.title')}`, ''];
  if (depth > 1) lines.push(`${section} ${t('common.minutes.summary')}`);
  lines.push(minutes.summary, '');
  if (minutes.keyPoints.length) {
    lines.push(`${section} ${t('common.minutes.keyPoints')}`);
    for (const point of minutes.keyPoints) lines.push(`- ${point}`);
    lines.push('');
  }
  if (minutes.decisions.length) {
    lines.push(`${section} ${t('common.minutes.decisions')}`);
    for (const decision of minutes.decisions) lines.push(`- ${decision}`);
    lines.push('');
  }
  lines.push(`${section} ${t('common.minutes.actionItems')}`);
  if (minutes.actionItems.length === 0) {
    lines.push(t('common.minutes.noActionItems'));
  } else {
    for (const item of minutes.actionItems) {
      const suffix = [
        item.owner ? `${t('common.minutes.owner')}: ${item.owner}` : null,
        item.dueDate ? `${t('common.minutes.due')}: ${item.dueDate}` : null,
      ].filter(Boolean);
      lines.push(`- ${item.description}${suffix.length ? ` (${suffix.join(', ')})` : ''}`);
    }
  }
  return lines.join('\n');
}
