import type { MetadataRoute } from 'next';
import { serverEnv } from '@/config/server-env';

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
