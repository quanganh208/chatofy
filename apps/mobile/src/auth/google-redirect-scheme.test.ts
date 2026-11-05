import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { googleIosRedirectScheme } from './google-redirect-scheme.ts';

describe('googleIosRedirectScheme', () => {
  it('reverses the client id', () => {
    assert.equal(
      googleIosRedirectScheme('123-abc.apps.googleusercontent.com'),
      'com.googleusercontent.apps.123-abc',
    );
  });

  it('refuses anything that is not a Google client id', () => {
    assert.equal(googleIosRedirectScheme(undefined), null);
    assert.equal(googleIosRedirectScheme('nonsense'), null);
    assert.equal(googleIosRedirectScheme('.apps.googleusercontent.com'), null);
  });
});
