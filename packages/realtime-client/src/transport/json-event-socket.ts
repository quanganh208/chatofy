import { WS_SUBPROTOCOL } from '@chatofy/types';

/**
 * The shape both `serverEventSchema` and `liveServerEventSchema` already have.
 * Declared locally instead of importing zod's `ZodSchema`: this package only
 * depends on `@chatofy/types`, and a schema's `safeParse` is all either socket
 * ever calls.
 */
export interface JsonEventSchema<TEvent> {
  safeParse(data: unknown): { success: true; data: TEvent } | { success: false };
}

export interface JsonSocketHandlers<TEvent> {
  onEvent: (event: TEvent) => void;
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

/**
 * Told a server-initiated close before the public `onClosed` handler runs, so
 * the owning class can clear its own `this.socket` first — a stale close
 * event from a superseded connection must never null out the socket a newer
 * `connect()` already installed.
 */
export type NotifyJsonSocketClosed = (socket: WebSocket, code: number, reason: string) => void;

/**
 * What {@link connectJsonSocket} hands back: the socket ITSELF, synchronously,
 * plus a promise for the handshake.
 *
 * Splitting these is the whole point. A caller that only got the promise had no
 * way to record the socket until the handshake resolved, and a `close()` — or a
 * second overlapping `connect()` — arriving before then found nothing to close:
 * the pending socket went on to open, installed itself with live handlers, and
 * for `LiveTranslateSocket` specifically it could go on to `start()` a Gemini
 * Live session nobody would ever consume. Handing back the socket up front lets
 * the owner assign its own field before awaiting anything, exactly as it did
 * when `new WebSocket(...)` was called inline.
 */
export interface JsonSocketConnection {
  socket: WebSocket;
  /** Resolves once the handshake completes; rejects if it fails. */
  ready: Promise<void>;
}

/**
 * How `ready` rejects when the CALLER closed the socket before its handshake
 * finished — a `dispose()`, a teardown, or an overlapping `connect()`.
 *
 * Distinct from a failed handshake on purpose: nothing went wrong, the caller
 * simply stopped wanting the connection, so an owner awaiting `ready` should
 * return quietly rather than report an error. Without it `ready` never settled
 * at all — a socket closed while CONNECTING never fires `onopen`, and
 * {@link detachJsonSocket} has already removed the `onerror` that was `ready`'s
 * only other way out — so the owner's `await` dangled forever.
 */
export class JsonSocketAbortedError extends Error {
  constructor() {
    super('Connection closed before the handshake completed');
    this.name = 'JsonSocketAbortedError';
  }
}

export function isJsonSocketAborted(err: unknown): err is JsonSocketAbortedError {
  return err instanceof JsonSocketAbortedError;
}

/**
 * How {@link detachJsonSocket} settles a handshake still in flight. Keyed by the
 * socket so `detachJsonSocket` keeps taking only the socket, and weak so a
 * socket nobody holds any more takes its entry with it.
 */
const pendingHandshakes = new WeakMap<WebSocket, () => void>();

/**
 * Open a `WS_SUBPROTOCOL` websocket and wire its message/close/handshake
 * handlers, shared by `TranslateSocket` and `LiveTranslateSocket`.
 *
 * Neither class hands this its `this.socket` field: each still owns that
 * itself, because a turn socket and a live socket are never interchangeable
 * and neither gains anything from routing through the other's storage. This
 * function only owns the wiring, not the connection's lifetime — `onClosed`
 * fires when the SERVER closes the socket; a caller-initiated close (see
 * {@link detachJsonSocket}) never reaches it, exactly as before this was
 * shared.
 *
 * Returns synchronously — see {@link JsonSocketConnection}. `ready` resolves
 * once the handshake completes, and rejects with {@link JsonSocketAbortedError}
 * if the caller detaches the socket first. The handshake's own `onopen`/`onerror` must not
 * stay attached afterwards: `onerror` is still `ready`'s `reject`, which is
 * inert once settled, so a transport failure mid-conversation would be
 * swallowed instead of reported — the `.then` below is what swaps it for the
 * live error handler.
 */
export function connectJsonSocket<TEvent>(
  url: string,
  accessToken: string,
  schema: JsonEventSchema<TEvent>,
  handlers: JsonSocketHandlers<TEvent>,
  notifyClosed: NotifyJsonSocketClosed,
): JsonSocketConnection {
  const socket = new WebSocket(url, [WS_SUBPROTOCOL, accessToken]);

  socket.onmessage = (message) => {
    // A frame that is not JSON at all would throw out of the event handler,
    // which the schema check below cannot help with.
    let body: unknown;
    try {
      body = JSON.parse(String(message.data));
    } catch {
      handlers.onError?.('Unreadable frame from the server');
      return;
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      handlers.onError?.('Unexpected event shape from the server');
      return;
    }
    handlers.onEvent(parsed.data);
  };

  socket.onclose = (event) => {
    notifyClosed(socket, event.code, event.reason);
    handlers.onClosed?.(event.code, event.reason);
  };

  const ready = new Promise<void>((resolve, reject) => {
    const settled = () => pendingHandshakes.delete(socket);
    socket.onopen = () => {
      settled();
      resolve();
    };
    socket.onerror = () => {
      settled();
      reject(new Error('Cannot reach the translator'));
    };
    pendingHandshakes.set(socket, () => {
      settled();
      reject(new JsonSocketAbortedError());
    });
  }).then(() => {
    socket.onopen = null;
    socket.onerror = () => handlers.onError?.('Connection error');
  });

  return { socket, ready };
}

/**
 * Wrap a contract event in the envelope the server's `WsAdapter` dispatches on
 * and send it. Returns whether the frame actually went out.
 *
 * A closed socket is still silent — reporting it to the user mid-conversation
 * would be noise, and the close itself is already reported — but a caller may
 * need to tell "sent" from "dropped", because one of them means the audio is
 * still its responsibility. See `TurnPipeline.pushAudio`, which used to count
 * both as sent and so reported captured audio the socket never carried.
 */
export function sendJsonEvent(socket: WebSocket | null, event: { type: string }): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ event: event.type, data: event }));
  return true;
}

/**
 * Detach a socket's own handlers before closing it, so a close firing during
 * teardown is never reported as a dropped connection, then close it.
 *
 * A handshake still in flight is settled here, with {@link JsonSocketAbortedError}:
 * once its handlers are gone nothing else ever could settle it.
 */
export function detachJsonSocket(socket: WebSocket): void {
  pendingHandshakes.get(socket)?.();
  socket.onopen = null;
  socket.onclose = null;
  socket.onerror = null;
  socket.onmessage = null;
  socket.close();
}
