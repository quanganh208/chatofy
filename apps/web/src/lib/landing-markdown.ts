import type { Locale, Translate } from '@chatofy/i18n';
import type { Plan } from '@chatofy/types';
import { landingFaq } from './landing-faq';
import { pricingContent } from './pricing-content';

/**
 * The landing page as markdown, for agents and answer engines that read `/index.md`.
 *
 * Built from the same dictionary keys the page renders, in the same order, so the
 * twin cannot say something the page does not — a twin whose facts drift from the
 * HTML is the failure this shape exists to prevent. When a landing section is added
 * or a key renamed, this is the second reader of it, and `landing-markdown.spec.ts`
 * fails until it is updated.
 *
 * Absolute URLs throughout: an agent handed this file has no page to resolve a
 * relative link against.
 */
export function landingMarkdown(
  t: Translate,
  origin: string,
  locale: Locale,
  plans: Plan[] | null,
): string {
  const url = (path: string) => new URL(path, origin).toString();
  const item = (title: string, body: string) => `- **${title}** — ${body}`;

  const meetings = (['Link', 'Hear', 'Chat', 'Minutes'] as const).map((m) =>
    item(t(`web.landing.meetings${m}Title`), t(`web.landing.meetings${m}Body`)),
  );

  const modes = (['OneWay', 'TwoWay', 'History', 'Glossary'] as const).map((m) =>
    item(t(`web.landing.mode${m}Title`), t(`web.landing.mode${m}Body`)),
  );

  const steps = (['One', 'Two', 'Three'] as const).map(
    (n, i) => `${i + 1}. **${t(`web.landing.how${n}Title`)}** — ${t(`web.landing.how${n}Body`)}`,
  );

  const useCases = (['Travel', 'Family', 'Partners', 'Study'] as const).map((u) =>
    item(t(`web.landing.use${u}Title`), t(`web.landing.use${u}Body`)),
  );

  const kept = (['History', 'Link', 'Pause', 'Delete', 'Meeting'] as const).map(
    (k) => `- ${t(`web.landing.localKept${k}`)}`,
  );

  const surfaces = (['Browser', 'Extension', 'Phone'] as const).map((s) =>
    item(
      `${t(`web.landing.surface${s}Title`)} (${t(`web.landing.surfaceStatus${s}`)})`,
      t(`web.landing.surface${s}Body`),
    ),
  );

  // The Free allowance, from the same plan rows the page reads; absent when they are.
  const free = pricingContent(t, locale, plans).bands.find((band) => band.id === 'free');

  const faq = landingFaq(t).flatMap((entry) => [`### ${entry.question}`, '', entry.answer, '']);

  return [
    `# ${t('web.meta.home')}`,
    '',
    `> ${t('web.meta.homeDescription')}`,
    '',
    `Canonical: ${url('/')}`,
    '',
    `## ${t('web.landing.heroTitle')}`,
    '',
    t('web.landing.heroBody'),
    '',
    `[${t('web.translate.startTranslating')}](${url('/translate/one-way')})`,
    `[${t('web.landing.meetingsStart')}](${url('/conference')})`,
    '',
    `## ${t('web.landing.modesTitle')}`,
    '',
    t('web.landing.modesBody'),
    '',
    `### ${t('web.landing.meetingsTitle')}`,
    '',
    t('web.landing.meetingsBody'),
    '',
    ...meetings,
    '',
    t('web.landing.meetingsScope'),
    '',
    ...modes,
    '',
    `## ${t('web.landing.howTitle')}`,
    '',
    t('web.landing.howBody'),
    '',
    ...steps,
    '',
    `## ${t('web.landing.useCasesTitle')}`,
    '',
    t('web.landing.useCasesBody'),
    '',
    ...useCases,
    '',
    `## ${t('web.landing.localTitle')}`,
    '',
    t('web.landing.localBody'),
    '',
    ...kept,
    '',
    `## ${t('web.landing.surfacesTitle')}`,
    '',
    ...surfaces,
    '',
    `## ${t('web.landing.pricingTitle')}`,
    '',
    t('web.landing.pricingBody'),
    '',
    ...(free?.summary ? [`**${free.title}** — ${free.summary}`, ''] : []),
    t('web.pricing.notOpen'),
    '',
    `[${t('web.landing.pricingLink')}](${url('/pricing.md')})`,
    '',
    `## ${t('web.landing.faqTitle')}`,
    '',
    ...faq,
    `## ${t('web.landing.ctaTitle')}`,
    '',
    t('web.landing.ctaBody'),
    '',
    `[${t('web.translate.startTranslating')}](${url('/translate/one-way')})`,
    '',
  ].join('\n');
}

/**
 * `/llms.txt` in the llmstxt.org shape: name, one-line summary, links to the markdown
 * twins (the landing page and `/pricing`), then the landing's sections by anchor, each
 * with the line the page itself opens it with. Low-cost hygiene, not a ranking lever.
 *
 * The `## Pages` and `## Sections` headings stay English in every locale on purpose:
 * they are the file's structure, read by tools that parse llmstxt.org files, not copy.
 * The entries under them are in the reader's locale.
 */
export function llmsTxt(t: Translate, origin: string): string {
  const url = (path: string) => new URL(path, origin).toString();
  return [
    '# Chatofy',
    '',
    `> ${t('web.meta.homeDescription')}`,
    '',
    t('web.landing.heroTitle'),
    '',
    '## Pages',
    '',
    `- [${t('web.meta.home')}](${url('/index.md')}): ${t('web.landing.heroBody')}`,
    `- [${t('web.meta.pricing')}](${url('/pricing.md')}): ${t('web.meta.pricingDescription')}`,
    '',
    '## Sections',
    '',
    `- [${t('web.landing.modesTitle')}](${url('/#modes')}): ${t('web.landing.modesBody')}`,
    `- [${t('web.landing.howTitle')}](${url('/#how-it-works')}): ${t('web.landing.howBody')}`,
    `- [${t('web.landing.useCasesTitle')}](${url('/#use-cases')}): ${t('web.landing.useCasesBody')}`,
    `- [${t('web.landing.localTitle')}](${url('/#privacy')}): ${t('web.landing.localBody')}`,
    `- [${t('web.landing.surfacesTitle')}](${url('/#where-it-runs')}): ${(
      ['Browser', 'Extension', 'Phone'] as const
    )
      .map((s) => `${t(`web.landing.surface${s}Title`)} (${t(`web.landing.surfaceStatus${s}`)})`)
      .join('; ')}`,
    `- [${t('web.landing.pricingTitle')}](${url('/#pricing')}): ${t('web.landing.pricingBody')}`,
    `- [${t('web.landing.faqTitle')}](${url('/#faq')}): ${landingFaq(t)
      .map((entry) => entry.question)
      .join(' ')}`,
    '',
  ].join('\n');
}

/**
 * Headers for every machine-readable twin. `noindex` so the twin never competes with
 * the HTML page in search results while staying crawlable; `Vary: Cookie` because the
 * locale comes from the cookie, exactly as it does for the page.
 */
export function machineReadableHeaders(contentType: string): HeadersInit {
  return {
    'Content-Type': `${contentType}; charset=utf-8`,
    'X-Robots-Tag': 'noindex',
    Vary: 'Cookie, Accept-Language',
  };
}
