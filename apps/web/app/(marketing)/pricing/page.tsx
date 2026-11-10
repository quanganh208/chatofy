import type { Metadata } from 'next';
import { getT } from '@/i18n/server';
import { PricingHero, PricingPlans } from '@/components/marketing/pricing-plans';
import { SOCIAL_CARD } from '@/components/marketing/social-card';
import { StructuredData } from '@/components/marketing/structured-data';
import { fetchPublicPlans } from '@/lib/fetch-public-plans';

/**
 * Rendered per request, never prerendered. Prices are `Plan` rows read from the API on
 * each request; a prerendered page would publish whatever the build machine's API said
 * — or nothing, since the build has none — until the next deploy.
 */
export const dynamic = 'force-dynamic';

/** `/pricing`'s title and description, from the dictionary, like the landing page's. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const title = t('web.meta.pricing');
  const description = t('web.meta.pricingDescription');
  return {
    title,
    description,
    alternates: {
      canonical: '/pricing',
      types: { 'text/markdown': '/pricing.md' },
    },
    // The image is named here, not left to the file convention — see `SOCIAL_CARD`.
    openGraph: {
      title,
      description,
      url: '/pricing',
      siteName: 'Chatofy',
      type: 'website',
      images: [SOCIAL_CARD],
    },
    twitter: { card: 'summary_large_image', title, description, images: [SOCIAL_CARD] },
  };
}

/**
 * The public pricing page: Free, Pro and the top-ups, read from `GET /billing/plans`,
 * under a notice that checkout is not open to the public.
 *
 * The plans are fetched once and handed to both the visible bands and the JSON-LD, so
 * the markup's `offers` are exactly the prices on screen. When the fetch fails both get
 * `null`: the page renders without prices and the markup without offers.
 */
export default async function PricingPage() {
  const plans = await fetchPublicPlans();
  return (
    <>
      <StructuredData plans={plans} />
      <PricingHero />
      <PricingPlans plans={plans} />
    </>
  );
}
