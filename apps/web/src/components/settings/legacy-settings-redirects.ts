import type { NextConfig } from 'next';

type Redirect = Awaited<ReturnType<NonNullable<NextConfig['redirects']>>>[number];

/**
 * Where the two retired settings routes go, read by `next.config.ts`.
 *
 * Config redirects rather than `redirect()` in a page: they run before the filesystem
 * and before `proxy.ts`, so an old bookmark costs one 308 and no render, and a
 * signed-out visitor is sent to `/login?next=/settings/…` for the page that actually
 * exists. Next carries the query string across (`/account?checkout=done` keeps its
 * query), and the browser keeps a `#fragment`.
 *
 * `/account?checkout=…` is Polar's success URL for checkouts opened before the API
 * pointed it at `/settings/billing`, so it lands on Billing, where the return is read,
 * not on Profile. It is listed first because the first match wins.
 *
 * `/settings` itself is temporary (307): which section opens first is a product
 * choice that may change, and browsers cache a permanent redirect indefinitely.
 */
export const LEGACY_SETTINGS_REDIRECTS: readonly Redirect[] = [
  {
    source: '/account',
    has: [{ type: 'query', key: 'checkout' }],
    destination: '/settings/billing',
    permanent: true,
  },
  { source: '/account', destination: '/settings/profile', permanent: true },
  { source: '/preferences', destination: '/settings/appearance', permanent: true },
  { source: '/settings', destination: '/settings/appearance', permanent: false },
];
