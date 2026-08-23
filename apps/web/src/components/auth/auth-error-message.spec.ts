import { describe, expect, it } from 'vitest';
import { ApiClientError, ContractError, NetworkError } from '@chatofy/api-client';

import { authErrorMessage } from './auth-error-message';

/**
 * The guard this mapping never had.
 *
 * Four auth forms carried an identical copy of this branch chain and not one of
 * their specs exercised it — branch coverage on the four files sat at 50-65%,
 * and the uncovered lines were exactly the copies. A reworded string or a
 * dropped `else if` in one of them would have shipped with the suite green.
 *
 * Each branch is pinned here once, so the forms can be read as "map the error,
 * show the result" without four chances to disagree about what a timeout says.
 */
const FALLBACK = 'Could not do the thing. Try again.';

describe('authErrorMessage', () => {
  it("passes through the API's own message, which is written for a person", () => {
    const err = new ApiClientError(
      { code: 'VALIDATION_FAILED', message: 'That link is invalid or has expired' },
      401,
    );
    expect(authErrorMessage(err, FALLBACK)).toBe('That link is invalid or has expired');
  });

  it('reports a contract drift without leaking the detail', () => {
    const err = new ContractError({ issues: 'whatever' }, { raw: true });
    expect(authErrorMessage(err, FALLBACK)).toBe('Unexpected response from the server.');
  });

  it('tells an unreachable server apart from a slow one', () => {
    expect(authErrorMessage(new NetworkError('failed', false), FALLBACK)).toBe(
      'Cannot reach the server.',
    );
    expect(authErrorMessage(new NetworkError('timed out', true), FALLBACK)).toBe(
      'That took too long — try again.',
    );
  });

  it('falls back to the per-flow message for anything else', () => {
    expect(authErrorMessage(new Error('boom'), FALLBACK)).toBe(FALLBACK);
    // Not every throw is an Error — a rejected promise can carry anything.
    expect(authErrorMessage('a bare string', FALLBACK)).toBe(FALLBACK);
    expect(authErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });
});
