import { describe, expect, it } from 'vitest';
import { ApiClientError, ContractError, NetworkError } from '@chatofy/api-client';
import { createTranslator, en, vi } from '@chatofy/i18n';

import { authErrorMessage, authSuccessMessage } from './auth-error-message';

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
 *
 * The expectations come FROM the dictionary rather than restating it. A spec that
 * hard-coded "Cannot reach the server." would fail on a copy edit that was perfectly
 * correct, which teaches people to update the spec without reading it — and it would
 * pass in a locale where the string had never been written.
 */
const t = createTranslator(en);
const FALLBACK = 'web.auth.createFailed';

describe('authErrorMessage', () => {
  it("passes through the API's own message, which is written for a person", () => {
    const err = new ApiClientError(
      { code: 'VALIDATION_FAILED', message: 'That link is invalid or has expired' },
      401,
    );
    expect(authErrorMessage(err, t, FALLBACK)).toBe('That link is invalid or has expired');
  });

  it('reports a contract drift without leaking the detail', () => {
    const err = new ContractError({ issues: 'whatever' }, { raw: true });
    expect(authErrorMessage(err, t, FALLBACK)).toBe(en['web.auth.unexpectedResponse']);
  });

  it('tells an unreachable server apart from a slow one', () => {
    expect(authErrorMessage(new NetworkError('failed', false), t, FALLBACK)).toBe(
      en['web.auth.serverUnreachable'],
    );
    expect(authErrorMessage(new NetworkError('timed out', true), t, FALLBACK)).toBe(
      en['web.auth.tookTooLong'],
    );
  });

  it('falls back to the per-flow message for anything else', () => {
    expect(authErrorMessage(new Error('boom'), t, FALLBACK)).toBe(en[FALLBACK]);
    // Not every throw is an Error — a rejected promise can carry anything.
    expect(authErrorMessage('a bare string', t, FALLBACK)).toBe(en[FALLBACK]);
    expect(authErrorMessage(undefined, t, FALLBACK)).toBe(en[FALLBACK]);
  });
});

/**
 * The other half of the seam: an api SUCCESS in the reader's language.
 *
 * The api mints `RESET_REQUESTED` and its siblings in English, and they land on the
 * most prominent line of an auth page. Sending a code instead is what lets a
 * Vietnamese page answer in Vietnamese, and this is the proof that it does — asserted
 * in both locales, because a table that silently fell through to English would pass
 * every English-only test.
 */
describe('authSuccessMessage', () => {
  const viT = createTranslator(vi);

  it.each([
    'REGISTRATION_ACCEPTED',
    'ACCOUNT_CREATED',
    'ACCOUNT_ALREADY_EXISTS',
    'RESET_REQUESTED',
    'PASSWORD_RESET_DONE',
  ] as const)("answers %s in the reader's language", (code) => {
    const english = authSuccessMessage(code, t);
    const vietnamese = authSuccessMessage(code, viT);

    expect(english.length).toBeGreaterThan(0);
    expect(vietnamese.length).toBeGreaterThan(0);
    // The point of the whole seam. Equal strings would mean the code fell through to
    // English, which is exactly the failure this replaced.
    expect(vietnamese).not.toBe(english);
  });
});
