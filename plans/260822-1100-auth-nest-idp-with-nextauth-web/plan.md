---
title: 'Auth: Nest as IdP, NextAuth as web session shell'
description: 'Login required for every existing feature. Nest owns password hashing, Google id_token verification, and JWT issuance; NextAuth v5 is a thin session shell on apps/web.'
status: complete
priority: P1
effort: '8-10.5d (P1-P5; P6 deferred)'
tags: [auth, security, api, web, contracts]
created: 2026-08-22
---

# Auth: Nest as IdP, NextAuth as web session shell

Brainstorm contract: [`plans/reports/brainstorm-260822-1043-auth-nextauth-backend-verify.md`](../reports/brainstorm-260822-1043-auth-nextauth-backend-verify.md)

## Overview

Nest becomes the identity authority: it owns password hashing, verifies Google
id_tokens, and issues its own access JWT. NextAuth v5 on `apps/web` is a thin
session shell over those endpoints — it never touches the database. Every
existing feature (`POST /translate`, `/ws/translate`) requires a valid identity.

The `AuthAdapter` seam this plan fills was scaffolded long ago and left unwired:
`issueToken?` is documented as "only for providers that issue tokens themselves
(e.g. custom JWT)", `authTokenSchema` exists with no implementation, and
`api-client`'s `getHeaders` is documented "e.g. bearer token" with zero call
sites. This is wiring a designed-for extension point, not a retrofit.

**Rejected alternative:** NextAuth as the IdP with Nest verifying its session
token. It fails the multi-client requirement outright — `apps/mobile` and
`apps/extension` can never hold a NextAuth cookie — and v5 session tokens are
JWE, so Nest would have to reimplement Auth.js key derivation, binding the API
to the internals of a beta library in maintenance mode.

## Locked decisions

| Decision           | Value                                                                                             | Source                 |
| ------------------ | ------------------------------------------------------------------------------------------------- | ---------------------- |
| Identity authority | Nest. NextAuth is a client shell                                                                  | brainstorm             |
| Google flow        | NextAuth Google provider; server-side callback forwards `account.id_token` to `POST /auth/google` | brainstorm             |
| Scope              | Web first (P1-P5). Mobile deferred to P6; extension token wiring pulled into P3                   | user + red team        |
| Refresh tokens     | None. One access JWT, 7d, `expiresAt` set, `refreshToken` omitted                                 | user                   |
| Password hashing   | `argon2` + explicit `allowBuilds` entry                                                           | user                   |
| `AUTH_PROVIDER`    | **Deleted.** Along with `GET /auth/providers` and the whole provider enum                         | user                   |
| Guard mode         | Always enforces. There is no "auth off" mode                                                      | derived from the above |

## Why `AUTH_PROVIDER` is deleted rather than extended

It never worked. Its only read is `auth.controller.ts:23`, and the only consumer
of that read is `GET /auth/providers`, whose entire job is echoing the value back
out — fully circular, nothing branches on it. `auth.module.ts` binds
`NoopAuthAdapter` unconditionally via `useClass`, so
`noop-auth.adapter.ts:9`'s claim that it is "used when `AUTH_PROVIDER=none`"
describes behavior that does not exist. The env var has never gated anything.

Deleting it removes the largest implementation risk in this plan by construction:
there is no "what does the guard do when `AUTH_PROVIDER=none`?" question if the
value cannot exist. An enum carrying an `off` value is itself the footgun.

`GET /auth/providers` goes with it rather than being reshaped into a `methods`
endpoint, because Auth.js ships its own `GET /api/auth/providers` listing what
`apps/web` has configured. The Nest endpoint could never be authoritative for
"can this user Google-login on web" — that depends on web's NextAuth env (client
id **and** secret), not the API's audience allowlist, so the two could only agree
by luck. Skew yields either a button that errors or a hidden button that would
have worked.

## Goals

