import type { ConferenceErrorCode } from '@chatofy/types';
import type { z } from 'zod';

/** `WebSocket.OPEN` — spelled here so nothing in this module imports `ws`. */
export const SOCKET_OPEN = 1;

/**
 * The subset of a `ws` socket the conference gateway uses.
 *
 * Structural, like `StreamSocket` in the translate module, so specs drive the
 * gateway with a plain object instead of a real server.
 */
export interface ConferenceSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  /** Drops the TCP connection without the closing handshake. */
  terminate(): void;
  readyState: number;
  /** Verified at the upgrade; never taken from a message. */
  _userId?: string;
  /** Minted by the gateway on connect; the identity peers see. */
  _socketId?: string;
  /** Set only once a join has fully succeeded; cleared on leave or eviction. */
  _roomId?: string;
  /** True while a `conference.join` for this socket is in flight. */
  _joining?: boolean;
  /** Heartbeat bookkeeping: false after a ping, true again on the pong. */
  _isAlive?: boolean;
}

/** An error reply. The code is the whole message; internals never leave the server. */
export interface ConferenceErrorReply {
  error: ConferenceErrorCode;
}

/**
 * Send one `{ event, data }` frame, never letting a dead socket throw into a
 * handler. A socket that is not open is skipped: `ws` would throw on it.
 */
export function sendEvent(
  ws: ConferenceSocket,
  event: string,
  data: unknown,
): void {
  if (ws.readyState !== SOCKET_OPEN) return;
  try {
    ws.send(JSON.stringify({ event, data }));
  } catch {
    // The socket died between the state check and the write. Its close event
    // runs the cleanup; there is nothing to deliver to.
  }
}

/** `safeParse` an inbound body; `null` means "reply invalid_payload". */
export function parsePayload<T>(schema: z.ZodType<T>, body: unknown): T | null {
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
