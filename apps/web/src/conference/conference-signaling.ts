/**
 * Request/reply helpers over the `/ws/conference` socket.
 *
 * Every message is `{ event, data }`. The gateway answers a request on the SAME
 * event name, and a refusal is `{ error: <ConferenceErrorCode> }` — so a reply
 * carrying `error` rejects here with that code rather than resolving into a
 * caller that would treat it as data.
 */

const REQUEST_TIMEOUT_MS = 10_000;
/**
 * For `conference.media.*`: the server's worst case is several Cloudflare
 * calls, each with its own timeout and retry, behind the session's queue.
 * Giving up sooner would leave its late reply to the next request of the same
 * name, which takes the first reply it sees.
 */
export const SFU_REQUEST_TIMEOUT_MS = 60_000;

export interface SignalMessage {
  event: string;
  data: unknown;
}

/** A gateway refusal, carrying its stable error code. */
export class ConferenceRequestError extends Error {
  constructor(
    readonly event: string,
    readonly code: string,
  ) {
    super(`${event} refused: ${code}`);
    this.name = 'ConferenceRequestError';
  }
}

/** One frame off the socket, or null when it is not a `{ event, data }` object. */
export function parseSignal(raw: unknown): SignalMessage | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { event, data } = parsed as { event?: unknown; data?: unknown };
  return typeof event === 'string' ? { event, data } : null;
}

function errorCodeOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const { error } = data as { error?: unknown };
  return typeof error === 'string' ? error : undefined;
}

export function send(ws: WebSocket, event: string, data: unknown): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ event, data }));
}

/**
 * Send `event` and resolve with the first reply of the same name.
 *
 * The listener is attached BEFORE the send, so a reply can never arrive in a
 * window with nothing listening for it.
 */
export function request(
  ws: WebSocket,
  event: string,
  data: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
    };
    const onMessage = (msg: MessageEvent) => {
      const signal = parseSignal(msg.data);
      if (signal?.event !== event) return;
      finish();
      const code = errorCodeOf(signal.data);
      if (code !== undefined) reject(new ConferenceRequestError(event, code));
      else resolve(signal.data);
    };
    const onClose = () => {
      finish();
      reject(new Error(`socket closed waiting for ${event}`));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
    send(ws, event, data);
  });
}
