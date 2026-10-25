import { describe, expect, it } from 'vitest';
import {
  CLOSE_CODE_ENDED,
  CLOSE_CODE_REPLACED,
  RECONNECT_CAP,
  closeOutcome,
  joinRefusalReason,
} from './conference-connection-policy';

describe('closeOutcome', () => {
  it('never reconnects a socket the server replaced', () => {
    expect(closeOutcome(CLOSE_CODE_REPLACED, 0)).toEqual({ kind: 'stop', reason: 'replaced' });
  });

  it('never reconnects to a room its owner ended', () => {
    expect(closeOutcome(CLOSE_CODE_ENDED, 0)).toEqual({ kind: 'stop', reason: 'room-ended' });
  });

  it('retries a network drop with a growing backoff, up to the cap', () => {
    expect(closeOutcome(1006, 0)).toEqual({ kind: 'reconnect', attempt: 1, delayMs: 1000 });
    expect(closeOutcome(1006, 1)).toEqual({ kind: 'reconnect', attempt: 2, delayMs: 2000 });
    expect(closeOutcome(1006, 2)).toEqual({ kind: 'reconnect', attempt: 3, delayMs: 4000 });
    expect(closeOutcome(1006, RECONNECT_CAP)).toEqual({
      kind: 'stop',
      reason: 'connection-lost',
    });
  });
});

describe('joinRefusalReason', () => {
  it('names the two refusals the screen explains', () => {
    expect(joinRefusalReason('room_not_found')).toBe('room-not-found');
    expect(joinRefusalReason('room_ended')).toBe('room-ended');
  });

  it('reads any other refusal as a generic failure', () => {
    expect(joinRefusalReason('limit_reached')).toBe('generic');
  });
});
