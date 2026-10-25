/**
 * The public shapes of a conference call, shared by the hook, the connection
 * that drives it, and the in-call components.
 */
import type { ConferenceChatMessage } from '@chatofy/types/events';

export type { ConferenceChatMessage };

export type ConferenceStatus =
  'idle' | 'connecting' | 'in-call' | 'error' | 'disconnected' | 'reconnecting';

/**
 * Machine-readable reason attached to `status === 'error'` or `'disconnected'`.
 *
 * - `'permission-denied'` — the microphone could not be opened; nothing to join with.
 * - `'audio-only'` — the camera was refused or absent; the call runs with audio.
 *   A soft notice on an `in-call` status, never an error.
 * - `'not-authenticated'` — no access token in the session.
 * - `'room-not-found'` — the id names no room. Never retried.
 * - `'room-ended'` — the owner ended the meeting, before or during the call. Never retried.
 * - `'replaced'` — the same account joined this room again elsewhere and this
 *   socket was closed in its favour. Never retried: reconnecting would evict the newer one.
 * - `'connection-lost'` — the socket dropped and every reconnect attempt failed.
 * - `'generic'` — any other failure while joining.
 */
export type ConferenceErrorReason =
  | 'permission-denied'
  | 'audio-only'
  | 'not-authenticated'
  | 'room-not-found'
  | 'room-ended'
  | 'replaced'
  | 'connection-lost'
  | 'generic';

export interface PeerState {
  displayName: string;
  stream: MediaStream;
  /** Latest subtitle text for this peer; undefined when none active. */
  subtitle: string | undefined;
  muted: boolean;
  videoEnabled: boolean;
}

export type PeerMap = Map<string, PeerState>;

/**
 * What a connection reports back to whoever renders it. Every member is a
 * plain sink, so a React state setter can be passed straight in.
 */
export interface ConferenceSink {
  status(status: ConferenceStatus, reason?: ConferenceErrorReason): void;
  reconnectAttempt(attempt: number): void;
  selfSocketId(socketId: string | null): void;
  localStream(stream: MediaStream | null): void;
  peers(update: (prev: PeerMap) => PeerMap): void;
  audioBlocked(blocked: boolean): void;
  translating(active: boolean): void;
  chat(message: ConferenceChatMessage): void;
  /** The session has no access token; the caller decides where to send the user. */
  unauthenticated(): void;
}
