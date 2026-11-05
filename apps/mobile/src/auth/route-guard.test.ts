import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appGuardRedirect, entryRedirect, safeNextPath } from './route-guard.ts';

describe('safeNextPath', () => {
  it('keeps an in-app path', () => {
    assert.equal(safeNextPath('/history', '/translate'), '/history');
  });

  it('falls back for absolute, protocol-relative, backslash and missing values', () => {
    assert.equal(safeNextPath('https://evil.test', '/translate'), '/translate');
    assert.equal(safeNextPath('//evil.test', '/translate'), '/translate');
    assert.equal(safeNextPath('/\\evil.test', '/translate'), '/translate');
    assert.equal(safeNextPath(undefined, '/translate'), '/translate');
    assert.equal(safeNextPath(['/a'], '/translate'), '/translate');
  });
});

describe('appGuardRedirect', () => {
  it('waits while the session loads', () => {
    assert.equal(
      appGuardRedirect({ isLoading: true, signedIn: false, pathname: '/history' }),
      null,
    );
  });

  it('lets a signed-in user through', () => {
    assert.equal(
      appGuardRedirect({ isLoading: false, signedIn: true, pathname: '/history' }),
      null,
    );
  });

  it('sends a signed-out user to sign-in and remembers where they were going', () => {
    assert.equal(
      appGuardRedirect({ isLoading: false, signedIn: false, pathname: '/conference/abc' }),
      '/sign-in?next=%2Fconference%2Fabc',
    );
  });
});

describe('entryRedirect', () => {
  it('picks the destination from the session', () => {
    assert.equal(entryRedirect(true), '/translate');
    assert.equal(entryRedirect(false), '/sign-in');
  });
});
