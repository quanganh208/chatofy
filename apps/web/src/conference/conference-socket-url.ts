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
