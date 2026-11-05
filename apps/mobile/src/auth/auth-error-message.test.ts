import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthRequestError } from '../clients/http-auth-client.ts';
import { authFlowFailure } from './auth-error-message.ts';

describe('authFlowFailure', () => {
  it('asks the user to wait on a throttle, in every flow', () => {
    for (const flow of ['signUp', 'forgotPassword', 'verifyEmail', 'resetPassword'] as const) {
      assert.equal(
        authFlowFailure(flow, new AuthRequestError('/x', 429)),
        'mobile.auth.tooManyAttempts',
      );
    }
  });

  it('reads a refused mailed token as an expired link', () => {
    assert.equal(
      authFlowFailure('verifyEmail', new AuthRequestError('/auth/verify-email', 401)),
      'mobile.auth.linkExpired',
    );
    assert.equal(
      authFlowFailure('resetPassword', new AuthRequestError('/auth/reset-password', 401)),
      'mobile.auth.linkExpired',
    );
  });

  it('does not call a refused sign-up or reset request an expired link', () => {
    assert.equal(
      authFlowFailure('signUp', new AuthRequestError('/x', 401)),
      'web.auth.createFailed',
    );
    assert.equal(
      authFlowFailure('forgotPassword', new AuthRequestError('/x', 500)),
      'web.auth.sendResetFailed',
    );
  });

  it('separates a timeout and an unreachable server from a refusal', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    assert.equal(authFlowFailure('signUp', abort), 'web.auth.tookTooLong');
    assert.equal(
      authFlowFailure('signUp', new TypeError('Network request failed')),
      'web.auth.serverUnreachable',
    );
    assert.equal(authFlowFailure('resetPassword', 'boom'), 'web.auth.resetFailed');
  });
});
