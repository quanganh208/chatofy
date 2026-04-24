// NativeWSClient — IWSClient backed by the global WebSocket available in React Native.
// Supports multiple message listeners via a simple registry.
import type { IWSClient, WSState } from './ws-client.interface';

export class NativeWSClient implements IWSClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<(event: MessageEvent) => void>();
  private _state: WSState = 'idle';

  get state(): WSState {
    return this._state;
  }

  connect(url: string, token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this._state = 'connecting';

      // Append token as query param if provided (avoids custom header limitations in RN WS)
      const fullUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;
      this.socket = new WebSocket(fullUrl);

      this.socket.onopen = () => {
        this._state = 'open';
        resolve();
      };

      this.socket.onerror = (event) => {
        this._state = 'closed';
        reject(new Error(`WebSocket error: ${JSON.stringify(event)}`));
      };

      this.socket.onclose = () => {
        this._state = 'closed';
      };

      this.socket.onmessage = (event: MessageEvent) => {
        this.listeners.forEach((cb) => cb(event));
      };
    });
  }

  send(data: string | ArrayBuffer): void {
    if (!this.socket || this._state !== 'open') {
      throw new Error('NativeWSClient: cannot send — socket is not open');
    }
    this.socket.send(data);
  }

  onMessage(cb: (event: MessageEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close(): void {
    this.socket?.close();
    this._state = 'closed';
    this.listeners.clear();
  }
}
