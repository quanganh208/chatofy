import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUTH_LIMITS } from '@chatofy/types';
import { readLinkToken } from './deep-link-token.ts';

describe('readLinkToken', () => {
  it('returns a token of plausible length, trimmed', () => {
    const token = 'a'.repeat(AUTH_LIMITS.minToken);
    assert.equal(readLinkToken(`  ${token} `), token);
  });

  it('rejects a missing, repeated or out-of-bounds value', () => {
    assert.equal(readLinkToken(undefined), null);
    assert.equal(readLinkToken(['a'.repeat(AUTH_LIMITS.minToken)]), null);
    assert.equal(readLinkToken('a'.repeat(AUTH_LIMITS.minToken - 1)), null);
    assert.equal(readLinkToken('a'.repeat(AUTH_LIMITS.maxToken + 1)), null);
    assert.equal(readLinkToken(''), null);
  });
});
