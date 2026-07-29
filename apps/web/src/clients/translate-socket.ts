import {
  serverEventSchema,
  type ClientEvent,
  type ServerEvent,
  type SessionOptions,
} from '@chatofy/types';
import { env } from '@/config/env';

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

/** `http(s)://host` → `ws(s)://host/ws/translate`. */
function socketUrl(): string {
  const base = new URL(env.NEXT_PUBLIC_API_BASE_URL);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/ws/translate';
  return base.toString();
}

export interface TranslateSocketHandlers {
  onEvent: (event: ServerEvent) => void;
  onClosed?: () => void;
  onError?: (message: string) => void;
}

export class TranslateSocket {
  private socket: WebSocket | null = null;

  constructor(private readonly handlers: TranslateSocketHandlers) {}

  private get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Connect and resolve once the socket is usable. */
  async connect(): Promise<void> {
    this.close();

    const socket = new WebSocket(socketUrl());
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

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.handlers.onClosed?.();
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

  /** Wrap a contract event in the envelope the adapter dispatches on. */
  send(event: ClientEvent): void {
    if (!this.isOpen) return;
    this.socket?.send(JSON.stringify({ event: event.type, data: event }));
  }

  startSession(options: SessionOptions): void {
    this.send({ type: 'client.session.start', ...options });
  }

  sendAudio(sessionId: string, sequence: number, sampleRate: number, payload: string): void {
    this.send({
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

  /** Tell the server the speaker has probably stopped; nothing comes back. */
  speculate(): void {
    this.send({ type: 'client.turn.speculate' });
  }

  endSession(): void {
    this.send({ type: 'client.session.end' });
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
