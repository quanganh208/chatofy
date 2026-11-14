import { serverEnv } from '@/config/server-env';
import { getLocale, getT } from '@/i18n/server';
import { fetchPublicPlans } from '@/lib/fetch-public-plans';
import { landingMarkdown, machineReadableHeaders } from '@/lib/landing-markdown';

/**
 * `/index.md`: the landing page's markdown twin, in the reader's locale. The page
 * advertises it with `<link rel="alternate" type="text/markdown">`.
 *
 * The plans are read as the page reads them, so the Free allowance it states is the
 * page's; without them the twin, like the page, names no count.
 *
 * Exempt from `proxy.ts` by its extension, like every other file-shaped path.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const [t, locale, plans] = await Promise.all([getT(), getLocale(), fetchPublicPlans()]);
  return new Response(landingMarkdown(t, serverEnv.WEB_BASE_URL, locale, plans), {
    headers: machineReadableHeaders('text/markdown'),
  });
}
