import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AuthRequestError } from '../clients/http-auth-client.ts';
import {
  clientIdFor,
  finishGoogleSignIn,
  googleFailureMessage,
  readGoogleResponse,
} from './google-sign-in.ts';

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
  it('reads the authorization code from a success', () => {
    assert.deepEqual(readGoogleResponse({ type: 'success', params: { code: 'c', state: 's' } }), {
      kind: 'code',
      code: 'c',
    });
  });

  it('calls a success without a code a failure', () => {
    assert.deepEqual(readGoogleResponse({ type: 'success', params: {} }), { kind: 'failed' });
  });

  it('treats closing the sheet as a quiet cancel, and an error as a failure', () => {
    assert.deepEqual(readGoogleResponse({ type: 'dismiss' }), { kind: 'cancelled' });
    assert.deepEqual(readGoogleResponse({ type: 'cancel' }), { kind: 'cancelled' });
    assert.deepEqual(readGoogleResponse({ type: 'error' }), { kind: 'failed' });
    assert.deepEqual(readGoogleResponse(null), { kind: 'idle' });
  });
});

describe('finishGoogleSignIn', () => {
  const success = { type: 'success', params: { code: 'c' } } as const;

  it('exchanges the code, then signs in with the id_token', async () => {
    const seen: string[] = [];
    const result = await finishGoogleSignIn(success, {
      exchangeCode: async (code) => {
        seen.push(`exchange:${code}`);
        return 'id-token';
      },
      signIn: async (idToken) => {
        seen.push(`signIn:${idToken}`);
      },
    });
    assert.deepEqual(result, { kind: 'signedIn' });
    assert.deepEqual(seen, ['exchange:c', 'signIn:id-token']);
  });

  it('reports an exchange that fails, and never reaches the API', async () => {
    let signedIn = false;
    const result = await finishGoogleSignIn(success, {
      exchangeCode: () => Promise.reject(new TypeError('offline')),
      signIn: async () => {
        signedIn = true;
      },
    });
    assert.deepEqual(result, { kind: 'failed', message: 'web.auth.serverUnreachable' });
    assert.equal(signedIn, false);
  });

  it('reports an exchange that returns no id_token', async () => {
    const result = await finishGoogleSignIn(success, {
      exchangeCode: async () => undefined,
      signIn: async () => {},
    });
    assert.deepEqual(result, { kind: 'failed', message: 'web.auth.signInUnavailable' });
  });

  it('words a refusal from the API', async () => {
    const result = await finishGoogleSignIn(success, {
      exchangeCode: async () => 'id-token',
      signIn: () => Promise.reject(new AuthRequestError('/auth/google', 401)),
    });
    assert.deepEqual(result, { kind: 'failed', message: 'web.auth.googleRefused' });
  });

  it('stays quiet when the sheet is closed, and exchanges nothing', async () => {
    const result = await finishGoogleSignIn(
      { type: 'dismiss' },
      {
        exchangeCode: () => assert.fail('nothing to exchange'),
        signIn: () => assert.fail('nothing to sign in with'),
      },
    );
    assert.deepEqual(result, { kind: 'none' });
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
