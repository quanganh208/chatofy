/**
 * How a WebSocket client proves who it is.
 *
 * The access token rides the `Sec-WebSocket-Protocol` handshake header rather
 * than the URL. A URL-borne credential lands in server and proxy access logs
 * and in browser connection history; a header does not. Browsers cannot set
 * `Authorization` on a WebSocket, but they can offer subprotocols — that is the
 * two-argument `new WebSocket(url, protocols)` form, available identically in
 * browsers, in a Chrome extension worker, and in node's `ws`.
 *
 * The client offers exactly two: this name, then the token.
 *
 *   new WebSocket(url, [WS_SUBPROTOCOL, token])
 *
 * The server MUST select `WS_SUBPROTOCOL` and must never echo the token back.
 * Selecting nothing is the trap: the handshake still succeeds and the browser
 * then closes the connection immediately, which reads as a server that accepted
 * the login and hung up.
 */
export const WS_SUBPROTOCOL = 'chatofy-v1';

/**
 * Reads the token out of a raw `Sec-WebSocket-Protocol` header value.
 *
 * Returns null for anything that is not exactly "<WS_SUBPROTOCOL>, <token>" —
 * a missing header, a client offering only the name, or one whose first entry
 * is some other protocol. Shared with the server so both ends agree on what a
 * well-formed offer is.
 */
export function tokenFromSubprotocols(header: string | undefined): string | null {
  if (!header) return null;
  const offered = header.split(',').map((entry) => entry.trim());
  if (offered[0] !== WS_SUBPROTOCOL) return null;
  const token = offered[1];
  return token ? token : null;
}
