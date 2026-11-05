import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthRequestError } from '../clients/http-auth-client.ts';
import { clientIdFor, googleFailureMessage, readGoogleResponse } from './google-sign-in.ts';

describe('clientIdFor', () => {
  const ids = { ios: ' ios-id ', android: '' };

  it('picks the id for the platform and trims it', () => {
    assert.equal(clientIdFor('ios', ids), 'ios-id');
    assert.equal(clientIdFor('web', ids), undefined);
  });

  it('treats a blank id as not configured', () => {
    assert.equal(clientIdFor('android', ids), undefined);
    assert.equal(clientIdFor('ios', {}), undefined);
  });
});

describe('readGoogleResponse', () => {
  it('reads the id_token from a success', () => {
    assert.deepEqual(readGoogleResponse({ type: 'success', params: { id_token: 'tok' } }), {
      kind: 'idToken',
      idToken: 'tok',
    });
  });

  it('calls a success without a token a failure', () => {
    assert.deepEqual(readGoogleResponse({ type: 'success', params: {} }), { kind: 'failed' });
  });

  it('treats closing the sheet as a quiet cancel, and an error as a failure', () => {
    assert.deepEqual(readGoogleResponse({ type: 'dismiss' }), { kind: 'cancelled' });
    assert.deepEqual(readGoogleResponse({ type: 'cancel' }), { kind: 'cancelled' });
    assert.deepEqual(readGoogleResponse({ type: 'error' }), { kind: 'failed' });
    assert.deepEqual(readGoogleResponse(null), { kind: 'idle' });
  });
});

describe('googleFailureMessage', () => {
  it('names a refused account, a throttle, and a server that cannot do it', () => {
    assert.equal(
      googleFailureMessage(new AuthRequestError('/auth/google', 401)),
      'web.auth.googleRefused',
    );
    assert.equal(
      googleFailureMessage(new AuthRequestError('/auth/google', 429)),
      'mobile.auth.tooManyAttempts',
    );
    assert.equal(
      googleFailureMessage(new AuthRequestError('/auth/google', 501)),
      'web.auth.signInUnavailable',
    );
    assert.equal(googleFailureMessage(new TypeError('x')), 'web.auth.serverUnreachable');
  });
});
