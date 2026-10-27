import type { MetadataRoute } from 'next';
import { serverEnv } from '@/config/server-env';

/**
 * Rendered per request, not at build. A route that reads no request is prerendered,
 * and the build has no `WEB_BASE_URL` — the first deploy served
 * `http://localhost:3001/…` from the build cache while the container held the
 * real origin. `crawler-surfaces-are-dynamic.spec.ts` keeps this line.
 */
export const dynamic = 'force-dynamic';

/**
 * Every crawler may read the public surface; none needs the signed-in app.
 *
 * No per-bot rules: search, answer-engine and training crawlers are all allowed,
 * which is what the site did before this file existed (a 404 robots.txt allows
 * everything). Blocking any of them is an owner decision, not a default.
 *
 * The disallowed prefixes are the routes `proxy.ts` redirects to `/login` for a
 * signed-out visitor — crawling them only collects redirects. Keep the two lists
 * in step when a route is added; `robots-covers-signed-in-routes.spec.ts` fails
 * when a sidebar destination is missing, which is how `/conference` once was.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/translate', '/conference', '/history', '/preferences', '/account', '/api/'],
    },
    sitemap: new URL('/sitemap.xml', serverEnv.WEB_BASE_URL).toString(),
  };
}
