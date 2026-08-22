import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { WS_SUBPROTOCOL, type LiveServerEvent } from '@chatofy/types';
import { LiveTranslateSocket, liveTranslateSocketUrl } from './live-translate-socket.js';

/**
 * What `close()` has to guarantee, and why anything depends on it.
 *
 * A caller that ends one conversation and immediately starts another has, for a
 * few seconds, two of them: `stop()` deliberately leaves the first socket open
 * so translated audio still trailing the speaker can play out. The rule that
 * keeps those two apart is that a CLOSED socket delivers nothing — no event, no
 * close notification, ever again.
 *
 * When that rule was only assumed, the web hook tore the microphone out of the
 * new conversation on the old one's `server.live.ended`. So the guarantee is
 * asserted here rather than read off the implementation: it is the transport's
 * to keep, and the layers above are written as though it already is.
 */

/** A socket whose inbound events are driven by the test, not by a network. */
class FakeWebSocket {
  static readonly OPEN = 1;
  static last: FakeWebSocket | null = null;

  readyState = FakeWebSocket.OPEN;
  closed = 0;
  readonly sent: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    FakeWebSocket.last = this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed += 1;
  }

  /** Deliver an inbound frame the way a real socket would — through `onmessage`. */
  deliver(body: unknown): void {
    this.onmessage?.({ data: JSON.stringify(body) });
  }

  /**
   * The remote hung up. Routed through `onclose`, as a real socket does.
   * 1006 is a browser's abnormal close with no close frame — a plain drop.
   */
  hangUp(code = 1006, reason = ''): void {
    this.onclose?.({ code, reason });
  }
}

interface Recorded {
  events: LiveServerEvent[];
  errors: string[];
  closes: number;
  closeCodes: number[];
}

/** A connected socket, plus everything its handlers were told. */
async function connected(): Promise<{
  socket: LiveTranslateSocket;
  wire: FakeWebSocket;
  seen: Recorded;
}> {
  const seen: Recorded = { events: [], errors: [], closes: 0, closeCodes: [] };
  const socket = new LiveTranslateSocket(
    'ws://api.test/ws/translate',
    {
      onEvent: (event) => seen.events.push(event),
      onError: (message) => seen.errors.push(message),
      onClosed: (code) => {
        seen.closes += 1;
        seen.closeCodes.push(code);
      },
    },
    ACCESS_TOKEN,
  );

  const connecting = socket.connect();
  // The handshake resolves on `onopen`, which only the test can fire here.
  FakeWebSocket.last!.onopen?.();
  await connecting;

  return { socket, wire: FakeWebSocket.last!, seen };
}

const ACCESS_TOKEN = 'an.access.token';

const READY = { type: 'server.live.ready', sessionId: 's1' } as const;

describe('LiveTranslateSocket', () => {
  const realWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    FakeWebSocket.last = null;
    (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    (globalThis as { WebSocket: unknown }).WebSocket = realWebSocket;
  });

  it('derives the ws URL from an http base without changing the path', () => {
    expect(liveTranslateSocketUrl('https://api.example.com')).toBe(
      'wss://api.example.com/ws/translate',
    );
    expect(liveTranslateSocketUrl('http://localhost:3001')).toBe(
      'ws://localhost:3001/ws/translate',
    );
  });

  it('reports contract events to the caller once connected', async () => {
    const { wire, seen } = await connected();

    wire.deliver(READY);

    expect(seen.events).toEqual([READY]);
  });

  /**
   * The guarantee the whole teardown story rests on. A conversation that has
   * been disposed must not be able to speak again — its late `server.live.ended`
   * is exactly the event that used to reach a listener now belonging to a
   * DIFFERENT conversation.
   */
  it('delivers nothing after close, however late the server is', async () => {
    const { socket, wire, seen } = await connected();

    socket.close();
    wire.deliver({ type: 'server.live.ended', sessionId: 's1', reason: 'client_stopped' });
    wire.deliver(READY);

    expect(seen.events).toEqual([]);
    expect(wire.closed).toBe(1);
  });

  /** Same rule for the close notification: a socket we closed says nothing back. */
  it('does not report a close the caller asked for', async () => {
    const { socket, wire, seen } = await connected();

    socket.close();
    wire.hangUp();

    expect(seen.closes).toBe(0);
  });

  /** A close the caller did NOT ask for still has to reach it. */
  it('reports a close the remote initiated', async () => {
    const { wire, seen } = await connected();

    wire.hangUp();

    expect(seen.closes).toBe(1);
  });

  it('refuses to send once closed rather than throwing', async () => {
    const { socket, wire } = await connected();

    socket.close();
    socket.stop();

    expect(wire.sent).toEqual([]);
  });

  /**
   * An event the server should never have sent is reported as a shape problem,
   * not delivered. The server clamps its error text to the contract's bound for
   * exactly this reason — past it, the fault would be replaced by this
   * complaint about the shape of the fault.
   */
  it('rejects a frame that breaks the contract instead of passing it up', async () => {
    const { wire, seen } = await connected();

    wire.deliver({
      type: 'server.live.error',
      code: 'upstream_error',
      message: 'x'.repeat(501),
    });

    expect(seen.events).toEqual([]);
    expect(seen.errors).toEqual(['Unexpected event shape from the server']);
  });

  it('reports an unreadable frame without taking the socket down', async () => {
    const { wire, seen } = await connected();

    wire.onmessage?.({ data: 'not json' });
    wire.deliver(READY);

    expect(seen.errors).toEqual(['Unreadable frame from the server']);
    // Still live: one bad frame is not a reason to stop listening.
    expect(seen.events).toEqual([READY]);
  });

  it('offers the protocol name and the token as subprotocols, never on the url', async () => {
    // A URL-borne credential lands in server and proxy access logs; the
    // handshake header does not.
    const { wire } = await connected();
    expect(wire.protocols).toEqual([WS_SUBPROTOCOL, ACCESS_TOKEN]);
    expect(wire.url).not.toContain(ACCESS_TOKEN);
  });

  it('reports the close code, so a deliberate server close is not a mystery drop', async () => {
    const { wire, seen } = await connected();
    wire.hangUp(4001, 'gone');
    expect(seen.closeCodes).toEqual([4001]);
  });
});
