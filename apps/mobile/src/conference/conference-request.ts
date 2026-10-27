/**
 * Request/reply over the raw `/ws/conference` socket.
 *
 * Wire format: `{ event, data }` both ways. The gateway answers a request on the
 * same event name and carries no correlation id, so a reply can only be matched
 * by name. Two requests with the same name in flight at once would both take
 * the first reply and lose the second (a late joiner consuming audio and video
 * together would surface one track). So requests are serialised per socket and
 * event name: the next `conference.consume` goes out only after the previous
 * one's reply arrived, while different events still run side by side.
 *
 * Pure (no React Native imports), so the ordering is testable with a fake socket.
 */

/** How long a request waits for its reply, measured from when it is sent. */
const REQUEST_TIMEOUT_MS = 10_000;
/**
 * For `conference.media.*`: the server's worst case is several Cloudflare
 * calls, each with its own timeout and retry, behind the session's queue.
 * Giving up sooner would hand its late reply to the next request of the same
 * name, which takes the first reply it sees.
 */
export const SFU_REQUEST_TIMEOUT_MS = 60_000;

export interface SignalMessage {
  event: string;
  data: unknown;
}

/** The slice of a WebSocket the signaling helpers use. */
export interface SignalSocket {
  send(data: string): void;
  addEventListener(type: 'message', listener: (evt: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (evt: { data: unknown }) => void): void;
}

/** A reply the gateway refused, carrying its stable error code. */
export class ConferenceRequestError extends Error {
  readonly event: string;
  readonly code: string;

  constructor(event: string, code: string) {
    super(`${event} refused: ${code}`);
    this.name = 'ConferenceRequestError';
    this.event = event;
    this.code = code;
  }
}

export function parseSignal(raw: unknown): SignalMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SignalMessage> | null;
    if (!parsed || typeof parsed.event !== 'string') return null;
    return { event: parsed.event, data: parsed.data };
  } catch {
    return null;
  }
}

/** The gateway's error code when `data` is a refusal, else undefined. */
export function replyErrorCode(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'error' in data) {
    const code = (data as { error: unknown }).error;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export function send(ws: SignalSocket, event: string, data: unknown): void {
  ws.send(JSON.stringify({ event, data }));
}

/** Tail of each (socket, event) chain; a request waits for the one before it. */
const inFlight = new WeakMap<SignalSocket, Map<string, Promise<unknown>>>();

function sendAndAwaitReply(
  ws: SignalSocket,
  event: string,
  data: unknown,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const handler = (msg: { data: unknown }): void => {
      const parsed = parseSignal(msg.data);
      if (!parsed || parsed.event !== event) return;
      ws.removeEventListener('message', handler);
      clearTimeout(timer);
      const code = replyErrorCode(parsed.data);
      if (code) reject(new ConferenceRequestError(event, code));
      else resolve(parsed.data);
    };
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeoutMs);

    ws.addEventListener('message', handler);
    try {
      send(ws, event, data);
    } catch (err) {
      ws.removeEventListener('message', handler);
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Send `event` and resolve with the data of its reply. Waits for any earlier
 * request of the same name on the same socket to settle first. Rejects with
 * {@link ConferenceRequestError} when the reply is a refusal, and with a timeout
 * error when no reply arrives.
 */
export function request(
  ws: SignalSocket,
  event: string,
  data: unknown,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  let chains = inFlight.get(ws);
  if (!chains) {
    chains = new Map();
    inFlight.set(ws, chains);
  }
  const previous = chains.get(event) ?? Promise.resolve();
  const current = previous.then(
    () => sendAndAwaitReply(ws, event, data, timeoutMs),
    () => sendAndAwaitReply(ws, event, data, timeoutMs),
  );
  // The chain continues whether this request succeeds or fails.
  const tail = current.catch(() => undefined);
  chains.set(event, tail);
  void tail.then(() => {
    if (chains.get(event) === tail) chains.delete(event);
  });
  return current;
}
