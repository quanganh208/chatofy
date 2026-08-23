---
phase: 4
title: 'Deferred registration and verification'
status: completed
priority: P1
effort: '1-1.5d'
dependencies: [1, 3]
---

# Phase 4: Deferred registration and verification

## Overview

Registration stops creating a row. It hashes the password, packs the pending
account into a signed token, and mails a link; redeeming that link is what
creates the account. This is the phase that changes a public contract.

## Why deferred, and what it buys

The obvious design — create an unverified row, block its login with a distinct
403 — **reopens the existence oracle the uniform 202 was built to close**, in two
unauthenticated requests:

1. `POST /auth/register {victim@corp.com, "Attacker1!"}` → 202 either way.
2. `POST /auth/login {victim@corp.com, "Attacker1!"}` → **403** if the address was
   free (the attacker's own row now exists and the password matches), **401** if
   it was taken.

The attacker proves account control because they just created the account. No
wording fixes that; the row's existence is the leak.

Creating nothing until the mailbox is proven removes it at the root, and three
other problems with it:

- **No unverified rows exist**, so login needs no new branch and keeps its single
  generic 401. The oracle is genuinely closed, not moved.
- **Squatting dies.** Under the row-first design, registering `victim@corp.com`
  and never verifying still leaves a `passwordHash`, and `loginWithGoogle`'s
  branch 2b keys on exactly that — permanently blocking the real owner from
  Google sign-in, with no cleanup job and no remediation path. Nothing to squat
  with now.
- **No `emailVerifiedAt` column, no backfill, no migration window.**

## Requirements

- Functional: register answers identically for a fresh and an already-registered
  address — status, body, and to the extent achievable, timing.
- Functional: a verification link creates the account exactly once.
- Functional: login behaviour is **unchanged**.
- Non-functional: no token table, no pending-registration table.

## Architecture

### The pending-registration token

A JWT carrying `{ email, passwordHash, name, purpose: 'register' }`,
signed with `AUTH_JWT_SECRET + ':register:'`, 24 h.

The password is hashed **before** the token is minted, so no plaintext leaves the
request. Holding the link lets someone create the account — but not sign into it,
since they do not know the password it was built from. That is strictly weaker
than a reset link, which is the right ordering.

**Single-use falls out of the unique index.** Redeeming creates the row; a second
redemption loses to `UserAlreadyExistsError` and is answered "this account
already exists — sign in", which is also the honest answer for a genuinely
double-clicked link.

The reset token (phase 5) keeps its own derivation,
`AUTH_JWT_SECRET + ':pwreset:' + (passwordHash ?? '')`. **Both purpose infixes
are security-critical and must reach the code verbatim** — without `:pwreset:`, a
null-`passwordHash` row derives the bare `AUTH_JWT_SECRET` and a stolen access
token verifies as a reset token. `:register:` prevents the same collapse. A
`purpose` claim is checked on redeem as well.

Note both shared-key cases in the code, not just one: every Google-first row also
derives one identical reset key. Safe for the same reason — an HMAC key is not a
capability and `sub` carries the binding — but phase 5 deliberately opens reset to
exactly those rows, so say so where someone might later "improve" redeem by
accepting an email parameter.

### Register

Both branches answer **202** with a byte-identical body. Fresh address → a
verification mail. Taken address → a "you already have an account — sign in or
reset?" mail, which serves the person who forgot they registered.

**Equal cost.** The fresh path pays ~100 ms of argon2 and the taken path would
pay none — a timing oracle replacing the status one. Hash before the existence
check, the same care `DUMMY_HASH_PROMISE` already applies to login.

Assert that **structurally, never by wall clock**. A `|Δt| < ε` test either flakes
on a shared runner — argon2 is 64 MiB on the same threadpool as the translate
pipeline — or needs an ε that proves nothing, and a flaky security test gets
skipped, which is worse than none. In `auth.service.spec.ts`: spy the hasher and
the lookup, register a **taken** address, assert the hasher ran _and_ ran first
via `hashSpy.mock.invocationCallOrder[0] < findSpy.mock.invocationCallOrder[0]`.

**The branches are not wall-clock equal even in principle** — the fresh path no
longer inserts, but it does mint and mail a token. Neither is on the response
path if both branches dispatch detached and return immediately, which is the
shape phase 5 uses for forgot-password; reuse it rather than maintaining two.

**Contract change:** `POST /auth/register` no longer returns an `AuthSession`.
That reaches `@chatofy/types`, the controller, the service, the e2e fixture, and
`apps/mobile/src/clients/auth-client.interface.ts`, which still types `signUp():
Promise<AuthSession>` (stub-only, but it should not be left disagreeing with the
shared contract).

Export **response** schemas alongside request ones — the web client validates
every response against a zod schema, so a 202 with no schema has nothing to parse
against. One shared message-shape schema covers the new routes.

### Verify

`POST /auth/verify-email` redeems: decode unverified to read the payload, verify
against the derived key, check `purpose`, then create the row. Answer 200.

There is no resend endpoint and no unverified-login branch — **submitting the
register form again is the resend**, and it is idempotent from the caller's point
of view. One less route, one less uniform-202 surface to get wrong.

## Related Code Files

- Create: `apps/api/src/modules/auth/purpose-token.ts` (+ spec)
- Modify: `apps/api/src/modules/auth/auth.service.ts`, `auth.controller.ts`,
  `dto/auth.dto.ts`, `auth.module.ts` (import `MailModule`)
- Modify: `packages/types/src/http/auth.ts`
- Modify: `apps/mobile/src/clients/auth-client.interface.ts` + its stub
- Modify: `apps/api/test/utils/auth-fixture.ts` — and the **five** suites that
  import `registerAndLogin`: `ws-auth.e2e-spec.ts`, `translate.e2e-spec.ts`,
  `translate-ws-stream.e2e-spec.ts`, `live-translate-ws.e2e-spec.ts`,
  `response-envelope.e2e-spec.ts`
- Modify: `apps/api/test/auth.db-e2e-spec.ts`
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts`

## Implementation Steps

1. **Rewrite the e2e fixture first.** `registerAndLogin` is the only sanctioned
   way any e2e test obtains a credential, and five suites beyond the auth ones
   import it. It reads `token.accessToken` **and** `user.id` off the register
   response — and the new response can carry neither, since it must be identical
   for fresh and taken addresses.

   One mechanism serves both stores: create a row directly through the injected
   `USER_REPOSITORY` (`app.get(USER_REPOSITORY)`, exposed in both configurations)
   with a known `passwordHash`, then `POST /auth/login` for the token. It works
   identically against `InMemoryUserRepository` under `test:e2e` and Postgres
   under `test:e2e:db`, needs no branch on which store is behind it, and spends
   **no** register throttle — where register-then-login would spend two buckets
   per identity against 5/60s and 10/60s from one loopback address.

   The failure to avoid: someone unblocks the suite by disabling
   `ThrottlerGuard` in e2e, silently deleting the coverage that auth routes are
   throttled at all.

2. Write the purpose-token helper with both derivations and the `purpose` claim.
   Test the collapse case explicitly, for a null-`passwordHash` row.
3. Change the register contract in `@chatofy/types`, with response schemas.
4. Rewrite `AuthService.register`: hash, then branch, both branches dispatching
   detached and returning the same 202. No row is created.
5. Add `POST /auth/verify-email` (10/60s) — redeem and create.
6. Update every db-e2e test that asserted 201 or 409 from register.

## Success Criteria

- [x] Register returns 202 with a byte-identical body for fresh and taken
      addresses, and creates **no** row
- [x] The taken-address path calls the hasher, and calls it **before** the
      existence check — asserted by call order, not elapsed time
- [x] A verification link creates the account; following it again says the
      account exists rather than erroring
- [x] Login's behaviour is unchanged — one generic 401, no new status
- [x] A reset token cannot be redeemed as an access token, nor the reverse —
      asserted for a null-`passwordHash` row specifically
- [x] The fixture and all six affected test files pass

## Risk Assessment

**The equal-cost ordering is "optimised" away.** Someone will notice that hashing
before the existence check wastes argon2 on a duplicate. Signal: a refactor
reorders it. Response: the comment must say it is a timing defence, and the
call-order assertion is what enforces it.

**The token grows.** It carries an argon2 hash (~100 chars) plus an email and a
display name — comfortably inside URL limits, but check a long display name does
not push the link past what mail clients wrap.

**Rollback:** revert the register contract and drop the verify route; the token
helper is inert without callers.
