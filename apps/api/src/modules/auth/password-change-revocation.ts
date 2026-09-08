/**
 * Does a credential minted at `issuedAtSeconds` predate this account's last
 * password change?
 *
 * ONE predicate with TWO callers — `JwtAuthAdapter.verifyToken`, for the `iat`
 * of an access token, and `SessionRefreshService`, for the `issuedAt` of a
 * refresh family. It is lifted out rather than written twice because two copies
 * drifting apart is a silent revocation hole: the tests of each would still
 * pass, and the only symptom would be a reset that did not actually lock
 * anybody out.
 *
 * THE ROUNDING IS THE WHOLE THING, and it is asymmetric on purpose.
 * `PasswordResetService` CEILS the stamp it writes to the next whole second;
 * this floors what it is given and compares with a strict `<`. So the pair is
 * `floor(issuedAt) < ceil(changedAt)`.
 *
 * Neither half is incidental. `iat` has one-second resolution, so truncating
 * the stored value DOWN instead would leave every credential minted during the
 * reset's own second valid for its full life — and the person a reset exists to
 * lock out is exactly the one who knows the old password and can poll login to
 * land inside that second. Ceiling BOTH sides while keeping strict `<` has the
 * same effect, because the same-second case then compares equal and passes.
 * The cost of ceiling is that a login inside that one second is refused and
 * works on retry, and nobody is mid-flight, because a reset returns no session.
 *
 * A refresh token carries no `iat` of its own — it is opaque, 256 random bits —
 * which is why its FAMILY records an `issuedAt` and that is what comes in here.
 * Without this second caller, a refresh token issued before a reset would mint
 * a new access token with a fresh `iat`, later than `passwordChangedAt`, and
 * silently resurrect the session the reset existed to kill.
 */
export function isRevokedByPasswordChange(
  issuedAtSeconds: unknown,
  passwordChangedAt: Date | null,
): boolean {
  if (passwordChangedAt === null) return false;

  // A credential that cannot say when it was issued cannot be shown to postdate
  // the change, so it is refused rather than given the benefit of the doubt.
  // `Math.floor(undefined) < x` is `false`, which would PASS — the check has to
  // be explicit.
  if (
    typeof issuedAtSeconds !== 'number' ||
    !Number.isFinite(issuedAtSeconds)
  ) {
    return true;
  }

  const changedAt = Math.floor(passwordChangedAt.getTime() / 1000);
  return Math.floor(issuedAtSeconds) < changedAt;
}
