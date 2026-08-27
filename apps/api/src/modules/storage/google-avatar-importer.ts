import type { Logger } from '@nestjs/common';
import { MAX_AVATAR_BYTES } from './avatar-image';

/** How long the login path is willing to wait for a picture it does not need. */
const FETCH_TIMEOUT_MS = 3000;

/**
 * Whether this URL is one of Google's own picture hosts.
 *
 * Parsed with `new URL`, never string-matched. `endsWith('googleusercontent.com')`
 * also accepts `evilgoogleusercontent.com`, and a raw `includes` check accepts a
 * userinfo prefix like `https://lh3.googleusercontent.com@attacker.tld/` — where
 * the real host is `attacker.tld`. Both are refused here.
 */
export function isGooglePictureUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    (url.hostname === 'googleusercontent.com' ||
      url.hostname.endsWith('.googleusercontent.com'))
  );
}

/**
 * Drops any existing `=s...` size suffix and asks for a 256px square crop.
 *
 * Asking Google for the size we want is what keeps an image decoder out of the
 * API entirely: there is nothing to resize on arrival.
 */
export function withSize(raw: string): string {
  return `${raw.split('=')[0]}=s256-c`;
}

/**
 * Reads the response body, aborting once it exceeds the avatar cap.
 *
 * Streamed with a running count rather than trusting `Content-Length`: that
 * header is a claim like any other, and the point of the cap is to bound what
 * this process actually allocates.
 */
async function readBounded(response: Response): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_AVATAR_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Fetches a Google profile picture, or returns null for any failure at all.
 *
 * Null rather than throwing: every caller is on the login path and must continue
 * regardless. A person signing in does not care about their avatar in that
 * moment, and nothing here is permitted to cost them the session.
 *
 * Redirects are REFUSED, not followed. `fetch` follows up to 20 by default,
 * which would make a single 30x bypass the host allowlist entirely — and this
 * process can reach the local STT/TTS sidecars and the rest of the compose
 * network. With the bytes landing in a PUBLIC bucket, a followed redirect is a
 * read-SSRF exfiltration primitive for anything whose first bytes sniff as an
 * image. Google serves picture bytes directly, so refusing costs nothing.
 */
export async function fetchGoogleAvatar(
  raw: string,
  logger: Logger,
): Promise<Buffer | null> {
  if (!isGooglePictureUrl(raw)) {
    logger.warn('Refused a Google picture URL that is not on a Google host');
    return null;
  }

  try {
    const response = await fetch(withSize(raw), {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await readBounded(response);
  } catch (err) {
    logger.warn(
      `Could not fetch a Google avatar: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
    return null;
  }
}
