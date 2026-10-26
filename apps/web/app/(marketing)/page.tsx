import type { Metadata } from 'next';
import { getT } from '@/i18n/server';
import { FooterCta } from '@/components/marketing/footer-cta';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { Meetings } from '@/components/marketing/meetings';
import { RecordingPrivacy } from '@/components/marketing/recording-privacy';
import { StructuredData } from '@/components/marketing/structured-data';
import { Surfaces } from '@/components/marketing/surfaces';

/**
 * The landing page's own title and description, both from the dictionary. They are
 * what a search result and a shared link show, which makes them the copy most likely
 * to be read by someone who never opens the page.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const title = t('web.meta.home');
  const description = t('web.meta.homeDescription');
  return {
    title,
    description,
    // Relative, resolved against `metadataBase` in the root layout. Set here and not
    // in the layout: a layout canonical would point every page at `/`.
    alternates: {
      canonical: '/',
      types: { 'text/markdown': '/index.md' },
    },
    // The image is named here, not left to `app/opengraph-image.png`'s file
    // convention: any `openGraph` object on a page replaces the root segment's
    // whole one, file image included — measured, the served page lost `og:image`
    // and `twitter:card` fell back to `summary` the moment `url` was added.
    openGraph: {
      title,
      description,
      url: '/',
      siteName: 'Chatofy',
      type: 'website',
      images: [SOCIAL_CARD],
    },
    twitter: { card: 'summary_large_image', title, description, images: [SOCIAL_CARD] },
  };
}

/**
 * `app/opengraph-image.png`, served at its own path. English only, like the image:
 * it is the headline set in type, and the alt describes what is drawn.
 * Source: `app/(dev)/social-card/page.tsx`.
 */
const SOCIAL_CARD = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'The chatofy wordmark and lotus over the headline "Speak your language. Be understood in theirs." on a dawn-coloured glow',
};

/**
 * The landing page.
 *
 * Six bands, ending in the ask: the hero, meetings directly under it (the two halves of
 * the product carry equal weight), how a conversation runs, the privacy notice, where it
 * runs, and the sign-up. What is deliberately absent is as much of the design as what is
 * here: no pricing on a product with no price, no testimonials from users who do not
 * exist, no logo wall, and exactly one number on the whole page — the measured ~0.9 s
 * between the end of a sentence and the start of playback (how-it-works, step one), from
 * `docs/development-journey.md`. There is nothing else to honestly count.
 *
 * **Nothing animates on scroll.** The guidelines allow a section entrance and it was not
 * taken: each one costs an `IntersectionObserver`, and what makes this page read as
 * finished is the elevation scale the surfaces already use, not movement the reader did
 * not ask for. That also means the reduced-motion criterion holds by construction rather
 * than by a `motion-reduce:` on every band.
 *
 * `/` is server-rendered on demand because the header resolves the session server-side —
 * measured in Phase 5, and the price of showing a returning visitor the right button in
 * the first byte. It is never redirected: this address is shareable and it opens the
 * thesis demo.
 */
export default function HomePage() {
  return (
    <>
      <StructuredData />
      <Hero />
      <Meetings />
      <HowItWorks />
      <RecordingPrivacy />
      <Surfaces />
      <FooterCta />
    </>
  );
}
