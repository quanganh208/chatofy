import type { Metadata } from 'next';
import { getT } from '@/i18n/server';
import { FooterCta } from '@/components/marketing/footer-cta';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { LocalSpeech } from '@/components/marketing/local-speech';
import { Surfaces } from '@/components/marketing/surfaces';

/**
 * The landing page's own title and description, both from the dictionary. They are
 * what a search result and a shared link show, which makes them the copy most likely
 * to be read by someone who never opens the page.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('web.meta.home'), description: t('web.meta.homeDescription') };
}

/**
 * The landing page.
 *
 * Five bands, ending in the ask. What is deliberately absent is as much of the design as
 * what is here: no pricing on a product with no price, no testimonials from users who do
 * not exist, no logo wall, and exactly one number on the whole page — the measured
 * ~0.9 s between the end of a sentence and the start of playback, from
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
      <Hero />
      <HowItWorks />
      <LocalSpeech />
      <Surfaces />
      <FooterCta />
    </>
  );
}
