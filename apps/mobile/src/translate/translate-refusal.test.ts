import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { creditErrorCopy, ranOneWayInstead, startFailureKey } from './translate-refusal.ts';

describe('ranOneWayInstead', () => {
  it('is true only when two-way was asked and the server ran it declared', () => {
    assert.equal(ranOneWayInstead(true, 'declared'), true);
    assert.equal(ranOneWayInstead(true, 'two-way'), false);
    assert.equal(ranOneWayInstead(false, 'declared'), false);
    assert.equal(ranOneWayInstead(true, null), false);
  });
});

describe('startFailureKey', () => {
  const failedStart = (thrown: unknown) => ({
    source: 'client' as const,
    code: 'start_failed',
    thrown,
  });

  it('recognises a refused microphone permission by the recorder message', () => {
    const message = 'microphone permission not granted (Denied)';
    assert.equal(
      startFailureKey(message, failedStart(new Error(message))),
      'mobile.translate.micDenied',
    );
  });

  it('names the two Auto-detect refusals', () => {
    assert.equal(
      startFailureKey('Language detection is unavailable', {
        source: 'server',
        code: 'language_unavailable',
        detail: 'language_detection',
      }),
      'web.translate.detectUnavailable',
    );
    assert.equal(
      startFailureKey('busy', {
        source: 'server',
        code: 'language_unavailable',
        detail: 'lid_capacity',
      }),
      'web.translate.detectBusy',
    );
  });

  it('words every other failure by its code, never by its English message', () => {
    assert.equal(
      startFailureKey('Translation failed', { source: 'server', code: 'turn_failed' }),
      'common.realtime.turnFailed',
    );
    assert.equal(
      startFailureKey('Cannot reach the translator', {
        source: 'client',
        code: 'connection_failed',
      }),
      'common.realtime.unreachable',
    );
    assert.equal(
      startFailureKey('AudioContext refused', failedStart(new Error('AudioContext refused'))),
      'common.realtime.startFailed',
    );
    assert.equal(
      startFailureKey('Something new', { source: 'server', code: 'a_code_added_later' }),
      'common.realtime.generic',
    );
    assert.equal(startFailureKey('socket closed', undefined), 'common.realtime.generic');
  });
});

describe('creditErrorCopy', () => {
  const opened = { turnOpened: true };
  const refusedAtStart = { turnOpened: false };

  it('says a refused start apart from a conversation that ran out', () => {
    assert.deepEqual(
      creditErrorCopy({ source: 'server', code: 'credits_exhausted' }, refusedAtStart),
      {
        key: 'common.billing.startRefused',
        notice: false,
      },
    );
    assert.deepEqual(creditErrorCopy({ source: 'server', code: 'credits_exhausted' }, opened), {
      key: 'common.billing.exhausted',
      notice: false,
    });
  });

  it('names a balance that could not be checked as a failure', () => {
    assert.deepEqual(creditErrorCopy({ source: 'server', code: 'credits_unavailable' }, opened), {
      key: 'common.billing.unavailable',
      notice: false,
    });
  });

  it('turns a low balance into a notice carrying the amount in credits', () => {
    assert.deepEqual(
      creditErrorCopy(
        { source: 'server', code: 'credits_low', remainingCreditSeconds: 120 },
        opened,
      ),
      {
        key: 'common.billing.low',
        amount: { key: 'common.billing.creditAmount', vars: { credits: '2' } },
        notice: true,
      },
    );
    assert.deepEqual(
      creditErrorCopy({ source: 'server', code: 'credits_low', remainingCreditSeconds: 60 }, opened)
        ?.amount,
      { key: 'common.billing.creditAmountOne' },
    );
  });

  it('still says a low balance with no figure, as a notice', () => {
    assert.deepEqual(creditErrorCopy({ source: 'server', code: 'credits_low' }, opened), {
      key: 'common.billing.lowUnknown',
      notice: true,
    });
  });

  it('leaves every other cause to the caller', () => {
    assert.equal(creditErrorCopy({ source: 'server', code: 'rate_limited' }, opened), null);
    assert.equal(creditErrorCopy(undefined, opened), null);
  });
});
