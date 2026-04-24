// IWSClient — contract for WebSocket transport.
// NativeWSClient is the default; swap for a mock or SockJS adapter if needed.
export type WSState = 'idle' | 'connecting' | 'open' | 'closed';

export interface IWSClient {
  connect(url: string, token?: string): Promise<void>;
  send(data: string | ArrayBuffer): void;
  /** Register a message listener. Returns an unsubscribe function. */
  onMessage(cb: (event: MessageEvent) => void): () => void;
  close(): void;
  readonly state: WSState;
}
