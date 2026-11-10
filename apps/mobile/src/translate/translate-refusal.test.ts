import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  creditErrorCopy,
  ranOneWayInstead,
  refusalMessageKey,
  startFailureKey,
} from './translate-refusal.ts';

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

describe('creditErrorCopy', () => {
  const opened = { turnOpened: true };
  const refusedAtStart = { turnOpened: false };

  it('says a refused start apart from a conversation that ran out', () => {
    assert.deepEqual(creditErrorCopy({ code: 'credits_exhausted' }, refusedAtStart), {
      key: 'common.billing.startRefused',
      notice: false,
    });
    assert.deepEqual(creditErrorCopy({ code: 'credits_exhausted' }, opened), {
      key: 'common.billing.exhausted',
      notice: false,
    });
  });

  it('names a balance that could not be checked as a failure', () => {
    assert.deepEqual(creditErrorCopy({ code: 'credits_unavailable' }, opened), {
      key: 'common.billing.unavailable',
      notice: false,
    });
  });

  it('turns a low balance into a notice carrying the amount in credits', () => {
    assert.deepEqual(
      creditErrorCopy({ code: 'credits_low', remainingCreditSeconds: 120 }, opened),
      {
        key: 'common.billing.low',
        amount: { key: 'common.billing.creditAmount', vars: { credits: '2' } },
        notice: true,
      },
    );
    assert.deepEqual(
      creditErrorCopy({ code: 'credits_low', remainingCreditSeconds: 60 }, opened)?.amount,
      { key: 'common.billing.creditAmountOne' },
    );
  });

  it('leaves a low balance with no figure, and every other cause, to the caller', () => {
    assert.equal(creditErrorCopy({ code: 'credits_low' }, opened), null);
    assert.equal(creditErrorCopy({ code: 'rate_limited' }, opened), null);
    assert.equal(creditErrorCopy(undefined, opened), null);
  });
});
