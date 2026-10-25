/**
 * How the call ends: which gateway refusals and socket close codes are final,
 * and the reason the call screen shows for each. Pure, so the no-retry rules
 * are testable without a socket.
 */

/**
 * Machine-readable reason attached to `status === 'error'` or `'disconnected'`.
 * Same vocabulary as web so the call screen can branch identically.
 */
export type ConferenceErrorReason =
  | 'permission-denied'
  | 'audio-only'
  | 'not-authenticated'
  | 'room-not-found'
  | 'room-ended'
  | 'connection-lost'
  | 'generic';

/** The gateway closed this socket because the same user joined again elsewhere. */
export const CLOSE_CODE_REPLACED = 4000;
/** The gateway closed this socket because the room's owner ended the meeting. */
export const CLOSE_CODE_ENDED = 4001;

/**
 * What a `conference.join` refusal means for the call. `internal_error` (the SFU
 * worker respawning, a database blip) and `limit_reached` are transient: the
 * join is retried within the reconnect backoff and cap. A missing or ended room
 * and a malformed join are final, as is any code this client does not know.
 */
export type JoinRefusalOutcome = { retry: true } | { retry: false; reason: ConferenceErrorReason };

const RETRYABLE_JOIN_REFUSALS: ReadonlySet<string> = new Set(['internal_error', 'limit_reached']);

export function joinRefusalOutcome(code: string): JoinRefusalOutcome {
  if (RETRYABLE_JOIN_REFUSALS.has(code)) return { retry: true };
  switch (code) {
    case 'room_not_found':
      return { retry: false, reason: 'room-not-found' };
    case 'room_ended':
      return { retry: false, reason: 'room-ended' };
    default:
      return { retry: false, reason: 'generic' };
  }
}

/** Which chat-panel notice a refused `conference.chat` shows. */
export type ChatRefusal = 'rate-limited' | 'not-sent';

export function chatRefusal(code: string): ChatRefusal {
  return code === 'limit_reached' ? 'rate-limited' : 'not-sent';
}

export interface FinalClose {
  status: 'error' | 'disconnected';
  reason: ConferenceErrorReason;
}

/**
 * A close the client must NOT retry, with what to show; `null` means the drop is
 * unexpected and the bounded reconnect applies. A meeting the owner ended and a
 * socket replaced by the same user's newer one are both final — reconnecting
 * would rejoin a dead room or evict the newer session in turn.
 */
export function finalCloseOutcome(code: number): FinalClose | null {
  if (code === CLOSE_CODE_ENDED) return { status: 'error', reason: 'room-ended' };
  if (code === CLOSE_CODE_REPLACED) return { status: 'disconnected', reason: 'connection-lost' };
  return null;
}
