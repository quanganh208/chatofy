/**
 * What a closed socket or a refused join means for the call: retry, or stop
 * and say why. Pure, so the policy is testable without a socket.
 */
import type { ConferenceErrorReason } from './conference-types';

/** Maximum number of automatic reconnect attempts before giving up. */
export const RECONNECT_CAP = 3;
/** Backoff delays (ms) indexed by attempt number (0-based). */
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000] as const;

/** The gateway evicted this socket because the same account rejoined the room. */
export const CLOSE_CODE_REPLACED = 4000;
/** The gateway closed the room: its owner ended the meeting. */
export const CLOSE_CODE_ENDED = 4001;

export type CloseOutcome =
  | { kind: 'reconnect'; attempt: number; delayMs: number }
  | { kind: 'stop'; reason: ConferenceErrorReason };

/**
 * Decide what an unexpected close leads to.
 *
 * 4000 and 4001 are the server saying "do not come back": reconnecting after a
 * replacement would evict the newer socket in turn, and an ended room refuses
 * every join. Anything else is a network fault and earns a bounded retry.
 */
export function closeOutcome(code: number, attemptsMade: number): CloseOutcome {
  if (code === CLOSE_CODE_REPLACED) return { kind: 'stop', reason: 'replaced' };
  if (code === CLOSE_CODE_ENDED) return { kind: 'stop', reason: 'room-ended' };
  const attempt = attemptsMade + 1;
  if (attempt > RECONNECT_CAP) return { kind: 'stop', reason: 'connection-lost' };
  const delayMs = RECONNECT_BACKOFF_MS[attempt - 1] ?? RECONNECT_BACKOFF_MS[2];
  return { kind: 'reconnect', attempt, delayMs };
}

/**
 * What a refused join leads to.
 *
 * `internal_error` and `limit_reached` are the server saying "not now": it
 * answers `internal_error` while a crashed media worker respawns (the very
 * case its 1011 close sends every client back to reconnect for) or the
 * database blips, and a full room can free a seat. Those are retried within
 * the reconnect backoff and cap like a dropped socket. Everything else — an
 * unknown or ended room, a payload it cannot accept — would be refused again,
 * so it stops.
 */
export type JoinRefusalOutcome =
  { kind: 'retry' } | { kind: 'stop'; reason: ConferenceErrorReason };

const RETRYABLE_JOIN_REFUSALS = new Set(['internal_error', 'limit_reached']);

export function joinRefusalOutcome(code: string): JoinRefusalOutcome {
  if (RETRYABLE_JOIN_REFUSALS.has(code)) return { kind: 'retry' };
  if (code === 'room_not_found') return { kind: 'stop', reason: 'room-not-found' };
  if (code === 'room_ended') return { kind: 'stop', reason: 'room-ended' };
  return { kind: 'stop', reason: 'generic' };
}
