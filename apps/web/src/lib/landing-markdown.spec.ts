import { createTranslator, en, vi, type Messages } from '@chatofy/i18n';
import { describe, expect, it } from 'vitest';
import { landingMarkdown, llmsTxt } from './landing-markdown';

/**
 * The markdown twin must say what the landing page says, in every locale.
 *
 * It walks every `web.landing.*` key rather than a hand-kept list, so a section
 * added to the page fails here until the twin carries it too — a twin that quietly
 * lags the HTML is the drift this exists to stop.
 *
 * Exempt, with reasons: the nav labels and the menu title are chrome, not content;
 * the italic phrase is a substring of the headline; and the demo card is an
 * illustration of the product, not a claim about it.
 */
const NOT_CONTENT = new Set<keyof Messages>([
  'web.landing.navMenu',
  'web.landing.navMeetings',
  'web.landing.navHow',
  'web.landing.navLocal',
  'web.landing.navSurfaces',
  'web.landing.heroTitleEmphasis',
  'web.landing.demoListening',
  'web.landing.demoSourceOne',
  'web.landing.demoTargetOne',
  'web.landing.demoSourceTwo',
  'web.landing.demoTargetTwo',
]);

const ORIGIN = 'https://chatofy.example';

describe.each([
  ['en', en],
  ['vi', vi],
] as const)('the landing markdown (%s)', (_, messages) => {
  const markdown = landingMarkdown(createTranslator(messages), ORIGIN);

  it('opens with the page title and the canonical URL', () => {
    expect(markdown.startsWith(`# ${messages['web.meta.home']}\n`)).toBe(true);
    expect(markdown).toContain(`Canonical: ${ORIGIN}/`);
  });

  it('carries every landing string the page renders', () => {
    const missing = (Object.keys(messages) as (keyof Messages)[])
      .filter((key) => key.startsWith('web.landing.') && !NOT_CONTENT.has(key))
      .filter((key) => !markdown.includes(messages[key]));
    expect(missing).toEqual([]);
  });

  it('offers both halves of the product, as the hero does', () => {
    expect(markdown).toContain(`](${ORIGIN}/translate)`);
    expect(markdown).toContain(`](${ORIGIN}/conference)`);
    expect(markdown).toContain(`## ${messages['web.landing.meetingsTitle']}`);
  });

  it('links absolutely, so an agent can follow it without the page', () => {
    for (const [, href] of markdown.matchAll(/\]\(([^)]+)\)/g)) {
      expect(href).toMatch(/^https:\/\//);
    }
  });
});

describe('llms.txt', () => {
  const text = llmsTxt(createTranslator(en), ORIGIN);

  it('has the llmstxt.org shape and points at the absolute twin', () => {
    expect(text.startsWith('# Chatofy\n\n> ')).toBe(true);
    expect(text).toContain('## Pages');
    expect(text).toContain(`](${ORIGIN}/index.md)`);
  });
});
