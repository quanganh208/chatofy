import { Logger } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { WS_SUBPROTOCOL, tokenFromSubprotocols } from '@chatofy/types';

/** What the gateway needs from the auth adapter, and nothing more. */
export type TokenVerifier = (token: string) => Promise<unknown>;

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
      () => cb(true),
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
