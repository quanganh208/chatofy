/**
 * The subset of a `ws` WebSocket this service drives.
 *
 * Kept structural rather than importing `ws`: the state machine only ever
 * pushes serialized events, so a test can supply a two-line fake instead of
 * standing up a socket.
 */
export interface StreamSocket {
  send(data: string): void;
}
