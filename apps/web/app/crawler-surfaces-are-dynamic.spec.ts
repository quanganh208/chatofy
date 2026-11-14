import { describe, expect, it, vi } from 'vitest';

/**
 * robots.txt and sitemap.xml must read `WEB_BASE_URL` at request time, and the pricing
 * page and its twin must read the plan rows at request time.
 *
 * Neither reads a request, so without this Next prerenders both at build — where
 * `WEB_BASE_URL` is unset — and production served a `localhost` sitemap from the
 * build cache while the container held the real origin. No other check sees it:
 * `next dev` renders everything per request.
 */
vi.mock('@/config/server-env', () => ({ serverEnv: { WEB_BASE_URL: 'https://chatofy.example' } }));
// The pricing modules import the session and a server-only fetcher; neither is under test.
vi.mock('server-only', () => ({}));
vi.mock('@/../auth', () => ({ auth: () => Promise.resolve(null) }));

// Imported at the top, not inside each case: the pricing page pulls in the whole
// `@chatofy/ui/react` barrel (~220 ms of module evaluation on an idle machine).
// Loaded inside a test that counted against the 5 s test timeout, and under a
// parallel `turbo run test` it ran past it. At the top it is collection, like
// every other spec's imports; the cases then only read one export each.
import * as robots from './robots';
import * as sitemap from './sitemap';
import * as pricingPage from './(marketing)/pricing/page';
import * as pricingMarkdown from './pricing.md/route';
import * as landingPage from './(marketing)/page';
import * as landingMarkdown from './index.md/route';

describe.each([
  ['robots.txt', robots],
  ['sitemap.xml', sitemap],
  // A prerendered copy would publish the build machine's prices, or none.
  ['/pricing', pricingPage],
  ['/pricing.md', pricingMarkdown],
  // The landing states the Free allowance from the same rows.
  ['/', landingPage],
  ['/index.md', landingMarkdown],
] as const)('%s', (_, surface) => {
  it('is rendered per request, so it never carries the build-time origin', () => {
    expect(surface.dynamic).toBe('force-dynamic');
  });
});
