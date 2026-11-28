/**
 * The host permission that lets the extension call its own API.
 *
 * The API answers CORS for the web app's origin only, and a `chrome-extension://`
 * origin is not one it can list in advance: an unpacked build's id comes from its
 * folder path. Without a host permission every fetch from the popup, the worker
 * and the offscreen document was refused, and the popup said "Cannot reach" an API
 * that was up. A host permission is Chrome's own answer for this: requests from
 * extension pages to a granted host are not subject to CORS.
 *
 * Derived from the same `WXT_API_BASE_URL` the bundle is compiled with, so the
 * grant always names the host the code calls, and nothing wider.
 */

/** The fallback in `settings.ts` (`DEFAULT_API_BASE_URL`), repeated because this runs at config time. */
export const DEV_API_BASE_URL = 'http://localhost:3000';

/**
 * `<scheme>://<host>/*` for an API base URL.
 *
 * The port is dropped: a match pattern's host part is a host, and Chrome matches
 * every port on it, which is what a local API on `:3000` needs.
 */
export function apiHostPermission(apiBaseUrl: string | undefined): string {
  const url = new URL(apiBaseUrl || DEV_API_BASE_URL);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`WXT_API_BASE_URL must be http(s), got ${url.protocol}`);
  }
  return `${url.protocol}//${url.hostname}/*`;
}
