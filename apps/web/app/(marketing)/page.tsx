import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getT } from '@/i18n/server';
import { Faq } from '@/components/marketing/faq';
import { FooterCta } from '@/components/marketing/footer-cta';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { Modes } from '@/components/marketing/modes';
import { PricingTeaser, PricingTeaserBody } from '@/components/marketing/pricing-teaser';
import { RecordingPrivacy } from '@/components/marketing/recording-privacy';
import { SOCIAL_CARD } from '@/components/marketing/social-card';
import { StructuredData } from '@/components/marketing/structured-data';
import { Surfaces } from '@/components/marketing/surfaces';
import { UseCases } from '@/components/marketing/use-cases';

/**
 * Rendered per request, never prerendered. The Free allowance is a `Plan` row read from
 * the API, as on `/pricing`; a prerendered page would publish whatever the build
 * machine's API said — or nothing — until the next deploy. The session read in the
 * header already made `/` dynamic; this says so where it can be checked.
 */
export const dynamic = 'force-dynamic';

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
    // The image is named here, not left to the file convention — see `SOCIAL_CARD`.
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
 * The landing page.
 *
 * Ten bands, ending in the ask:
 *
 * 1. **Hero** — the claim, the two ways in, a two-way conversation drawn as the
 *    translator draws one, and a strip naming the three languages and where it works.
 * 2. **Modes** (`#modes`) — a bento of what the app has a route for: meetings (the
 *    tall tile — the two halves of the product carry equal weight), one-way, two-way,
 *    history and glossaries, each with a still mockup built from the product's tokens.
 * 3. **How it works** (`#how-it-works`) — three facts about the wait, as a timeline.
 * 4. **Use cases** (`#use-cases`) — situations, each traceable to a mode above.
 * 5. **Privacy** (`#privacy`) — the product's only privacy notice, on a band that is
 *    dark in both themes so it reads as a different kind of content.
 * 6. **Where it runs** (`#where-it-runs`) — browser, extension, phone, each with its
 *    true status.
 * 7. **Pricing** (`#pricing`) — the Free allowance from the live plan rows, the notice
 *    that checkout is not open to the public, and the way to `/pricing`. No buy button.
 * 8. **FAQ** (`#faq`) — answered from the product; the same list feeds the JSON-LD
 *    `FAQPage` and `/index.md`.
 * 9. **The ask** — the lotus and one filled button, for a visitor who is signed out.
 * 10. The footer, from the layout.
 *
 * What is deliberately absent is as much of the design as what is here: no
 * testimonials from users who do not exist, no logo wall, no counts. Two numbers appear
 * and both are real: the measured ~0.9 s between the end of a sentence and the start of
 * playback ("about a second", how-it-works step one and the FAQ, from
 * `docs/development-journey.md`), and the Free plan's monthly credits, read from the
 * same `Plan` row `/pricing` shows. When the plans cannot be loaded the second one goes,
 * as it does on `/pricing`.
 *
 * Two filled controls on the page, a scroll apart: the hero's and the ask's.
 * `accent-budget.spec.tsx` holds every band to at most one. Tiles sit on the page ground
 * as hairlines; the hero card is the one elevated surface.
 *
 * **Motion is an entrance, plus one background drift.** The lotus opens once, the hero
 * copy rises once, and tiles below the fold rise into place the first time they scroll
 * into view (`Reveal`). The only loop is the hero's `aria-hidden` dawn glow drifting
 * behind the lotus, never under a line of text; under reduced motion nothing on `/` moves:
 * `Reveal` leaves its blocks at rest and every animation is paired with
 * `motion-reduce:animate-none`.
 *
 * `/` is server-rendered on demand because the header resolves the session server-side.
 * The plans are read per request like `/pricing`'s, but only the pricing band waits for
 * them: it streams inside a `Suspense` whose fallback is the same band without the
 * number, so a slow API never holds the first byte. It is never redirected: this address
 * is shareable and it opens the thesis demo.
 */
export default function HomePage() {
  return (
    <>
      <StructuredData faq />
      <Hero />
      <Modes />
      <HowItWorks />
      <UseCases />
      <RecordingPrivacy />
      <Surfaces />
      {/* The plans come from the API; only this band waits for them, and until they
          arrive it renders without the number. See `PricingTeaser`. */}
      <Suspense fallback={<PricingTeaserBody plans={null} />}>
        <PricingTeaser />
      </Suspense>
      <Faq />
      <FooterCta />
    </>
  );
}
