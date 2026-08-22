import {
  WS_SUBPROTOCOL,
  liveServerEventSchema,
  type LiveClientEvent,
  type LiveServerEvent,
  type TranslationDirection,
} from '@chatofy/types';

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
   * The socket closed. `code` and `reason` are the server's, when it initiated
   * the close — 4401 says the token expired mid-stream, which is a different
   * case from a refused handshake and the only one where a code exists at all.
   * A refused UPGRADE never reaches here; browsers surface it as a bare error.
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

  private get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    this.close();

    const socket = new WebSocket(this.url, [WS_SUBPROTOCOL, this.accessToken]);
    this.socket = socket;

    socket.onmessage = (message) => {
      let body: unknown;
      try {
        body = JSON.parse(String(message.data));
      } catch {
        this.handlers.onError?.('Unreadable frame from the server');
        return;
      }
      const parsed = liveServerEventSchema.safeParse(body);
      if (!parsed.success) {
        this.handlers.onError?.('Unexpected event shape from the server');
        return;
      }
      this.handlers.onEvent(parsed.data);
    };

    socket.onclose = (event) => {
      if (this.socket === socket) this.socket = null;
      this.handlers.onClosed?.(event.code, event.reason);
    };

    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('Cannot reach the translator'));
    });

    // The handshake's own handlers must not stay attached: `onerror` is still
    // the promise's `reject`, which is inert once settled, so a transport
    // failure mid-conversation would be swallowed instead of reported.
    socket.onopen = null;
    socket.onerror = () => this.handlers.onError?.('Connection error');
  }

  send(event: LiveClientEvent): void {
    if (!this.isOpen) return;
    this.socket?.send(JSON.stringify({ event: event.type, data: event }));
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
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    socket.close();
  }
}
