import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SEEDED_PLANS } from '@/lib/seeded-plans.fixture';

/**
 * Prices in markup only where the page shows prices.
 *
 * The landing page shows none, so its JSON-LD carries no `offers`; `/pricing` shows
 * every plan's price and carries one `Offer` per price. Markup that disagrees with
 * visible content is worse than none, and the landing case is the one that would go
 * wrong silently — nothing renders differently in a browser.
 */

vi.mock('@/config/server-env', () => ({ serverEnv: { WEB_BASE_URL: 'https://chatofy.example' } }));
vi.mock('@/i18n/server', async () => {
  const { createTranslator, en } = await import('@chatofy/i18n');
  return {
    getT: () => Promise.resolve(createTranslator(en)),
    getLocale: () => Promise.resolve('en'),
  };
});

const { StructuredData } = await import('./structured-data');
const { en } = await import('@chatofy/i18n');
const { LANDING_FAQ } = await import('@/lib/landing-faq');

type Node = {
  '@type': string;
  offers?: { price: string; priceCurrency: string }[];
  mainEntity?: { name: string; acceptedAnswer: { text: string } }[];
};

async function graphOf(element: Promise<React.ReactElement>): Promise<Node[]> {
  const html = renderToStaticMarkup(await element);
  const json = /<script type="application\/ld\+json">(.*)<\/script>/.exec(html)?.[1];
  return (JSON.parse(json!) as { '@graph': Node[] })['@graph'];
}

const app = (graph: Node[]) => graph.find((node) => node['@type'] === 'SoftwareApplication');

describe('StructuredData', () => {
  it('carries no offers on the landing page', async () => {
    // As `/` renders it: with the FAQ, without plans.
    const graph = await graphOf(StructuredData({ faq: true }));
    expect(graph.some((node) => 'offers' in node)).toBe(false);
  });

  it('carries no offers when /pricing could not load the plans', async () => {
    expect(app(await graphOf(StructuredData({ plans: null })))).not.toHaveProperty('offers');
  });

  it('carries one offer per visible price on /pricing', async () => {
    const offers = app(await graphOf(StructuredData({ plans: SEEDED_PLANS })))?.offers ?? [];
    expect(offers).toHaveLength(8);
    expect(offers).toContainEqual(expect.objectContaining({ price: '9.99', priceCurrency: 'USD' }));
    expect(offers).toContainEqual(
      expect.objectContaining({ price: '249000', priceCurrency: 'VND' }),
    );
  });

  it('answers on the landing page exactly the questions the FAQ section renders', async () => {
    const faq = (await graphOf(StructuredData({ faq: true }))).find(
      (node) => node['@type'] === 'FAQPage',
    );
    expect(faq?.mainEntity?.map((q) => q.name)).toEqual(
      LANDING_FAQ.map((topic) => en[`web.landing.faq${topic}Question`]),
    );
    expect(faq?.mainEntity?.map((q) => q.acceptedAnswer.text)).toEqual(
      LANDING_FAQ.map((topic) => en[`web.landing.faq${topic}Answer`]),
    );
  });

  it('carries no FAQ where the page shows none', async () => {
    const graph = await graphOf(StructuredData({ plans: SEEDED_PLANS }));
    expect(graph.some((node) => node['@type'] === 'FAQPage')).toBe(false);
  });
});
