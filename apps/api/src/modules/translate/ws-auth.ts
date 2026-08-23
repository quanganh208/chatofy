import { Logger } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { WS_SUBPROTOCOL, tokenFromSubprotocols } from '@chatofy/types';

/**
 * What the gateway needs from the auth adapter, and nothing more.
 *
 * Returns the verified claims rather than `unknown`: the gateway records which
 * user each open socket belongs to, so a completed password reset can close
 * them. Without a subject coming back from here the server cannot name a live
 * socket's owner, and revocation would stop at the upgrade — leaving a stolen
 * token streaming the victim's audio and transcripts for the rest of its seven
 * days, across the very reset performed to stop it.
 */
export type TokenVerifier = (token: string) => Promise<{ sub: string }>;

/** The subset of `ws`'s verifyClient callback argument this code reads. */
export interface UpgradeInfo {
  req: Pick<IncomingMessage, 'headers'>;
}

/** `ws`'s async verifyClient callback. */
export type VerifyCallback = (
  verified: boolean,
  code?: number,
  message?: string,
) => void;

/**
 * Where a passing upgrade records whose token it carried.
 *
 * Stamped onto the upgrade REQUEST rather than handed to a callback, because
 * `ws` passes that same request object to the `connection` event — so the socket
 * and its owner arrive together and cannot be mismatched. A "remember the last
 * verified subject" variable would look equivalent and is not: an upgrade that
 * passes verification and then aborts (the peer hangs up between the two) leaves
 * that value behind for the NEXT socket to pick up, and a misattributed socket
 * means a reset closes the wrong person's connection and leaves the right one
 * open.
 *
 * A symbol, so nothing can collide with it or reach it by guessing a name.
 */
export const VERIFIED_USER_ID = Symbol('verifiedUserId');

/**
 * The bearer token an upgrade request offered, or null.
 *
 * Re-read from the request rather than stashed alongside the subject: the header
 * is already there, and keeping a second copy of a live credential on a
 * long-lived object earns nothing.
 */
export function tokenFromUpgradeRequest(req: unknown): string | null {
  if (typeof req !== 'object' || req === null) return null;
  const { headers } = req as { headers?: Record<string, unknown> };
  const header = headers?.['sec-websocket-protocol'];
  return tokenFromSubprotocols(
    Array.isArray(header) ? header.join(',') : (header as string | undefined),
  );
}

/** Reads back what {@link VERIFIED_USER_ID} stamped, or undefined. */
export function verifiedUserId(req: unknown): string | undefined {
  if (typeof req !== 'object' || req === null) return undefined;
  const value = (req as Record<symbol, unknown>)[VERIFIED_USER_ID];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Refuses an unauthenticated WebSocket **at the HTTP upgrade**, before a socket
 * exists.
 *
 * This is deliberately not a check inside `handleConnection`. Nest's
 * web-sockets-controller emits the connection event synchronously and binds
 * every @SubscribeMessage handler on the very next line, and it discards
 * whatever `handleConnection` returns — so an async check there leaves handlers
 * bound and dispatching while verification is still in flight, and a *rejected*
 * verification becomes an unhandled rejection, which Node 24 turns into a
 * process exit. Refusing here removes that window by construction: `ws` calls
 * this inside `handleUpgrade` and aborts before it ever constructs a WebSocket,
 * so there is no socket, no bound handler, and no race to gate.
 *
 * Every failure — no header, no token, a bad token, or a verifier that throws —
 * lands on the same `cb(false, 401)`. Errors are handled inside the callback, so
 * nothing escapes as a floating rejection.
 */
export function createVerifyClient(verify: TokenVerifier, logger?: Logger) {
  return function verifyClient(info: UpgradeInfo, cb: VerifyCallback): void {
    const header = info.req.headers['sec-websocket-protocol'];
    const token = tokenFromSubprotocols(
      Array.isArray(header) ? header.join(',') : header,
    );

    if (!token) {
      cb(false, 401, 'Unauthorized');
      return;
    }

    verify(token).then(
      (claims) => {
        // Stamped BEFORE `cb(true)`. `ws` builds the WebSocket inside that
        // callback and emits `connection` from it, carrying this same request —
        // so by the time the gateway sees the socket, the subject is already on
        // the object it is handed.
        (info.req as Record<symbol, unknown>)[VERIFIED_USER_ID] = claims.sub;
        cb(true);
      },
      (err: unknown) => {
        logger?.debug(
          `refused a socket upgrade: ${err instanceof Error ? err.message : String(err)}`,
        );
        cb(false, 401, 'Unauthorized');
      },
    );
  };
}

/**
 * Selects the subprotocol, and only ever the name.
 *
 * Returning false, or selecting nothing, both break the client: a browser closes
 * a connection whose handshake selected none of its offered subprotocols
 * immediately after that handshake succeeds. Echoing the token would put the
 * credential back on the wire in a response header for no reason.
 */
export function handleProtocols(): string {
  return WS_SUBPROTOCOL;
}
