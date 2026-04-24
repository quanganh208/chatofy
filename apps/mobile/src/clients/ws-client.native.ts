import type { IWSClient, WSState } from './ws-client.interface';

type MessageCallback = (data: string | ArrayBuffer) => void;

// Default WebSocket client using the React Native global WebSocket
export class NativeWSClient implements IWSClient {
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
    const fullUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;
    this.ws = new WebSocket(fullUrl);

    this.ws.onmessage = (event) => {
      const data = event.data as string | ArrayBuffer;
      this.listeners.forEach((cb) => cb(data));
    };

    this.ws.onerror = (event) => {
      console.error('[NativeWSClient] error', event);
    };
  }

  send(data: string | ArrayBufferLike): void {
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
