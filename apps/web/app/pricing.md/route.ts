import { serverEnv } from '@/config/server-env';
import { getLocale, getT } from '@/i18n/server';
import { fetchPublicPlans } from '@/lib/fetch-public-plans';
import { machineReadableHeaders } from '@/lib/landing-markdown';
import { pricingContent } from '@/lib/pricing-content';
import { pricingMarkdown } from '@/lib/pricing-markdown';

/**
 * `/pricing.md`: the pricing page's markdown twin, in the reader's locale, from the same
 * plan rows the page reads. `/pricing` advertises it with
 * `<link rel="alternate" type="text/markdown">`, and `/llms.txt` links it.
 *
 * Per request, like the page: prices are database rows. Exempt from `proxy.ts` by its
 * extension, like every other file-shaped path.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const [t, locale, plans] = await Promise.all([getT(), getLocale(), fetchPublicPlans()]);
  const meta = { title: t('web.meta.pricing'), description: t('web.meta.pricingDescription') };
  return new Response(
    pricingMarkdown(pricingContent(t, locale, plans), meta, serverEnv.WEB_BASE_URL),
    { headers: machineReadableHeaders('text/markdown') },
  );
}