| #   | Goal                                                                             | Priority      |
| --- | -------------------------------------------------------------------------------- | ------------- |
| 1   | Nest issues and verifies its own access JWT; every existing feature requires one | P1            |
| 2   | Email/password register + login, argon2-hashed                                   | P1            |
| 3   | Google login, verified server-side against Google's JWKS                         | P1            |
| 4   | `AUTH_PROVIDER` and its dead contract surface fully removed                      | P1            |
| 5   | NextAuth v5 session shell on `apps/web` with route gating                        | P1            |
| 6   | Benchmark harness keeps working against the authenticated WS                     | P1            |
| 7   | Mobile token storage + native Google                                             | P3 (deferred) |

## Phases

| #   | Phase                                                                                | Status   |
| --- | ------------------------------------------------------------------------------------ | -------- |
| 1   | [Cleanup, contracts, schema, test substrate](./phase-01-cleanup-contracts-schema.md) | Pending  |
| 2   | [Auth core + endpoints](./phase-02-auth-core-endpoints.md)                           | Pending  |
| 3   | [Enforcement + vertical slice gate](./phase-03-enforcement-and-gate.md)              | Pending  |
| 4   | [Google login](./phase-04-google-login.md)                                           | Pending  |
| 5   | [Web NextAuth shell](./phase-05-web-nextauth.md)                                     | Pending  |
| 6   | [Mobile auth client](./phase-06-mobile-extension.md)                                 | Deferred |

Phase 3 is the gate. It proves issuance, HTTP enforcement through the existing
filter's `UNAUTHORIZED` mapping, and the raw-ws upgrade path in one slice.
Everything after it is repetition of a proven design.

## Success Criteria

- [x] `register -> login -> Bearer POST /translate` returns 200; no token returns 401 with the `UNAUTHORIZED` envelope
- [x] The same token opens `/ws/translate` and completes one turn; a bad token is refused at the upgrade with HTTP 401 and no socket is created
- [x] Google login creates or links the correct user, and never auto-links when `email_verified !== true`
- [x] `passwordHash` never appears in any response, asserted by a strict-schema test
- [x] `grep -rn AUTH_PROVIDER` over `apps/ packages/` returns nothing outside plan docs
- [ ] `benchmarks/live-translate/run-arms.mjs` runs end to end against the authenticated API — **NOT RUN.** The harness's login preamble and subprotocol handshake are implemented and were verified against a live API; the full arm run was not, because it needs built fixtures (HuggingFace VIVOS + LibriSpeech), both sherpa-onnx sidecars with downloaded models, and Gemini live-translate-preview access. See the outstanding-work note below.
- [x] No frame from an unverified socket reaches a session service
- [x] A Google id_token cannot take over an account that has a `passwordHash`
- [x] `pnpm turbo run lint typecheck test` **and** `pnpm --filter api test:e2e` green — note the root package has no `test` script and api's jest `rootDir` is `src`, so `pnpm test` alone never runs the e2e suites
- [x] CI runs the api e2e suite (it does not today) — two jobs: `api-e2e` (in-memory) and `api-e2e-db` (Postgres service container)

## Outstanding work

**The benchmark baseline was never captured, and the post-auth comparison
therefore never ran.** Phase 1 step 2 assumed it had to be taken before the
working tree changed or the criterion would be unfalsifiable. That premise is
wrong: git preserves the pre-auth tree, so the baseline can still be captured
from a worktree at `a1b8464` and compared against the same harness run on this
branch. What it needs is operational, not code: `build-fixtures.mjs` downloading
VIVOS and LibriSpeech (both endpoints verified reachable), both local speech
sidecars running with their models, and a Gemini key with
`gemini-3.5-live-translate-preview` access. The harness itself is ready — its
login preamble and two-argument socket construction were verified end to end
against a live authenticated API.

## Rollback

Phase 1 ships reverse SQL alongside the forward migration, because Prisma Migrate
has no down mechanism and a code-revert-with-database-forward leaves drift that
`prisma migrate dev` offers to resolve by **resetting** — cascading through
`ConversationSession` and `TranscriptSegment`. Take a database backup before
migrating.

Phase 3 is the largest commit and the hardest to bisect: it touches the API, both
realtime transports, web, the extension, the harness and CI at once. It cannot be
split without leaving the product broken between phases. Land it as a single
revertable merge and keep the Phase 1 benchmark baseline available for comparison.

## Multi-tenancy consequence

