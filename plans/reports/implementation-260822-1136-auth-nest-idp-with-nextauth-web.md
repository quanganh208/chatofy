---
title: 'Implementation report: Nest as IdP, NextAuth as web session shell'
plan: ../260822-1100-auth-nest-idp-with-nextauth-web/plan.md
branch: feat/auth-nest-idp
base: a1b8464
date: 2026-08-22
status: delivered (1 criterion not run — see Outstanding)
---

# Implementation report

Plan: [`plans/260822-1100-auth-nest-idp-with-nextauth-web/plan.md`](../260822-1100-auth-nest-idp-with-nextauth-web/plan.md)

Phases 1-5 delivered. Phase 6 (mobile) deferred by the plan.
7 commits, 107 files, +5512/-226.

| Commit    | Phase | Scope                                                                         |
| --------- | ----- | ----------------------------------------------------------------------------- |
| `805cc6f` | 1     | Delete `AUTH_PROVIDER`; require `AUTH_JWT_SECRET`; schema + reverse migration |
| `2375731` | 2     | Repository, argon2, JWT adapter, register/login/me, rate limits               |
| `a31b1b1` | 3     | Global guard, WS upgrade auth, every client, CI jobs                          |
| `44e191d` | 4     | Google verification + linking policy                                          |
| `eb3ec0f` | 5     | NextAuth session shell, login page, gating, CSP                               |
| `13254a6` | —     | Docs                                                                          |
| `4d2a398` | —     | Missing test for the plan's headline criterion                                |

## Verification

All run locally, all green:

- `pnpm turbo run lint typecheck test build` — 28/28 tasks
- `pnpm --filter api test:e2e` — 49 passed (8 suites, 1 skipped: needs live sidecars)
- `pnpm --filter api test:e2e:db` — 12 passed against real Postgres
- `pnpm --filter extension test:e2e` — 78 passed (Playwright, real Chromium)
- `pnpm audit --audit-level=high` — back to the pre-existing baseline, **nothing added to `ignoreGhsas`**

Beyond the suites, verified by hand against a live API + web + Postgres:
register → login → `GET /auth/me`; identical answers for a wrong password and an
unknown email; 429 with a `RATE_LIMITED` envelope past the login bucket; the
reverse migration dropping both columns and the index and the forward one
re-applying; a NextAuth session whose `accessToken` opens both `GET /auth/me` and
`/ws/translate`; the session cookie expiring at exactly 7 days; `/translate`
redirecting to `/login?next=…` while `/` stays open; the CSP header on responses.

## Decisions taken during implementation

Five places where the plan's file list and the code diverged, each deliberate:

1. **`serviceDescriptorSchema` went to `packages/types/src/http/meta.ts`, not
   `domain/`.** The plan's requirement was "export it from the shared package";
   `domain/*` is documented as entity schemas and `http/*` as wire contracts for
   HTTP endpoints, and this is the `GET /` contract.

2. **`JwtAuthGuard` and `@Public()` landed in Phase 2, not Phase 3.** Phase 2's own
   criterion — "`GET /auth/me` returns the right user for a valid token" — is not
   testable without a guard. Phase 2 applies it to that one route; Phase 3 promotes
   it to `APP_GUARD` and marks the exemptions. No churn, and each phase is coherent.

3. **The NextAuth session moved from Phase 5 into Phase 3.** Once the transports
   require a token, `apps/web` cannot compile without a source for one, and Phase 3
   exists precisely so no client is left offline. Phase 3 carries the session that
   supplies the token; Phase 5 carries the sign-in experience built on it.

4. **`verifyClient` is installed in `afterInit`, not through the gateway decorator.**
   The plan specified the decorator. Decorator arguments evaluate at class-definition
   time, before any DI container exists, so the verifier cannot be resolved there.
   Probed empirically first: `ws` re-reads `options.verifyClient` and
   `options.handleProtocols` inside `handleUpgrade` on every upgrade, a bad token
   gets HTTP 401, and **no socket is constructed** for it.

5. **No 4401 close-code branch.** The plan widened `onClosed` to `(code, reason)`
   for a token expiring mid-stream. The widening shipped, but nothing server-side
   emits a custom close code — the token is checked at the upgrade and not
   re-checked — so a branch on 4401 would have been unreachable. The code is
   reported generically instead; the client's real recovery path is the `/auth/me`
   probe, which needs no code at all.

## Things found that the plan did not anticipate

- **`next-auth@5.0.0-beta.29` carries two CRITICAL advisories.** One
  (GHSA-8fpg-xm3f-6cx3) makes existence-based auth checks fail **open** on a
  configuration error — directly relevant to a session shell. The vulnerable range
  covers every v5 beta through beta.31 and there is no v5 stable. Repinned to
  `5.0.0-beta.32`, the first release outside the range and the first on the patched
  `@auth/core@0.41.3`. This answers the plan's carried-forward unverified item.
- **Auth.js needs `trustHost` off Vercel.** Without it every auth route fails with
  `UntrustedHost`. Caught by running the built app, not by any test.
- **The proxy matcher swallowed `/`.** `'/((?!…).*)'` also matches the empty
  remainder, which is the root — so the landing page redirected everyone to login.
  Fixed with `.+`. Caught the same way.
- **429 was reported as `VALIDATION_FAILED`.** Rate limiting made 429 reachable for
  the first time, and the filter's default branch told a throttled caller to fix a
  request that was never malformed. `RATE_LIMITED` added to `errorCodeSchema`, and
  the throttler given a message written for a client rather than a class name.
  This is an additive change to a public contract, caused by the requested feature.
