---
title: 'Phase 4: Google login'
status: done
priority: P1
effort: '1-1.5d'
dependencies: [3]
---

# Phase 4: Google login

## Overview

Add `POST /auth/google`: verify a Google id_token server-side against Google's
JWKS, then create or link a user under a policy hardened in **both** directions.

## Precondition

Google OAuth client id and secret provisioned, consent screen configured. Blocks
execution of this phase only — Phases 1-3 need nothing from Cloud Console.

## Requirements

**Functional**

- [ ] `POST /auth/google` accepts `{ idToken }` and returns the same `AuthSession` as password login
- [ ] Verification uses Google's JWKS with an audience allowlist
- [ ] Linking never occurs on an unverified provider email
- [ ] **Linking never silently grants a Google identity access to a password-bearing account**

## The takeover this policy has to stop

An earlier draft hardened only the provider→local direction and called that "the
classic account-takeover bug". It left local→provider open, which is the more
dangerous direction under this plan's non-goals:

1. `POST /auth/register` creates a working account for **any** email with zero proof
   of mailbox control — email verification is an explicit non-goal, and
   `registerRequestSchema` validates format only. An attacker registers
   `victim@company.com` with a password of their choosing.
2. The real owner later signs in with Google, `email_verified: true`.
3. A naive "found by email and verified → link" rule logs the victim into the
   **attacker's** row.
4. The attacker's password was never removed, so they retain access to the victim's
   `ConversationSession` and `TranscriptSegment.sourceText/targetText` — the full
   text of translated meetings. With revocation a non-goal, discovery does not even
   end it: the attacker's 7d token keeps working.

## Linking policy, in order

1. Look up by `googleSub`. Found → log in.
2. Not found → look up by email:
   - **No `passwordHash` on the row** and `email_verified === true` → set
     `googleSub`, log in. (A Google-created row, or an invite-style row; nobody
     ever proved password control of it, so nothing is being taken over.)
   - **`passwordHash` is set** → do **not** auto-link. Require password re-auth at
     link time before attaching `googleSub`. This is the squatting defence, and it
     is cheaper than the email-verification flow that is out of scope.
   - `email_verified !== true` → refuse outright.
3. Not found at all → create the user with `googleSub` and no `passwordHash`.

The reverse (a Google-first user later registering a password) stays a non-goal:
`POST /auth/register` returns a generic conflict. Note this conflict is an
account-existence oracle, accepted and recorded in Phase 2.

## Architecture

Verification uses `google-auth-library`'s `verifyIdToken` (JWKS, signature, issuer,
expiry, audience). Do not hand-roll jose + JWKS.

Audience is a `string[]` allowlist rather than a single value. This costs nothing
now (the type is a list either way) and avoids a breaking change when mobile's
platform-specific client ids arrive. It does **not** get a dedicated multi-audience
test path or a duplicated risk entry in Phase 6 — one audience-rejection assertion
covers the security property.

## Related Code Files

**Create**

- `apps/api/src/modules/auth/google-token-verifier.ts` + spec

**Modify**

- `apps/api/src/modules/auth/dto/auth.dto.ts` — add the Google DTO to the existing single auth DTO file
- `apps/api/src/config/env.schema.ts` — `GOOGLE_CLIENT_IDS` (comma-separated, optional; lazily enforced when the route is called, matching the `GEMINI_API_KEY` pattern)
- `apps/api/src/modules/auth/auth.controller.ts` — the route, `@Public()` per-route, throttled
- `apps/api/src/modules/auth/auth.service.ts` — `loginWithGoogle` implementing the policy above
- `apps/api/src/modules/users/repositories/prisma-user.repository.ts` — `findByGoogleSub`, link
- `apps/api/.env.example` — `GOOGLE_CLIENT_IDS=`

## Implementation Steps

1. Add `google-auth-library`; add the env var with lazy enforcement.
2. Write the verifier; unit-test signature, expiry, issuer, and audience rejection.
3. Implement the policy branches in `AuthService`.
4. Add repository lookups.
5. Add the throttled public route.
6. E2e every branch, including the squatting scenario. These run in the **Postgres-backed** suite from Phase 3, not the in-memory one — the `googleSub` unique constraint and real `findUnique` semantics are exactly what the linking policy depends on.
7. Verify once manually with a real playground id_token.

## Success Criteria

- [ ] A valid id_token for a new user creates a user with `googleSub` and null `passwordHash`
- [ ] A valid id_token matching an existing **passwordless** verified row links and logs in
- [ ] **A valid id_token matching an existing row that HAS a `passwordHash` does not auto-link** — it demands password re-auth. Test written as the squatting scenario end to end: register victim email as attacker, then Google-login as victim, and assert the victim does not land in the attacker's row.
- [ ] `email_verified: false` against a matching email is refused
- [ ] Tampered, expired, and wrong-audience id_tokens are rejected
- [ ] The returned `AuthSession` is shape-identical to password login's
- [ ] Unset `GOOGLE_CLIENT_IDS` yields a clear error, not a crash

## Risk Assessment

**Pre-registration squatting (above).** Highest-severity item in the plan. Signal:
the squatting e2e test is missing or asserts only that a session was returned.
Response: it is an explicit criterion with a dedicated adversarial test.

**Auto-linking on unverified email.** Refused in branch 2.

**Google changes id_token claim shapes.** Mitigated by using the maintained library.