`MAX_CONCURRENT_TURNS_GLOBAL = 6` was sized for a single-tenant demo — its own
comment says so: _"because `/ws/translate` takes no authentication, nothing bounds
how many sockets there are"_, and _"six is two full-rate speakers"_. Adding login
does not change the number; it changes who competes for it. Three logged-in users
conversing at once put the third on `too_many_turns`, and one authenticated user
looping six starts every 25s (inside the 30s idle sweep) denies service to everyone
from a single unrevocable token.

Per-user ceilings remain a non-goal, but the deployment is therefore effectively
capped at ~2 concurrent speakers **in total**, not per user. Recorded so the number
is a decision rather than an oversight. See the open decision below.

## Non-goals

Refresh-token rotation and reuse detection; revocation before expiry; per-user
concurrency ceilings on the gateway; a "set password" flow for Google-first
users; magic links; email verification; swapping the provider to Better Auth.

## Decisions resolved at validation

1. **7d token lifetime — kept**, with the CSP shipping in Phase 5 as the
   compensating control. Accepted consequence, recorded so it is a decision and not
   an oversight: an XSS exfiltrates a credential usable for up to 7 days from any
   host, and neither logout nor a password change invalidates an issued token. The
   only lever is rotating `AUTH_JWT_SECRET`, which signs everyone out.
2. **Global concurrency ceiling — left at 6**, and the limit is stated plainly
   rather than papered over: this deployment supports roughly **two concurrent
   speakers in total**, not per user. The number is set by sidecar CPU, and the
   code's own comment warns that past six "every turn in flight gets slower
   together". Per-user ceilings stay a non-goal.
3. **WS token transport — `Sec-WebSocket-Protocol`**, not a query parameter, so no
   credential reaches server or proxy access logs. Requires `handleProtocols` to
   echo `chatofy-v1`; a server that selects no offered subprotocol gets a handshake
   that succeeds and then closes instantly.
4. **e2e identity — both substrates.** In-memory `USER_REPOSITORY` for the existing
   suites (fast, no container), plus one Postgres-backed suite for auth and the
   Google linking policy, where the `googleSub` unique constraint and real query
   semantics are the things most likely to break.

## Open questions — resolved during implementation

1. **Deploy target — does argon2 build there?** Builds and runs on Linux/Node 24
   (`node-gyp-build` succeeded; hash/verify round-trips). The deploy target itself is
   still unproven; the hasher seam in `AuthService` keeps a `bcryptjs` swap a
   one-file change.
2. **Google OAuth client id/secret** — still not provisioned. The endpoint, the
   verifier and the whole linking policy are implemented and tested against a stubbed
   Google; what remains untested is one real id_token from Cloud Console.
3. **Do the four new production dependencies pass `pnpm audit --audit-level=high`?**
   Carried forward from validation as unanswerable before install. **Answered: yes,
   but only after re-pinning.** `argon2`, `@nestjs/jwt` and `google-auth-library` add
   nothing. `next-auth@5.0.0-beta.29` — the version first installed — carries two
   CRITICAL advisories (GHSA-8fpg-xm3f-6cx3, a configuration error that makes
   existence-based auth checks fail **open**; GHSA-7rqj-j65f-68wh, a homoglyph `@`
   bypass in the email normalizer) plus a high one, and the vulnerable range covers
   every beta through beta.31. `5.0.0-beta.32` is the first release outside it and
   the first depending on the patched `@auth/core@0.41.3`. Pinned there, the audit
   returns to its pre-existing baseline with **nothing added to `ignoreGhsas`**.

## Red Team Review

### Session — 2026-08-22

**Reviewers:** all 4 reported (Security Adversary, Failure Mode Analyst, Scope & Complexity Critic, Assumption Destroyer).
**Findings:** ~29 raised; 6 Critical, all accepted and applied. Two revision passes: the fourth reviewer's report changed the WS design.

