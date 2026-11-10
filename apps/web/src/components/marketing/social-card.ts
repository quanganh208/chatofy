/**
 * `app/opengraph-image.png`, served at its own path, for every public page's metadata.
 *
 * Named explicitly by each page, not left to the file convention: any `openGraph`
 * object on a page replaces the root segment's whole one, file image included —
 * measured, the served page lost `og:image` and `twitter:card` fell back to `summary`
 * the moment `url` was added. `page-metadata.spec.ts` holds every public page to it.
 *
 * English only, like the image: it is the headline set in type, and the alt describes
 * what is drawn. Source: `app/(dev)/social-card/page.tsx`.
 */
export const SOCIAL_CARD = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'The chatofy wordmark and lotus over the headline "Speak your language. Be understood in theirs." on a dawn-coloured glow',
};
