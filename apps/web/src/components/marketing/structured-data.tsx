import { LANGUAGE_CODES } from '@chatofy/types';
import { serverEnv } from '@/config/server-env';
import { getT } from '@/i18n/server';

/**
 * JSON-LD for the landing page: the site, and the application it describes.
 *
 * Every value is something the page already says — the same dictionary strings as
 * the title and hero — because markup that disagrees with visible content is worse
 * than none. Deliberately absent: `offers` and `aggregateRating` (there is no price
 * and there are no ratings, and inventing either is the dark pattern the copy avoids)
 * and FAQ/HowTo markup (no longer shown in search).
 *
 * `inLanguage` reads the language registry, so adding a language updates it.
 */
export async function StructuredData() {
  const t = await getT();
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
