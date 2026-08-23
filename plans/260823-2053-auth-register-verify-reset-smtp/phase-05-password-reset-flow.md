---
phase: 5
title: 'Password reset flow'
status: completed
priority: P1
effort: '6-8h'
dependencies: [2, 3, 4]
---

# Phase 5: Password reset flow

## Overview

Forgot-password and reset-password, built on phase 4's token helper. Completing a
reset writes `passwordChangedAt`, which is what finally arms phase 2's revocation
check and its socket termination.

## Requirements

- Functional: forgot-password reveals nothing about whether an address has an
  account — status, body, or timing.
- Functional: a reset token works once, expires in 30 minutes, and dies the
  moment the password changes.
- Functional: completing a reset invalidates earlier tokens and closes that
  user's open sockets.
- Non-functional: the new password is validated by the same rule as registration.
  Reuse the constraint; do not fork it.

## Architecture

`POST /auth/forgot-password` (3/60s) always answers **202** with the same body,
dispatching the mail **detached** — `void send().catch(log)`. Awaiting it would
make response time the oracle the status code just closed: microseconds for an
unknown address versus up to seconds for a real send.

`POST /auth/reset-password` (10/60s) redeems the token, hashes through the
existing `hashPassword` seam, and writes `passwordHash` + `passwordChangedAt`
(app clock, **ceiled** to the next second — see phase 2) in one call. It answers
**200 with no session**; the user goes to sign in.

**`normalizeEmail` before the lookup.** Without it `Alice@corp.com` can never
reset `alice@corp.com` — the same trap the service already documents for login,
and here the failure is silent because the response is uniform either way.

### Google-first rows — proceed

A row with `googleSub` set and `passwordHash` null. Traced against the linking
policy:

- After a reset sets a hash, `loginWithGoogle` still short-circuits at
  `findByGoogleSub` (step 1), so the anti-squatting check at 2b is never reached.
  Google sign-in is unaffected.
- 2b governs rows with a password and _no_ `googleSub`. This row has one.
- Only someone holding the mailbox can trigger it — the same proof Google's
  `emailVerified` attested when the row was created.

Do **not** branch the HTTP response on account type; that would be an
account-shape oracle. The _mail body_ may note that Google sign-in still works.

## Related Code Files

- Modify: `apps/api/src/modules/auth/auth.service.ts`, `auth.controller.ts`,
  `dto/auth.dto.ts`
- Modify: `packages/types/src/http/auth.ts` (forgot/reset request + response schemas)
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts`
- Test: `apps/api/test/auth.db-e2e-spec.ts`

## Implementation Steps

1. Add the schemas, reusing `registerRequestSchema`'s password constraint rather
   than restating it.
2. Implement forgot-password: normalize, look up, dispatch detached, answer 202
   unconditionally.
3. Implement reset-password: redeem, hash, write hash + ceiled
   `passwordChangedAt` via `updatePasswordHash`.
4. Tests: token single-use; expiry; sibling invalidation after a change; uniform
   202 for known and unknown addresses; `Alice@` resets `alice@`.
5. **The end-to-end revocation test lives here**, because this is the first phase
   where anything writes the timestamp. Phase 2 proved the _check_ against a
   directly written column; this proves the _write_:

   - complete a reset **through the endpoint**, then assert a previously issued
     token is refused on `GET /auth/me` and at the `/ws/translate` upgrade;
   - assert an **open** socket belonging to that user is closed.

   Do not restate phase 2's criteria here — if the two phases assert the same
   facts, one gets skipped as redundant, and the half that goes untested is the
   one that only this phase can prove.

## Success Criteria

- [x] Forgot-password answers 202 identically for a known and an unknown address
- [x] A reset token is refused after use, after 30 minutes, and after a second
      reset
- [x] `Alice@corp.com` can reset the account stored as `alice@corp.com`
- [x] Completing a reset **through the endpoint** causes a previously issued
      token to be refused on HTTP and at the upgrade
- [x] Completing a reset closes that user's open sockets
- [x] A Google-first account's Google sign-in still works after a reset

## Risk Assessment

**The detached send is quietly made `await`.** It looks like a missing `await` to
a reviewer or a linter. Signal: a PR comment or lint rule asks for it. Response:
the comment must say it is an anti-timing-oracle measure, not an oversight.

**A recycled mailbox lets its new holder inherit the previous owner's sessions
and transcripts** — the same scenario `loginWithGoogle`'s comment 2d refuses for
relinking. Inherent to all email-based reset; record it, do not build around it.

**Rollback:** drop both endpoints. `passwordChangedAt` stops being written, and
phase 2's check goes inert. Note that once this phase has run in production,
rolling back **phase 2** resurrects tokens this deliberately killed — see phase
2's rollback note.
