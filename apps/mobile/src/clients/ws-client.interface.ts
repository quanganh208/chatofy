// Scaffold for the realtime conversation feature (roadmap): no consumers yet.
// Connection states mirroring WebSocket.readyState
export type WSState = 'connecting' | 'open' | 'closing' | 'closed';

// Interface for all WebSocket clients — swap native WS for a library without touching call sites
export interface WsClient {
  connect(url: string, token?: string): void;
  send(data: string | ArrayBuffer): void;
  onMessage(callback: (data: string | ArrayBuffer) => void): () => void;
  close(): void;
  readonly state: WSState;
}
