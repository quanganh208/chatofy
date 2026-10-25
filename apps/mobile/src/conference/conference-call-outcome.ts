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

/** Map a `conference.join` refusal code to the reason the call screen shows. */
export function joinErrorReason(code: string): ConferenceErrorReason {
  switch (code) {
    case 'room_not_found':
      return 'room-not-found';
    case 'room_ended':
      return 'room-ended';
    default:
      return 'generic';
  }
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
