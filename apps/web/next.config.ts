import type { NextConfig } from 'next';

/**
 * The access token is readable from client JS by design — `getHeaders` and the
 * WebSocket handshake both need it, and neither runs on the server. That makes
 * an XSS worth a seven-day bearer credential usable from any host, and WebSocket
 * handshakes are not subject to CORS, so a stolen string opens /ws/translate
 * from the attacker's machine directly.
 *
 * Revocation exists, but it is not a general answer to a stolen token: a
 * password reset invalidates every token issued before it and closes that user's
 * open sockets, so a victim who notices CAN end it — where previously nothing
 * could. What there is still no way to do is revoke without changing the
 * password, and a token whose password never changes runs its full seven days.
 * The lifetime therefore remains the exposure this header mitigates.
 *
 * This header is mitigation for that, and the limit is worth naming here rather
 * than being discovered later. `script-src` carries `'unsafe-inline'`, so it does
 * NOT raise the cost of getting script onto the page: an injected `<script>`
 * runs. What it buys is narrower — no script may be LOADED from another origin,
 * `connect-src` refuses `fetch` and `WebSocket` to anywhere but this app and the
 * API, and `object-src`, `base-uri` and `form-action` close the usual sidesteps
 * around those. An attacker who lands inline script still reads the token and can
 * still leak it by navigating the top-level document, which no directive here
 * stops. So this is not a compensating control for the token's exposure; the
 * seven-day lifetime remains the exposure, bounded only by a password reset.
 *
 * Closing it means dropping `'unsafe-inline'`, and that needs a per-request
 * NONCE rather than a hash: Next emits its own inline bootstrap
 * (`self.__next_f.push`) beside the theme script below, so hashing what this repo
 * writes is not enough, and a nonce cannot come from this static config — the
 * header would have to move to `proxy.ts`, whose matcher today covers only the
 * gated routes. That is a real change and it is not in this branch.
 *
 * `'unsafe-inline'` on styles is Tailwind's runtime. `connect-src` has to admit
 * the API over both http(s) and ws(s), since the transports dial the same
 * origin.
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
  // Avatars come from the R2 bucket's public domain, which is NOT 'self'. Same
  // build-time rule as NEXT_PUBLIC_API_BASE_URL above: set only at runtime, the
  // header names nothing and the browser blocks every avatar while the page
  // still renders — a failure that looks like "the upload didn't work".
  //
  // `.origin`, never the raw value. A path or a trailing slash is a legal URL
  // and an INVALID CSP source expression, and a value containing `;` would
  // inject directives outright. `new URL` throws on a malformed value, which
  // fails the build — which is the point: this is the one consumer where a bad
  // value is dangerous, and the zod schema in src/config/env.ts does not run
  // here (this file reads process.env directly, as it already does for the API).
  const avatarOrigin = process.env.NEXT_PUBLIC_AVATAR_BASE_URL
    ? new URL(process.env.NEXT_PUBLIC_AVATAR_BASE_URL).origin
    : undefined;
  return [
    "default-src 'self'",
    // 'unsafe-eval' is dev-only: the Next dev overlay needs it and production
    // must not have it.
    process.env.NODE_ENV === 'production'
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${avatarOrigin ? ` ${avatarOrigin}` : ''}`,
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
  /**
   * Traced, self-contained server output for the production container image.
   *
   * Affects `next build` only — `next dev` and `next start` are unchanged, so
   * nothing about the host workflow moves. In a pnpm workspace the traced output
   * keeps the repo's directory shape rather than flattening it, which means the
   * server entrypoint sits under an `apps/web/` prefix inside the output and the
   * static and public directories are NOT traced into it. The Dockerfile copies
   * both to that same prefix; get it wrong and the HTML still renders while every
   * asset 404s.
   */
  output: 'standalone',
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
