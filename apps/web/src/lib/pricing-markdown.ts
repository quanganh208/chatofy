import type { PricingContent } from './pricing-content';

/**
 * `/pricing` as markdown, for agents and answer engines that read `/pricing.md`.
 *
 * Built from the same `PricingContent` the page renders, in the same order, so the twin
 * cannot quote a price the page does not. The not-open notice sits directly under the
 * title here too: a twin read without the page must not read as a sale offer.
 *
 * Absolute URLs throughout, as in `/index.md`: an agent handed this file has no page to
 * resolve a relative link against.
 */
export function pricingMarkdown(
  content: PricingContent,
  meta: { title: string; description: string },
  origin: string,
): string {
  const url = (path: string) => new URL(path, origin).toString();

  const bands = content.bands.flatMap((band) => [
    `## ${band.title}`,
    '',
    ...(band.summary ? [band.summary, ''] : []),
    ...(band.lines.length > 0 ? [...band.lines.map((line) => `- ${line}`), ''] : []),
  ]);

  return [
    `# ${meta.title}`,
    '',
    `> ${meta.description}`,
    '',
    `Canonical: ${url('/pricing')}`,
    '',
    `## ${content.title}`,
    '',
    `**${content.notOpen}**`,
    '',
    content.intro,
    '',
    `[${content.startFree}](${url('/register')})`,
    '',
    ...(content.unavailable ? [content.unavailable, ''] : []),
    ...bands,
    ...content.footnotes.flatMap((note) => [note, '']),
  ].join('\n');
}
