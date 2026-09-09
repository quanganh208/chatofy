import { describe, expect, it } from 'vitest';
import { isRevokedByPasswordChange } from './password-change-revocation';

/** What `PasswordResetService` actually writes: ceiled to the next whole second. */
const changedAtFor = (wallClockSeconds: number): Date =>
  new Date(Math.ceil(wallClockSeconds) * 1000);

describe('isRevokedByPasswordChange', () => {
  it('revokes nothing when the password has never changed', () => {
    expect(isRevokedByPasswordChange(1_700_000_000, null)).toBe(false);
  });

  describe('the same-second case, in both directions', () => {
    // This pair is the reason the rounding is asymmetric. Get it wrong and the
    // person a reset locks out — the one who knows the old password and can
    // poll login — lands inside the reset's own second and keeps a credential
    // for its full life.
    const resetAt = 1_700_000_000.3;
    const changedAt = changedAtFor(resetAt); // ceiled to 1_700_000_001

    it('refuses a credential minted inside the reset second', () => {
      // Minted at .5, so its second-resolution stamp is 1_700_000_000 — before
      // the ceiled 1_700_000_001.
      expect(isRevokedByPasswordChange(1_700_000_000, changedAt)).toBe(true);
    });

    it('accepts one minted in the following second', () => {
      expect(isRevokedByPasswordChange(1_700_000_001, changedAt)).toBe(false);
    });
  });

  it('accepts a credential minted well after the change', () => {
    expect(
      isRevokedByPasswordChange(1_700_000_500, changedAtFor(1_700_000_000)),
    ).toBe(false);
  });

  it('refuses a credential minted well before the change', () => {
    expect(
      isRevokedByPasswordChange(1_699_999_000, changedAtFor(1_700_000_000)),
    ).toBe(true);
  });

  it('floors a fractional stamp rather than rounding it up', () => {
    // 1_700_000_000.9 must not round to 1_700_000_001 and survive a change
    // recorded at 1_700_000_001.
    expect(
      isRevokedByPasswordChange(1_700_000_000.9, changedAtFor(1_700_000_000.3)),
    ).toBe(true);
  });

  it.each([undefined, null, 'yesterday', NaN, Infinity])(
    'refuses a credential whose issue time is %s',
    (issuedAt) => {
      // Fail CLOSED. `Math.floor(undefined) < x` is false, so an unguarded
      // comparison would quietly accept exactly the credentials that cannot
      // prove themselves.
      expect(
        isRevokedByPasswordChange(issuedAt, changedAtFor(1_700_000_000)),
      ).toBe(true);
    },
  );
});
