import type { NextConfig } from 'next';

/**
 * The access token is readable from client JS by design — `getHeaders` and the
 * WebSocket handshake both need it, and neither runs on the server. That makes
 * an XSS worth a seven-day, non-revocable bearer credential usable from any
 * host, and WebSocket handshakes are not subject to CORS, so a stolen string
 * opens /ws/translate from the attacker's machine directly.
 *
 * This header is the compensating control for that, and it was the missing one:
 * the alternatives on offer were "don't use localStorage" and "it expires in a
 * week". It is not a substitute for a shorter lifetime; it raises the cost of
 * getting script onto the page in the first place.
 *
 * `'unsafe-inline'` on styles is Tailwind's runtime; the theme script in the
 * root layout is inline too, which is why script-src cannot be nonce-only
 * without moving it. `connect-src` has to admit the API over both http(s) and
 * ws(s), since the transports dial the same origin.
 *
 * NEXT_PUBLIC_API_BASE_URL is inlined at BUILD time, here as everywhere else —
 * so this header is fixed when the bundle is built, not when the server starts.
 * Setting it only at runtime yields a CSP naming the default origin while the
 * app dials the real one, and every request and socket is then blocked by the
 * browser. It has to be present in the build environment, which is already true
 * of every NEXT_PUBLIC_ value the client bundle reads.
 */
function contentSecurityPolicy(): string {
  const api = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
  const socket = api.replace(/^http/, 'ws');
  return [
    "default-src 'self'",
    // 'unsafe-eval' is dev-only: the Next dev overlay needs it and production
    // must not have it.
    process.env.NODE_ENV === 'production'
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${api} ${socket}`,
    // The worklet is same-origin; naming it keeps a future CDN move deliberate.
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@chatofy/types', '@chatofy/config'],
  typedRoutes: true,
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
};

export default nextConfig;