| #   | Finding                                                                                                   | Severity | Disposition                                         | Applied To |
| --- | --------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------- | ---------- |
| 1   | Pre-registration squatting defeats Google linking                                                         | Critical | Accept                                              | Phase 4    |
| 2   | WS handshake races the message pump; frames execute before rejection                                      | Critical | Accept                                              | Phase 3    |
| 2b  | Discarded `handleConnection` promise → unhandled rejection kills the process (Node 24)                    | Critical | Accept                                              | Phase 3    |
| 2c  | `verifyClient` refuses at the upgrade — no socket, no race. Better than gating handlers                   | Critical | Accept — **design changed**                         | Phase 3    |
| 3   | e2e fixture unimplementable — Prisma stubbed, repository unimplemented                                    | Critical | Accept                                              | Phase 2, 3 |
| 4   | CI never runs api e2e; root has no `test` script                                                          | Critical | Accept                                              | Phase 3    |
| 5   | Enforcement lands before client wiring; extension offline indefinitely                                    | Critical | Accept                                              | Phase 3, 6 |
| 6   | Server secrets routed into a client-bundled env module                                                    | High     | Accept                                              | Phase 5    |
| 7   | `AuthAdapter` justification cited a spec that uses no testing module                                      | High     | Accept                                              | Phase 1, 3 |
| 8   | `APP_GUARD` in `CommonModule` cannot resolve its dependencies                                             | High     | Accept                                              | Phase 3    |
| 9   | Controller-level `@Public()` would ship `GET /auth/me` unauthenticated                                    | High     | Accept                                              | Phase 3    |
| 10  | No rate limiting; argon2 on a public route starves the turn pipeline                                      | High     | Accept                                              | Phase 2    |
| 11  | Concurrency ceiling sized for single-tenant                                                               | High     | Accept                                              | plan.md    |
| 12  | Migration has no reverse path                                                                             | High     | Accept                                              | Phase 1    |
| 13  | Bench baseline does not exist; criterion unfalsifiable                                                    | High     | Accept                                              | Phase 1, 3 |
| 14  | Close code discarded by transports; 4401 handling unreachable                                             | High     | Accept                                              | Phase 3, 5 |
| 15  | `AUTH_JWT_SECRET` required in P1 breaks e2e before P3 supplies it                                         | High     | Accept                                              | Phase 1    |
| 16  | Deletion list incomplete (`AuthProvidersResponse`; 4 barrel lines not 2)                                  | High     | Accept                                              | Phase 1    |
| 17  | `PrismaUserRepository` entirely unimplemented; estimate wrong                                             | High     | Accept                                              | Phase 2    |
| 18  | Register 409 is an existence oracle contradicting Phase 2's own criterion                                 | Medium   | Accept (documented, not fixed)                      | Phase 2    |
| 19  | Stale docs name `NoopAuthAdapter` as the active binding                                                   | Medium   | Accept                                              | Phase 2    |
| 20  | Four single-class DTO files against a one-file-per-module convention                                      | Medium   | Accept                                              | Phase 2, 4 |
| 21  | Backup step cited a project rule that does not exist in the repo                                          | Medium   | Accept                                              | Phase 1    |
| 22  | Secret rotation produces a silent login loop                                                              | Medium   | Reject — no evidence of multi-instance deploy today | —          |
| 23  | `StreamSocket.close()` would break the send-only interface's fakes across six files                       | Critical | Accept — obviated by `verifyClient`                 | Phase 3    |
| 24  | Claims `WeakMap` had zero readers (write-only state)                                                      | Medium   | Accept — dropped                                    | Phase 3    |
| 25  | Phase 1 retarget list omitted `response-envelope.e2e-spec.ts:47`, the assertion that actually breaks      | Medium   | Accept                                              | Phase 1    |
| 26  | `serviceDescriptorSchema` is api-local, not in `@chatofy/types`; retarget would void a cross-package test | Medium   | Accept                                              | Phase 1    |
| 27  | Subprotocol dismissed as impossible; it exists and was never priced                                       | Medium   | Accept — claim corrected                            | Phase 3    |
| 28  | Four new prod deps vs CI's `pnpm audit --audit-level=high` gate; no phase mentions it                     | Medium   | Accept                                              | Phase 1    |
| 29  | `UserRecord` vs `userSchema` shape mismatch (`displayName?` vs nullable, `Date` vs string)                | Medium   | Accept                                              | Phase 2    |

