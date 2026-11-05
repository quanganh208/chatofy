import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ranOneWayInstead, refusalMessageKey, startFailureKey } from './translate-refusal.ts';

describe('refusalMessageKey', () => {
  it('names the two Auto-detect refusals', () => {
    assert.equal(
      refusalMessageKey({ code: 'language_unavailable', detail: 'language_detection' }),
      'web.translate.detectUnavailable',
    );
    assert.equal(
      refusalMessageKey({ code: 'language_unavailable', detail: 'lid_capacity' }),
      'web.translate.detectBusy',
    );
  });

  it('leaves every other cause to the server message', () => {
    assert.equal(refusalMessageKey({ code: 'language_unavailable' }), null);
    assert.equal(refusalMessageKey({ code: 'rate_limited' }), null);
    assert.equal(refusalMessageKey(undefined), null);
  });
});

describe('ranOneWayInstead', () => {
  it('is true only when two-way was asked and the server ran it declared', () => {
    assert.equal(ranOneWayInstead(true, 'declared'), true);
    assert.equal(ranOneWayInstead(true, 'two-way'), false);
    assert.equal(ranOneWayInstead(false, 'declared'), false);
    assert.equal(ranOneWayInstead(true, null), false);
  });
});

describe('startFailureKey', () => {
  it('recognises a refused microphone permission by the recorder message', () => {
    assert.equal(
      startFailureKey('microphone permission not granted (Denied)', undefined),
      'mobile.translate.micDenied',
    );
  });

  it('prefers the server refusal and otherwise defers to the raw message', () => {
    assert.equal(
      startFailureKey('Language unavailable', {
        code: 'language_unavailable',
        detail: 'lid_capacity',
      }),
      'web.translate.detectBusy',
    );
    assert.equal(startFailureKey('socket closed', undefined), null);
    assert.equal(startFailureKey(null, undefined), null);
  });
});
