import type { MetadataRoute } from 'next';
import { serverEnv } from '@/config/server-env';

/**
 * Every crawler may read the public surface; none needs the signed-in app.
 *
 * No per-bot rules: search, answer-engine and training crawlers are all allowed,
 * which is what the site did before this file existed (a 404 robots.txt allows
 * everything). Blocking any of them is an owner decision, not a default.
 *
 * The disallowed prefixes are the routes `proxy.ts` redirects to `/login` for a
 * signed-out visitor — crawling them only collects redirects. Keep the two lists
 * in step when a route is added.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/translate', '/history', '/preferences', '/account', '/api/'],
    },
    sitemap: new URL('/sitemap.xml', serverEnv.WEB_BASE_URL).toString(),
  };
}