**Verified independently before acceptance:** the `handleConnection(client, request)`
signature and the un-awaited dispatch (NestJS source: `ws-adapter` emits
`('connection', ws, request)`; `subscribeConnectionEvent` subscribes without
awaiting, and `subscribeMessages` binds immediately). The token transport is sound;
the race is real. Then, for the design change: `ws`'s `verifyClient` runs inside
`handleUpgrade` and aborts with 401 **before** `completeUpgrade` constructs a
WebSocket (sync and 2-arg async forms both), and `platform-ws` spreads
`@WebSocketGateway` options into `new wsPackage.Server({ noServer: true,
...wsOptions })`, so `verifyClient` reaches it. Also verified: `PrismaUserRepository` throws in all four methods,
`CommonModule` has no `imports`, `packages/types/src/http/index.ts` has four
re-export lines, `MAX_CONCURRENT_TURNS_GLOBAL`'s rationale text, and the absence of
`data/`/`results/` under `benchmarks/live-translate/`.

### Whole-Plan Consistency Sweep

Applied deltas propagated: Phase 6 retitled (extension moved to Phase 3) and
referenced as such in Phase 3 and the phases table; e2e identity strategy stated
once in Phase 3 and referenced from Phase 2; `@Public()` enumerated per-route in one
place; the false `overrideProvider(AUTH_ADAPTER)` justification removed from Phase 1
and the corresponding step removed from Phase 3; Phase 2 effort raised 1-1.5d →
2-2.5d and Phase 3 1.5-2d → 2.5-3d to reflect discovered scope; bench baseline
created in Phase 1 and consumed by path in Phase 3; token lifetime trade-off
recorded in both plan.md and Phase 5 without altering the locked decision.

Second-pass deltas: WS auth moved from `handleConnection` + per-handler precondition
to `verifyClient` at the upgrade; `StreamSocket` removed from Phase 3's modify list
and the gateway spec restructuring dropped with it; the claims `WeakMap` removed;
Phase 5's "4401 → signOut" restated as an `/auth/me` probe, since an aborted upgrade
carries no status in the browser; `onClosed` widening retained for the distinct
mid-stream-expiry case.

No unresolved contradictions.

## Validation Log

### Session — 2026-08-22

**Questions asked:** 4. **Verification pass:** skipped per the workflow guard — the
Red Team Review above already carries verification evidence; this session resolved
only the outstanding `[UNVERIFIED]` item.

| #   | Decision point             | Chosen                      | Changed the plan?                                                                    |
| --- | -------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| 1   | WS token transport         | `Sec-WebSocket-Protocol`    | **Yes** — Phase 3 redesigned; web, extension, harness and gateway all affected       |
| 2   | Token lifetime vs XSS      | Keep 7d, ship CSP           | No — confirms the locked decision                                                    |
| 3   | Global concurrency ceiling | Leave at 6, state the limit | No — documents an accepted cap                                                       |
| 4   | e2e identity substrate     | Both in-memory and Postgres | **Yes** — Phase 3 gains a second CI job; Phase 4's policy tests move to the DB suite |

**Resolved `[UNVERIFIED]`:** the subprotocol question. The Phase 3 rewrite had
silently dropped both the rationale for `?token=` and the leakage trade-off, leaving
the choice undocumented. It is now decided and the mechanics are written down —
including the `handleProtocols` echo requirement, which is the failure mode most
likely to be discovered late.

**Still unverified, carried forward:** whether the four new production dependencies
pass CI's `pnpm audit --audit-level=high` gate. Phase 1 step 8 runs it; it cannot be
answered before install.

### Whole-Plan Consistency Sweep

Propagated: query-param references removed from Phases 3 and 5 and replaced with the
subprotocol form; the transports' modify note changed from "token on the url" to the
two-arg constructor, and the url helpers explicitly marked unchanged; Phase 4's
linking tests reassigned to the Postgres-backed suite; Phase 3's CI line split into
two jobs; the open-decisions section replaced with resolved decisions so no reader
treats settled items as still open.

Verified absent after the sweep: no `?token=` or "token on the ws url" phrasing
survives, and no phase still describes a single e2e substrate.

No unresolved contradictions.

<!-- slug: auth-nest-idp-with-nextauth-web -->
