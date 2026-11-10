/**
 * The query parameter Polar appends to a checkout's success URL on its own.
 *
 * It is a short-lived customer session: whoever holds it can open that
 * customer's Polar portal (orders, cancelling the subscription). Chatofy never
 * reads it — the portal button mints its own session server-side — so it has
 * no reason to stay in the address bar, the browser history, or a copied link.
 */
export const POLAR_SESSION_TOKEN_PARAM = 'customer_session_token';

/**
 * Rewrites the current history entry without Polar's session token, keeping
 * every other parameter (`checkout=done` above all) and the hash.
 *
 * `replaceState`, not a navigation: nothing reloads and Back does not lead to
 * the token-bearing URL. Returns whether anything was removed.
 */
export function stripPolarSessionToken(
  location: Pick<Location, 'href'>,
  history: Pick<History, 'replaceState' | 'state'>,
): boolean {
  const url = new URL(location.href);
  if (!url.searchParams.has(POLAR_SESSION_TOKEN_PARAM)) return false;
  url.searchParams.delete(POLAR_SESSION_TOKEN_PARAM);
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return true;
}
