import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOSE_CODE_ENDED,
  CLOSE_CODE_REPLACED,
  chatRefusal,
  finalCloseOutcome,
  joinRefusalOutcome,
} from './conference-call-outcome.ts';

describe('joinRefusalOutcome', () => {
  it('retries transient refusals', () => {
    assert.deepEqual(joinRefusalOutcome('internal_error'), { retry: true });
    assert.deepEqual(joinRefusalOutcome('limit_reached'), { retry: true });
  });

  it('keeps a missing or ended room final, with its own reason', () => {
    assert.deepEqual(joinRefusalOutcome('room_not_found'), {
      retry: false,
      reason: 'room-not-found',
    });
    assert.deepEqual(joinRefusalOutcome('room_ended'), { retry: false, reason: 'room-ended' });
  });

  it('keeps a malformed join and unknown codes final and generic', () => {
    assert.deepEqual(joinRefusalOutcome('invalid_payload'), { retry: false, reason: 'generic' });
    assert.deepEqual(joinRefusalOutcome('something_new'), { retry: false, reason: 'generic' });
  });
});

describe('chatRefusal', () => {
  it('names a rate limit apart from every other refusal', () => {
    assert.equal(chatRefusal('limit_reached'), 'rate-limited');
    assert.equal(chatRefusal('text_too_long'), 'not-sent');
    assert.equal(chatRefusal('invalid_payload'), 'not-sent');
  });
});

describe('finalCloseOutcome', () => {
  it('treats an owner-ended meeting as final', () => {
    assert.deepEqual(finalCloseOutcome(CLOSE_CODE_ENDED), {
      status: 'error',
      reason: 'room-ended',
    });
  });

  it('treats a socket replaced by a newer join as final', () => {
    assert.deepEqual(finalCloseOutcome(CLOSE_CODE_REPLACED), {
      status: 'disconnected',
      reason: 'connection-lost',
    });
  });

  it('leaves other closes to the reconnect loop', () => {
    assert.equal(finalCloseOutcome(1006), null);
    assert.equal(finalCloseOutcome(1000), null);
  });
});