- **`next build` needs `AUTH_SECRET`,** because `/login` is prerendered — and turbo
  filters env vars, so `web#build` had to declare it. `NEXT_PUBLIC_API_BASE_URL`
  went into that task's **cache key**: it is inlined at build time and now also
  decides the CSP's `connect-src`, so a cached build made against localhost would
  ship a policy blocking every request the app makes.
- **The extension had no way to obtain a token.** The plan called its wiring
  "`chrome.storage` plus one extra constructor argument", which is true of the
  plumbing but not of the source. A sign-in pane was added to the popup; without it
  the extension could not reach an enforcing API at all, which is the outcome
  Phase 3 exists to prevent.
- **Rate limiting bites the test suites.** Registering 6 users from one IP trips the
  5/min bucket. Fixed in the tests, not by weakening the limit: suites now seed rows
  through Prisma except where the endpoint itself is the subject.

## Code review, and what it caught

Reviewed after the five phases landed. No critical findings and no auth bypass:
all seven acceptance criteria hold on the server, verified against source rather
than read off the tests. Ten findings below critical, of which eight are fixed.

**Three high-severity regressions, all mine, all one root cause.** `useSession()`
returns `{ data: undefined, status: 'loading' }` on the first client render, and
both translate hooks build their transport exactly once — a
`sessionRef.current ??=` in one, a `useCallback` in the other. So the token was
captured empty and never updated: **every socket dialled with no credential**,
and the recovery handler read the same empty value as "signed out" and ejected a
valid user to `/login`. Both shipping translate surfaces were broken for every
signed-in user. Fixed by making the token a reader called at connect time, and by
separating "loading" from "signed out". A regression test now exists and was
confirmed to fail against the original bug.

`eslint-plugin-react-hooks` was added with the fix — `exhaustive-deps` would have
caught it at lint time and was absent from the app this repo's own config calls
"the most defect-prone code in the project". It immediately caught a second bug
**in the fix itself**: the ref was being written during render, which StrictMode's
double pass makes unsafe.

| Finding                                                                   | Severity | Disposition                                                    |
| ------------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| Token captured before the session resolved (both hooks)                   | High     | Fixed + test                                                   |
| Recovery signed out during hydration                                      | High     | Fixed + test                                                   |
| Google linking could overwrite an existing `googleSub` (recycled address) | Medium   | Fixed + tests, write made conditional                          |
| Auth throttle keyed on the proxy IP behind an ingress                     | Medium   | Fixed — `TRUST_PROXY_HOPS`, verified both ways                 |
| `getUser` claimed a revocation the guard does not perform                 | Medium   | Comment and doc corrected; behaviour unchanged and now stated  |
| Email comparison case-sensitive end to end                                | Medium   | Fixed — normalised at the service boundary, + tests            |
| "Google not configured" reached the user as their account's fault         | Medium   | Fixed — 501, and web tells server faults from account refusals |
| Floating `argon2.hash` promise at module load                             | Low      | Fixed — handled at creation                                    |
| Proxy matcher gated SVG assets                                            | Low      | Fixed — matches any extension                                  |
| Check-then-create races surface as 500 rather than 409                    | Low      | **Not fixed** — needs a `P2002` mapping; noted below           |
| `/docs` sits outside the guard (non-production only)                      | Low      | **Not fixed** — informational; gated on `NODE_ENV`             |

## Outstanding

**The benchmark baseline was never captured, so the post-auth latency comparison
never ran.** It is the one success criterion left unticked.

Phase 1 argued it had to be taken before the tree changed or the criterion became
unfalsifiable. That premise is wrong — git preserves the pre-auth tree, so the
baseline can still be taken from a worktree at `a1b8464` and compared against the
same harness on this branch. What it needs is operational: `build-fixtures.mjs`
downloading VIVOS and LibriSpeech (both endpoints verified reachable), both
sherpa-onnx sidecars running with their models, and a Gemini key with
`gemini-3.5-live-translate-preview` access.

The harness code is done and proven: its login preamble, its 409→login fallback on
a rerun, and its two-argument socket construction were all exercised against a
live authenticated API.

**Also unproven:** one real Google id_token end to end. The verifier, the route and
every branch of the linking policy are tested against a stubbed Google, but no
Cloud Console client exists yet, so the audience check has never seen a real token.

## Known and not fixed

- **Concurrent register / Google-create races return 500, not 409.** Two
  simultaneous registrations of one email both pass the existence check and the
  loser hits Prisma `P2002`, which escapes as `INTERNAL_ERROR`. The unique
  constraint holds — no duplicate is created — so this is a status-code wart, not
  a correctness hole. The Google linking half of the same race **is** closed,
  because that write is now conditional.
- **`/docs` bypasses the guard.** Swagger is mounted on Express rather than as a
  Nest route, so `APP_GUARD` never sees it. It is gated on `NODE_ENV !==
'production'`, so it is not a production exposure, but it is an exception to
  "every route requires a token" that the `@Public()` list does not record.

## Unresolved questions

1. **Does argon2 build on the deploy target?** It builds and runs here (Linux, Node
   24). The deploy target is still unknown; the hasher seam keeps a `bcryptjs` swap
   to one file.
2. **Should the extension's sign-in stay email/password only?** It has no Google
   button — `expo-auth-session`-style native flows were out of scope, and an MV3
   popup cannot host the web redirect cleanly.
3. **`CORS_ORIGIN` — which origins should production allow?** Not a break: verified
   against the running API that a preflight carrying `Authorization` succeeds both
   with `*` (`Access-Control-Allow-Headers: authorization` is reflected, and the
   bearer flow sends no cookies so `credentials: false` costs nothing) and with an
   explicit list, where `http://localhost:3001` and a `chrome-extension://` origin
   are echoed and an unlisted origin gets no `Access-Control-Allow-Origin` at all.
   So the question is only whether to keep the wildcard in production, and the
   deployment's real origins are not something the repo can choose.
