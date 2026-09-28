import {
  liveServerEventSchema,
  type LiveClientEvent,
  type LiveServerEvent,
  type TranslationDirection,
} from '@chatofy/types';

import { connectJsonSocket, detachJsonSocket, sendJsonEvent } from './json-event-socket.js';

/**
 * Typed client for the continuous mode of `/ws/translate`.
 *
 * A sibling of `TranslateSocket`, not a mode of it. The two speak different
 * unions and mean different things by "a session": there, a session is one turn
 * the client opens and closes; here it is the whole conversation, and the
 * backend decides where utterances begin and end. Folding them together would
 * put a branch in every method of both.
 *
 * The outer `{ event, data }` envelope is the same, because that is Nest's
 * `WsAdapter` and not this contract.
 */

/**
 * `http(s)://host` → `ws(s)://host/ws/translate`.
 *
 * Same URL as {@link translateSocketUrl}, and deliberately its own function: the
 * mode is chosen by the first message this socket sends, so a caller naming the
 * live URL is stating which mode it wants even though the string matches.
 */
export function liveTranslateSocketUrl(apiBaseUrl: string): string {
  const base = new URL(apiBaseUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/ws/translate';
  return base.toString();
}

export interface LiveTranslateSocketHandlers {
  onEvent: (event: LiveServerEvent) => void;
  /**
   * The socket closed. `code` and `reason` are the server's when it initiated
   * the close, and they are reported verbatim: nothing re-checks the token on a
   * live socket, so there is no auth-specific close code to branch on here. A
   * refused UPGRADE does not reach this callback at all — browsers surface an
   * aborted upgrade as a bare error carrying no status. Both are why a client
   * tells an expired session from a network fault with a `GET /auth/me` probe
   * rather than from anything read here.
   */
  onClosed?: (code: number, reason: string) => void;
  onError?: (message: string) => void;
}

export class LiveTranslateSocket {
  private socket: WebSocket | null = null;

  constructor(
    /** Full `ws(s)://` endpoint; see {@link liveTranslateSocketUrl}. */
    private readonly url: string,
    private readonly handlers: LiveTranslateSocketHandlers,
    /**
     * The access token, offered as the second subprotocol.
     *
     * Not on the URL: a URL-borne credential lands in server and proxy access
     * logs and in connection history. Browsers cannot set `Authorization` on a
     * WebSocket, but they can offer subprotocols, and node's `ws` takes the
     * identical two-argument form — so every client authenticates the same way.
     */
    private readonly accessToken: string,
  ) {}

  async connect(): Promise<void> {
    this.close();

    // Assigned BEFORE the await, synchronously with the `WebSocket` itself —
    // see `connectJsonSocket`'s doc. A `close()` arriving while the handshake is
    // still pending must find this socket in `this.socket`, or it closes
    // nothing and the pending connection goes on to open unattended.
    const { socket, ready } = connectJsonSocket(
      this.url,
      this.accessToken,
      liveServerEventSchema,
      this.handlers,
      (closed) => {
        if (this.socket === closed) this.socket = null;
      },
    );
    this.socket = socket;
    await ready;
  }

  send(event: LiveClientEvent): void {
    // The turn socket's caller needs to tell "sent" from "dropped"; this one
    // has no such caller, so the boolean `sendJsonEvent` returns is discarded.
    sendJsonEvent(this.socket, event);
  }

  start(direction: TranslationDirection): void {
    this.send({ type: 'client.live.start', direction });
  }

  /**
   * Push one block of captured audio.
   *
   * No `sessionId` from the caller: this path allows one session per connection,
   * so the socket already identifies it. The field is on the wire because the
   * frame envelope is shared with the turn path, and the server ignores it.
   */
  sendAudio(sequence: number, sampleRate: number, payload: string): void {
    this.send({
      type: 'client.live.audio',
      frame: {
        sessionId: 'live',
        encoding: 'pcm16',
        sampleRate,
        sequence,
        timestamp: Date.now(),
        payload,
      },
    });
  }

  stop(): void {
    this.send({ type: 'client.live.stop' });
  }

  close(): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    detachJsonSocket(socket);
  }
}
