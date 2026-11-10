import { LANGUAGE_CODES, type Plan } from '@chatofy/types';
import { serverEnv } from '@/config/server-env';
import { getLocale, getT } from '@/i18n/server';
import { pricingOffers } from '@/lib/pricing-content';

/**
 * JSON-LD for a public page: the site, and the application it describes.
 *
 * Every value is something the page already says — the same dictionary strings as
 * the title and hero — because markup that disagrees with visible content is worse
 * than none. Deliberately absent: `aggregateRating` (there are no ratings, and
 * inventing them is the dark pattern the copy avoids) and FAQ/HowTo markup (no longer
 * shown in search).
 *
 * `offers` appear only when `plans` is passed, and only `/pricing` passes it: that is
 * the one page that shows a price, so it is the one page whose markup may carry one.
 * The landing page passes nothing and its output is unchanged — no `offers` — which
 * `structured-data.spec.tsx` asserts. A `/pricing` whose plans failed to load passes
 * `null` and gets no offers either, matching a page that shows no prices.
 *
 * `inLanguage` reads the language registry, so adding a language updates it.
 */
export async function StructuredData({ plans }: { plans?: Plan[] | null } = {}) {
  const t = await getT();
  const offers = plans?.length ? pricingOffers(t, await getLocale(), plans) : null;
  const url = new URL('/', serverEnv.WEB_BASE_URL).toString();

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${url}#website`,
        name: 'Chatofy',
        url,
        inLanguage: [...LANGUAGE_CODES],
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Chatofy',
        url,
        description: t('web.meta.homeDescription'),
        applicationCategory: 'CommunicationApplication',
        operatingSystem: 'Web',
        inLanguage: [...LANGUAGE_CODES],
        isPartOf: { '@id': `${url}#website` },
        ...(offers ? { offers } : {}),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // `<` escaped so a dictionary string can never close the script element.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, '\\u003c') }}
    />
  );
}
