import {
  WS_SUBPROTOCOL,
  serverEventSchema,
  type ClientEvent,
  type ClientTurnMetrics,
  type ServerEvent,
  type SessionOptions,
} from '@chatofy/types';

/**
 * Typed client for `/ws/translate`.
 *
 * Two framings meet here and both are load-bearing:
 *  - Nest's `WsAdapter` dispatches on an outer `{ event, data }` envelope.
 *  - The payload inside is a full `ClientEvent`, validated server-side against
 *    the shared contract.
 * Sending the bare event without the envelope reaches no handler at all, which
 * is why `send` builds both from one value rather than trusting a caller.
 *
 * Incoming events are parsed against `serverEventSchema` instead of being cast,
 * so a contract drift surfaces here rather than as a missing field somewhere
 * downstream.
 */

/**
 * `http(s)://host` → `ws(s)://host/ws/translate`.
 *
 * Exported rather than applied inside the constructor so the class takes a URL it
 * can actually connect to, while both consumers still derive it the same way. The
 * base itself has to come from the caller: this used to read
 * `env.NEXT_PUBLIC_API_BASE_URL` directly, which is a Next-only global and the
 * one thing that kept this file from being importable by a Chrome extension.
 */
export function translateSocketUrl(apiBaseUrl: string): string {
  const base = new URL(apiBaseUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/ws/translate';
  return base.toString();
}

/**
 * A fresh name for a turn.
 *
 * One generator, deliberately: with several turns in flight, two sharing a name
 * would misroute every event about either of them. `randomUUID` is available in
 * browsers, in a Chrome extension's worker and in node, which is the whole set of
 * places this code runs.
 */
export function newTurnId(): string {
  return crypto.randomUUID();
}

export interface TranslateSocketHandlers {
  onEvent: (event: ServerEvent) => void;
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

export class TranslateSocket {
  private socket: WebSocket | null = null;

  constructor(
    /** Full `ws(s)://` endpoint; see {@link translateSocketUrl}. */
    private readonly url: string,
    private readonly handlers: TranslateSocketHandlers,
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

  /** Connect and resolve once the socket is usable. */
  async connect(): Promise<void> {
    this.close();

    const socket = new WebSocket(this.url, [WS_SUBPROTOCOL, this.accessToken]);
    this.socket = socket;

    socket.onmessage = (message) => {
      // A frame that is not JSON at all would throw out of the event handler,
      // which the schema check below cannot help with.
      let body: unknown;
      try {
        body = JSON.parse(String(message.data));
      } catch {
        this.handlers.onError?.('Unreadable frame from the server');
        return;
      }

      const parsed = serverEventSchema.safeParse(body);
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

  /**
   * Wrap a contract event in the envelope the adapter dispatches on.
   *
   * Returns whether the frame actually went out. A closed socket is still
   * silent — reporting it to the user mid-conversation would be noise, and the
   * close itself is already reported — but the caller has to be able to tell
   * "sent" from "dropped", because one of them means the audio is still its
   * responsibility. See `TurnPipeline.pushAudio`, which used to count both as
   * sent and so reported captured audio the socket never carried.
   */
  send(event: ClientEvent): boolean {
    if (!this.isOpen) return false;
    this.socket?.send(JSON.stringify({ event: event.type, data: event }));
    return true;
  }

  /**
   * Open a turn under a name the caller has already chosen.
   *
   * The id comes from the caller rather than being minted here because a turn
   * needs a name before this is called: `TurnPipeline` assigns speaking order the
   * moment capture opens a turn, which is well before the start goes out — a turn
   * held back by the in-flight ceiling has an order and a buffer and no request
   * sent yet. See {@link newTurnId} for the generator.
   */
  startSession(options: SessionOptions, turnId: string): void {
    this.send({ type: 'client.session.start', ...options, turnId });
  }

  /** Push one audio frame. Returns whether it left the socket. */
  sendAudio(sessionId: string, sequence: number, sampleRate: number, payload: string): boolean {
    return this.send({
      type: 'client.audio.frame',
      frame: {
        sessionId,
        encoding: 'pcm16',
        sampleRate,
        sequence,
        timestamp: Date.now(),
        payload,
      },
    });
  }

  /**
   * Tell the server the speaker has probably stopped; nothing comes back.
   *
   * `sessionId` is nullable rather than optional because "not known yet" is a
   * real state, not an oversight: the gate can suspect the end of a turn before
   * `server.session.ready` has landed. Requiring the argument makes a caller say
   * which case it is in, and the field is left off the wire when there is no id —
   * the server then falls back to the socket's only turn, which is exactly the
   * behaviour that existed before the field did.
   */
  speculate(sessionId: string | null): void {
    this.send({
      type: 'client.turn.speculate',
      ...(sessionId === null ? {} : { sessionId }),
    });
  }

  /**
   * File what this client measured about a turn.
   *
   * Fire-and-forget and unacknowledged: measurements must never be able to delay
   * or fail the turn they describe, and the server ignores any it cannot attribute
   * to this socket.
   */
  sendTurnMetrics(metrics: ClientTurnMetrics): void {
    this.send({ type: 'client.turn.metrics', ...metrics });
  }

  endSession(sessionId: string | null): void {
    this.send({
      type: 'client.session.end',
      ...(sessionId === null ? {} : { sessionId }),
    });
  }

  close(): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    // Detach first: a close handler firing during teardown would be reported as
    // a dropped connection.
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    socket.close();
  }
}
