import { describe, expect, it } from 'vitest';
import {
  CLOSE_CODE_ENDED,
  CLOSE_CODE_REPLACED,
  RECONNECT_CAP,
  closeOutcome,
  joinRefusalOutcome,
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

describe('joinRefusalOutcome', () => {
  it('stops for a room that does not exist or has ended, with the reason the screen explains', () => {
    expect(joinRefusalOutcome('room_not_found')).toEqual({
      kind: 'stop',
      reason: 'room-not-found',
    });
    expect(joinRefusalOutcome('room_ended')).toEqual({ kind: 'stop', reason: 'room-ended' });
  });

  it('stops for a payload the server cannot accept, which no retry changes', () => {
    expect(joinRefusalOutcome('invalid_payload')).toEqual({ kind: 'stop', reason: 'generic' });
  });

  it('retries a refusal the server may lift: a respawning worker or a full room', () => {
    expect(joinRefusalOutcome('internal_error')).toEqual({ kind: 'retry' });
    expect(joinRefusalOutcome('limit_reached')).toEqual({ kind: 'retry' });
  });
});
