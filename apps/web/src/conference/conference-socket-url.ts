import { translateSocketUrl } from '@chatofy/realtime-client';

/**
 * The API's WebSocket origin, derived from the same `NEXT_PUBLIC_API_BASE_URL`
 * the REST client and the Content Security Policy use (`/translate` does the
 * same through `translateSocketUrl`). A separate WS variable would let the two
 * drift: the CSP allows only the API base's origin, so a socket aimed anywhere
 * else is blocked before it opens and the call sits on "Connecting…".
 */
export function conferenceSocketBaseUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${url.host}`;
}

/**
 * The meeting speaker leg's `/ws/translate` endpoint, from the same API base.
 *
 * From the HTTP base, never from {@link conferenceSocketBaseUrl}'s result:
 * `translateSocketUrl` maps anything but `https:` to `ws:`, so a `wss://`
 * origin fed back into it comes out as `ws://` — mixed content the browser
 * blocks on every production page.
 */
export function conferenceTranslateSocketUrl(apiBaseUrl: string): string {
  return translateSocketUrl(apiBaseUrl);
}
