---
title: 'Auth register verify reset SMTP'
description: 'Register page, email verification, password reset, Gmail SMTP delivery, and post-reset token revocation'
status: completed
priority: P1
effort: '4-6d'
tags: [auth, security, email, migration]
created: 2026-08-23
---

# Auth register verify reset SMTP

## Overview

Web gains four unauthenticated pages — `/register`, `/verify-email`,
`/forgot-password`, `/reset-password`. Nest gains the endpoints behind them, a
`MailSender` seam over Gmail SMTP, and per-purpose stateless tokens.
**Registration creates no account until its mailbox is proven.** A completed
reset invalidates earlier access tokens and closes that user's open sockets.

Accepted contract:
[`plans/reports/brainstorm-260823-2036-auth-register-verify-reset-smtp.md`](../reports/brainstorm-260823-2036-auth-register-verify-reset-smtp.md)

## Decisions this plan implements

| #   | Decision                                        | Consequence accepted                                                          |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Email verification on register                  | Registration is deferred — see below                                          |
| 2   | Post-reset token invalidation                   | One indexed PK read per authenticated request and per socket upgrade          |
| 3   | Mail lives in the Nest API                      | Web keeps no DB and no identity secrets                                       |
| 4   | `POST /auth/register` → uniform 202, no session | Closes the existence oracle; breaks the register contract and the e2e fixture |
| 5   | Open sockets are terminated on reset            | A socket registry in the gateway; `claims.sub` must survive the upgrade check |

Decisions 1 and 2 reverse stances currently written into `auth.service.ts` and
`jwt-auth.adapter.ts`. Those comments are the codebase's spec — phase 7
enumerates all ten falsified claims.

## The design correction that shaped this plan

The obvious reading of decisions 1 and 4 — create an unverified row, refuse its
login with a distinct 403 — **reopens the very oracle the uniform 202 exists to
close.** Two unauthenticated requests: register `victim@corp.com` with your own
password (202 either way), then log in with it. Fresh address → your row exists,
password matches, unverified → 403. Taken address → 401. The attacker proves
account control because they just created the account.

Red-team review caught this. The fix, chosen deliberately: **registration creates
nothing.** The password is hashed, packed into a signed token, and mailed;
redeeming the link creates the row. Consequences, all good:

- No unverified rows exist, so login needs **no new branch** and keeps its single
  generic 401. The oracle is closed, not moved.
- Account squatting dies — there is no row to squat with, so the Google-linking
  rule can no longer be weaponised to permanently block an address.
- No `emailVerifiedAt` column, therefore no backfill, therefore none of the
  migration-window hazard that design carried.
- The NextAuth error-plumbing spike is unnecessary: nothing new needs surfacing
  on the login form.

## Goals

| #   | Goal                                                                                           | Priority |
| --- | ---------------------------------------------------------------------------------------------- | -------- |
| 1   | Register, verify, forgot and reset work end to end with no Gmail account in dev                | P1       |
| 2   | No endpoint reveals which addresses have accounts — status, body, or timing                    | P1       |
| 3   | A reset invalidates earlier tokens on HTTP, at the upgrade, and on open sockets                | P1       |
| 4   | Mail cannot be weaponised against a named mailbox or against the product's own ability to send | P2       |

## Phases

| #   | Phase                                                                                                     | Status                      |
| --- | --------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | [Phase 1: Schema and repository seam](./phase-01-schema-and-repository-seam.md)                           | Complete                    |
| 2   | [Phase 2: Token revocation and socket termination](./phase-02-token-revocation-and-socket-termination.md) | Complete                    |
| 3   | [Phase 3: Mail module and abuse controls](./phase-03-mail-module-and-abuse-controls.md)                   | Complete                    |
| 4   | [Phase 4: Deferred registration and verification](./phase-04-deferred-registration-and-verification.md)   | Complete                    |
| 5   | [Phase 5: Password reset flow](./phase-05-password-reset-flow.md)                                         | Complete                    |
| 6   | [Phase 6: Web auth pages](./phase-06-web-auth-pages.md)                                                   | Complete                    |
| 7   | [Phase 7: Docs and end-to-end gate](./phase-07-docs-and-end-to-end-gate.md)                               | Complete except manual pass |

### Dependency flow

```
1 (schema + seam) ──► 2 (revocation + sockets) ──┐
                  └─► 4 (deferred register) ─────┤
3 (mail) ─────────────► 4 ────────────────────────┼─► 5 (reset) ──► 6 (web) ──► 7 (docs + gate)
```

Phases 1 and 3 are independent and may run in parallel.

## Ordering rules

1. **Phase 3 precedes 4 and 5.** Both send mail; neither may land with the sender
   stubbed.
2. **Phase 2 precedes 5.** Reset writes `passwordChangedAt`; the check that reads
   it must already exist, or the write is silently inert.
3. Phase 2 alone is half-armed — the per-request read ships with only the
   row-gone benefit until phase 5 writes the column. If phases deploy
   independently rather than as one release, that interval costs latency for no
   revocation benefit. Bundling 2 and 5 into one deploy removes the question.

