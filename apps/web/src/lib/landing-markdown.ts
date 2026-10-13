import type { Translate } from '@chatofy/i18n';

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
export function landingMarkdown(t: Translate, origin: string): string {
  const url = (path: string) => new URL(path, origin).toString();

  const steps = (['One', 'Two', 'Three'] as const).map(
    (n, i) => `${i + 1}. **${t(`web.landing.how${n}Title`)}** — ${t(`web.landing.how${n}Body`)}`,
  );

  const hops = [
    [t('web.landing.hopOnDevice'), t('web.landing.hopHears')],
    [t('web.landing.hopOverNetwork'), t('web.landing.hopTranslates')],
    [t('web.landing.hopOnDevice'), t('web.landing.hopSpeaks')],
  ].map(([where, what]) => `- ${where}: ${what}`);

  const kept = (['History', 'Link', 'Pause', 'Delete'] as const).map(
    (k) => `- ${t(`web.landing.localKept${k}`)}`,
  );

  const surfaces = (['Browser', 'Extension', 'Phone'] as const).map(
    (s) => `- **${t(`web.landing.surface${s}Title`)}** — ${t(`web.landing.surface${s}Body`)}`,
  );

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
    `[${t('web.translate.startTranslating')}](${url('/translate')})`,
    '',
    `## ${t('web.landing.howTitle')}`,
    '',
    t('web.landing.howBody'),
    '',
    ...steps,
    '',
    `## ${t('web.landing.localTitle')}`,
    '',
    t('web.landing.localBody'),
    '',
    ...kept,
    '',
    ...hops,
    '',
    `## ${t('web.landing.surfacesTitle')}`,
    '',
    ...surfaces,
    '',
    `## ${t('web.landing.ctaTitle')}`,
    '',
    t('web.landing.ctaBody'),
    '',
    `[${t('web.translate.startTranslating')}](${url('/translate')})`,
    '',
  ].join('\n');
}

/**
 * `/llms.txt` in the llmstxt.org shape: name, one-line summary, then links to the
 * markdown twins. One page today, so one link. Low-cost hygiene, not a ranking lever.
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
