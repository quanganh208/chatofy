import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOSE_CODE_ENDED,
  CLOSE_CODE_REPLACED,
  finalCloseOutcome,
  joinErrorReason,
} from './conference-call-outcome.ts';

describe('joinErrorReason', () => {
  it('maps the room lifecycle refusals to their own reasons', () => {
    assert.equal(joinErrorReason('room_not_found'), 'room-not-found');
    assert.equal(joinErrorReason('room_ended'), 'room-ended');
  });

  it('maps every other code to the generic reason', () => {
    assert.equal(joinErrorReason('invalid_payload'), 'generic');
    assert.equal(joinErrorReason('internal_error'), 'generic');
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