No migration-ordering rule is needed any more: the schema change is one nullable
column that nothing reads until phase 2, with no backfill.

## Success Criteria

- [x] Register answers a fresh and a taken address identically in status and
      body, creates no row, and hashes before the existence check — asserted by
      call order, not elapsed time
- [x] Verify, forgot and reset all work against the console sender with no SMTP
      configured, and no link contains an `undefined` origin
- [x] Login's behaviour is unchanged — one generic 401, no new status
- [x] A pre-reset token is refused on `GET /auth/me`, at the `/ws/translate`
      upgrade, and an already-open socket is closed
- [x] A database failure during verification yields a 5xx, never a 401
- [ ] ~~Exhausting the attacker-class mail budget does not stop legitimate
      verification or reset mail~~ — **renegotiated: true for reset, false for
      verification.** See phase 3's criterion for why, and the decision needed.
- [x] No user-supplied text reaches any mail body, subject or header
- [x] `pnpm --filter @chatofy/api test`, both e2e suites, web tests, lint,
      typecheck and build all pass

## Red Team Review

Four hostile reviewers (security, failure-mode, assumption, scope lenses) plus an
independent advisor. Two reviewers returned BLOCKED on the first pass. Every
finding was re-verified against source before acceptance.

| #   | Finding                                                                                                       | Severity | Disposition                                                   |
| --- | ------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------- |
| 1   | The unverified-403 reopens the existence oracle in two requests                                               | Critical | **Accepted** → deferred registration (whole-plan restructure) |
| 2   | `apps/web/proxy.ts` redirects all four new routes to `/login` and copies the token into `?next=`              | Critical | **Accepted** → phase 6                                        |
| 3   | Truncating `passwordChangedAt` down widens the survivable window to a full second, reachable by polling login | Critical | **Accepted** → ceil the write (phase 2)                       |
| 4   | The backfill's `WHERE` clause cannot cover rows created between deploys                                       | Critical | **Dissolved** — no column, no backfill                        |
| 5   | A single global mail budget is an anonymous product-wide kill switch                                          | Critical | **Accepted** → tiered budget (phase 3)                        |
| 6   | A DB read inside `verifyToken`'s catch-all turns any database fault into a fleet-wide forced sign-out         | High     | **Accepted** → phase 2                                        |
| 7   | Revocation covers the upgrade only; open sockets survive a reset                                              | High     | **Accepted** → socket termination (phase 2)                   |
| 8   | `name` reaches a mail body sent to an attacker-named address                                                  | High     | **Accepted** → phase 3                                        |
| 9   | Uniform 202 makes squatting a permanent Google-sign-in DoS                                                    | High     | **Dissolved** — no row to squat with                          |
| 10  | Five e2e suites beyond the auth ones import `registerAndLogin`                                                | High     | **Accepted** → phase 4                                        |
| 11  | Two mail seams leave the required cooldown bypassable with green tests                                        | High     | **Accepted** → one decorating sender (phase 3)                |
| 12  | Stale comments: 3 of 10 named, one misattributed to the guard                                                 | High     | **Accepted** → phase 7 enumerates all ten                     |
| 13  | `WEB_BASE_URL` optional + detached send = silent breakage; a default alone leaves production worse            | High     | **Accepted** → default **and** boot check (phase 3)           |
| 14  | The console sender prints live tokens whenever `NODE_ENV` is unset                                            | Medium   | **Accepted** → bind only for `development`/`test` (phase 3)   |
| 15  | A second `UserRepository` double exists in `auth.service.spec.ts`                                             | Medium   | **Accepted** → phase 1                                        |
| 16  | Phases claimed the same acceptance criteria                                                                   | Medium   | **Accepted** → phase 2 proves the check, phase 5 the write    |
| 17  | The cooldown burns its window on a send that was never delivered                                              | Medium   | **Accepted** → record on success (phase 3)                    |
| 18  | Rolling back revocation silently resurrects deliberately killed tokens                                        | Medium   | **Accepted** → phase 2 rollback note                          |
| 19  | The web api-client calls `getSession()` on unauthenticated endpoints                                          | Low      | **Accepted** → token-free instance (phase 6)                  |
| 20  | A per-route `Referrer-Policy` would duplicate the existing global header                                      | Low      | **Accepted** → dropped; existing policy already covers it     |

Attacked and found **sound**, recorded so they are not re-litigated: the derived-key
scheme survived direct cryptographic attack — the shared verify key is safe
because `sub` carries the binding, purpose infixes cannot collide, and access
tokens cannot replay; the single-instance assumption behind the in-memory
controls; `verifyToken` having exactly two call sites; `RECORD_SELECT` and
`toUserContract` listing fields explicitly; and the CSP already admitting the API
origin.

## Open questions

1. Do phases deploy independently or as one release? Only affects whether phase
   2's half-armed interval has a real cost (ordering rule 3).
2. Should `/verify-email` sign the user in rather than bounce to `/login`?
   Bouncing is assumed — the page never held the password.

<!-- slug: auth-register-verify-reset-smtp -->
