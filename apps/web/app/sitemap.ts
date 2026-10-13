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
 * The one page worth indexing.
 *
 * The auth forms are public but are not content anyone searches for, and the app
 * routes are behind sign-in. No `lastmod`: nothing records when the landing copy
 * last changed, and a value reset on every deploy is worse than none.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: new URL('/', serverEnv.WEB_BASE_URL).toString() }];
}
