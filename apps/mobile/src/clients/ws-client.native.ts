import type { WsClient, WSState } from './ws-client.interface';

type MessageCallback = (data: string | ArrayBuffer) => void;

// Default WebSocket client using the React Native global WebSocket
export class NativeWSClient implements WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<MessageCallback>();

  get state(): WSState {
    if (!this.ws) return 'closed';
    const map: Record<number, WSState> = {
      0: 'connecting',
      1: 'open',
      2: 'closing',
      3: 'closed',
    };
    return map[this.ws.readyState] ?? 'closed';
  }

  connect(url: string, token?: string): void {
    // Reconnect-safe: tear down any previous socket so it cannot leak or keep
    // feeding listeners after being replaced. Detach its handlers first —
    // buffered frames from the dying socket must not interleave with the new
    // socket's messages.
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
    }

    const fullUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;
    const ws = new WebSocket(fullUrl);
    this.ws = ws;

    ws.onmessage = (event) => {
      const data = event.data as string | ArrayBuffer;
      this.listeners.forEach((cb) => cb(data));
    };

    ws.onerror = (event) => {
      console.error('[NativeWSClient] error', event);
    };

    ws.onclose = () => {
      // Only clear if this socket is still the active one — a newer connect()
      // may already have replaced it.
      if (this.ws === ws) this.ws = null;
    };
  }

  send(data: string | ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.ws.send(data);
  }

  // Returns an unsubscribe function
  onMessage(callback: MessageCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
  }
}
