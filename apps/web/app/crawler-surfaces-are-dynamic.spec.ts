import { describe, expect, it, vi } from 'vitest';

/**
 * robots.txt and sitemap.xml must read `WEB_BASE_URL` at request time.
 *
 * Neither reads a request, so without this Next prerenders both at build — where
 * `WEB_BASE_URL` is unset — and production served a `localhost` sitemap from the
 * build cache while the container held the real origin. No other check sees it:
 * `next dev` renders everything per request.
 */
vi.mock('@/config/server-env', () => ({ serverEnv: { WEB_BASE_URL: 'https://chatofy.example' } }));

describe.each([
  ['robots.txt', () => import('./robots')],
  ['sitemap.xml', () => import('./sitemap')],
])('%s', (_, load) => {
  it('is rendered per request, so it never carries the build-time origin', async () => {
    expect((await load()).dynamic).toBe('force-dynamic');
  });
});
