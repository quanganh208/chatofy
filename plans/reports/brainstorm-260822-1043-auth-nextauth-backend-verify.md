# Brainstorm — Auth (NextAuth web + Nest backend verify)

Date: 2026-08-22 · Branch: main · Status: contract accepted, **planned**

> **Superseded in part.** The user subsequently directed that `AUTH_PROVIDER` be
> deleted rather than extended, and verification proved it never gated anything.
> The passages below marked _(superseded)_ are kept for decision history; the
> executable authority is
> [`plans/260822-1100-auth-nest-idp-with-nextauth-web/plan.md`](../260822-1100-auth-nest-idp-with-nextauth-web/plan.md).

## Contract

**Outcome.** Nest API is the identity authority: owns password hashing, verifies
Google id_tokens, issues its own access JWT. NextAuth v5 on `apps/web` is a thin
session shell over those endpoints. Every existing feature (`POST /translate`,
`/ws/translate`) requires a valid identity.

**Constraints.**

- NextAuth is a fixed user decision. Only `5.0.0-beta.32` peer-accepts `next ^16`
  (verified against the npm registry: `next: ^14 || ^15 || ^16`, `react: ^18.2 || ^19`).
  There is no stable v5 — `latest` is v4.24.15. Auth.js is in maintenance mode.
  Pin the exact beta version.
- `apps/mobile` (Expo) and `apps/extension` (MV3) call the same API and can never
  hold a NextAuth cookie.
- `/ws/translate` is raw `ws` (@nestjs/platform-ws), not socket.io. Browsers cannot
  set an `Authorization` header on a WebSocket.
- `pnpm-workspace.yaml` carries an `allowBuilds` supply-chain allowlist; a native
  dependency needs an explicit entry.
- Latency on the translate path is what this project measures. No added hops.

**Non-goals.** Refresh-token rotation and reuse detection; revocation before expiry;
per-user concurrency ceilings on the gateway; a "set password" flow for Google-first
users; magic links; email verification; swapping the provider to Better Auth.

**Acceptance criteria.**

1. `register -> login -> Bearer POST /translate` returns 200; no token returns 401
   carrying the `UNAUTHORIZED` envelope.
2. That same token opens `/ws/translate` and completes one turn; a bad token closes
   with code `4401`.
3. Google login creates or links the correct user, and never auto-links when
   `email_verified !== true`.
4. `passwordHash` never appears in any response.
5. `pnpm lint && typecheck && test` green, including the pre-existing e2e suite.

## Decisions locked with the user

| Question                  | Chosen                                                              |
| ------------------------- | ------------------------------------------------------------------- |
| Scope of "login required" | Web first (P1-P4); mobile/extension deferred to P5                  |
| Refresh tokens            | None. One access token, 7d, `expiresAt` set, `refreshToken` omitted |
| Password hashing          | `argon2` + an explicit `allowBuilds` entry                          |

## Direction: Nest is the IdP, NextAuth is a client shell

Rejected: NextAuth as IdP with Nest verifying its session token. It fails the
multi-client requirement outright, and v5 session tokens are JWE (HKDF-derived),
so Nest would have to reimplement Auth.js key derivation — binding the API to the
internals of a beta library in maintenance mode.

The chosen direction also confines NextAuth to the thinnest replaceable layer
(a session cookie plus two callbacks). If the beta bites, another provider slots
in without touching Nest or the shared contracts.

Load-bearing assumption: Auth.js beta keeps exposing `account.id_token` in its
callbacks. First failure mode is a beta bump changing the callback shape, which is
why the version is pinned.

## The seam already exists

| Existing                                                         | Location                                                            | State                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| `AuthAdapter { verifyToken, getUser, issueToken? }`              | `apps/api/src/modules/auth/interfaces/auth-adapter.interface.ts:22` | bound to `NoopAuthAdapter`, which throws |
| `authTokenSchema`, `loginRequestSchema`, `registerRequestSchema` | `packages/types/src/http/auth.ts`                                   | defined, zero implementations            |
| `getHeaders` ("e.g. bearer token")                               | `packages/api-client/src/api-client.ts:20`                          | zero call sites                          |
| `401 -> UNAUTHORIZED`                                            | `apps/api/src/common/filters/all-exceptions.filter.ts:20`           | already mapped                           |

`issueToken?` is documented as "only for providers that issue tokens themselves
(e.g. custom JWT)" — precisely this design. This is wiring a designed-for extension
point, not a retrofit.

## Technical decisions

- **Google.** NextAuth Google provider; the server-side callback forwards
  `account.id_token` to `POST /auth/google`. Nest verifies via
  `google-auth-library.verifyIdToken` (JWKS + an audience _allowlist_, sized for
  future iOS/Android client ids). Do not hand-roll jose + JWKS. The browser never
  posts the id_token.
- **Token location on web.** The `session` callback copies the Nest accessToken to
  `session.accessToken`; the client reads it via `getSession()` and feeds
  `getHeaders`. No route-handler proxy: any XSS that can steal the token can equally
  call a proxy with the victim's cookie, so a proxy changes _what_ is stolen, not
  _whether_ — while adding a hop to the measured path and being unable to carry the
  WebSocket at all. Never localStorage; in-memory plus the session endpoint only.
- **WebSocket.** Authenticate at the HTTP upgrade: `handleConnection(client, request)`
  parses `?token=` from `request.url` and verifies through `AUTH_ADAPTER`; failure
  closes with `4401`. Claims go in a `WeakMap` mirroring the existing `modes` WeakMap
  (`translate.gateway.ts:77`). This preserves the "first message claims the mode"
  invariant and costs no extra RTT — a first-frame handshake would cost one RTT on
  the latency path plus queue-until-acked logic in both transports. Client change is
  one line each in `translate-socket.ts:75` and `live-translate-socket.ts:57`.
  Policy: the token is checked at handshake only, so expiry mid-meeting does not kill
  a live stream. Deferred production upgrade: a short-lived one-time ws ticket.
- **Schema.** `User` only: `passwordHash String?` (nullable, for Google-only users)
  and `googleSub String? @unique` (Google's stable `sub`; never key identity on
  email). No Account/Session/VerificationToken tables — NextAuth runs
  `strategy: 'jwt'` with no adapter, so `apps/web` never touches the database and
  `DATABASE_URL` stays out of it. Linking: look up by `googleSub` first; link to an
  existing user by email _only_ when `email_verified === true`; otherwise create.
  Auto-linking on an unverified provider email is the classic account-takeover bug.
  `passwordHash` is select-excluded at the repository boundary.
- **Provider enum.** _(superseded)_ This originally grew by one value to
  `['none','noop','local']`, with an additive `methods` field on
  `authProvidersResponseSchema`. Both are now **deleted** instead: `AUTH_PROVIDER`
  is removed entirely, `GET /auth/providers` with it, and Auth.js's own built-in
  `GET /api/auth/providers` serves web's Google-button discovery — the only layer
  that actually owns that answer. See the plan's "Why `AUTH_PROVIDER` is deleted
  rather than extended".
- **Next 16.** Use `proxy.ts`, not `middleware.ts` — Next 16 renamed it and the
  Auth.js docs predate the change. `middleware.ts` still works but is deprecated.
- Login errors must not leak account existence (generic "invalid credentials").
  A register conflict revealing existence is normal and fine.

## Guard semantics per `AUTH_PROVIDER` _(superseded — see note)_

> Resolved by deletion rather than specification: with no `AUTH_PROVIDER` there is
> no mode to define, and the guard simply always enforces. The analysis below is
> retained because it is _why_ the env var had to go.

The env default is `none`, which today binds `NoopAuthAdapter` — and that adapter
throws `NotImplementedException` from `verifyToken`. Registering the global
`APP_GUARD` naively therefore turns the very next `pnpm dev` and every existing e2e
boot into a wall of 500s. This is the top P1/P2 discovery risk; the plan must pin it
up front:

| Value   | Guard behavior                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------- |
| `none`  | auth **disabled** — guard passes anonymous. Matches the value's advertised meaning and keeps a dev escape hatch. |
| `noop`  | wiring test double only.                                                                                         |
| `local` | enforce.                                                                                                         |

Two consequences the plan must carry:

- The e2e suite runs under `AUTH_PROVIDER=local` with a fixed `AUTH_JWT_SECRET` —
  **not** under `none`, or the suite silently stops testing what was built.
- Acceptance criterion 1's 401 only means anything under `local`, so the gate runs
  under `local`.

## Test fixture design (P2, atomic with the guard)

One rule: exactly **one** mint path, and it is the real one.

- **e2e (supertest):** a shared `registerAndLogin(app, overrides?)` helper in the e2e
  utils that hits the real `POST /auth/register` + `POST /auth/login` and returns
  `{user, accessToken}`. Called once per suite in `beforeAll`. **No `jwt.sign` with a
  copied secret anywhere in test code** — that copy is a second source of truth and
  rots the moment signing options change.
- **WS e2e:** the same helper's token appended to the ws url. Bad-token case is any
  garbage string. The expired-token case is the only tolerable raw sign, and it pulls
  the app's own configured `JwtService` out of the DI container
  (`app.get(JwtService).sign(payload, { expiresIn: '-1s' })`) — same secret, same
  config, no duplication.
- **Unit specs** (`translate.gateway.spec.ts` and friends, no full boot):
  `Test.createTestingModule(...).overrideProvider(AUTH_ADAPTER)` with a stub returning
  fixed claims. That is DI substitution of a declared seam, not a parallel issuance
  path — the unit scope is gateway behavior, not token verification, and
  `auth-adapter.interface.ts:22` exists precisely for this.

Guard, helper, and suite migration are **one atomic step**. The guard breaks every
suite the moment it goes global, so "auth first, fix tests after" is not a viable
split.

## Phasing

- **P1** — shared contracts (`local` enum value, `googleLoginRequestSchema{idToken}`,
  `methods` field), Prisma migration, env schema (`AUTH_JWT_SECRET` required when
  `AUTH_JWT_SECRET` unconditionally required, since no provider switch remains to
  gate it on; Google client ids optional).
- **P2** — `JwtAuthAdapter` implementing the existing interface incl. `issueToken`;
  `AuthService` (argon2); `POST /auth/register`, `POST /auth/login`, `GET /auth/me`;
  global `APP_GUARD` + `@Public()` (public: register, login, google, providers,
  health, docs); WS handshake guard.
- **GATE** — vertical slice proving acceptance criteria 1 and 2. Exercises all three
  risky seams: issuance, the HTTP guard through the existing filter's UNAUTHORIZED
  mapping, and the raw-ws upgrade path. Everything after this is repetition.
- **P3** — `POST /auth/google` plus the linking policy, tested against a real id_token.
- **P4** — web: pinned `next-auth@5.0.0-beta.32`, Credentials provider to
  `/auth/login`, Google provider forwarding the id_token, session callback exposing
  the token, `getHeaders` wiring, WS url token, route gating via `proxy.ts`.
  **Required, not polish:** a handler mapping `ApiClientError` 401 and WS close `4401`
  to `signOut()` + redirect to login. With no refresh flow this is the _only_ recovery
  path from expiry. See the session-drift risk below.
- **P5** (deferred) — extension/mobile token storage (`chrome.storage`, expo
  SecureStore). The `/auth/google` + Bearer design serves them unchanged, which is
  the evidence this direction was right.

## Risks

- Auth.js perpetual beta / maintenance mode is the one structural risk. Contained by
  the design; mitigated by pinning.
- `CORS_ORIGIN` defaults to `*`. Sending `Authorization` triggers preflight, and
  `*` plus credentials misbehaves. Set the explicit web origin, and remember the
  `chrome-extension://` origin at P5.
- **The benchmark harness.** `benchmarks/live-translate/run-arms.mjs:145,252` opens
  `/ws/translate` directly with `--api http://localhost:3000` (`:341`). It is the
  project's own measurement toolchain, and always-enforce breaks it. Fixed by
  teaching it to log in, in the same phase as the WS guard — never by an auth-off
  mode. Discovered after this report was first written.
- **Largest hidden cost:** "login required for every existing feature" means
  `translate.gateway.spec.ts` and the whole supertest e2e suite need an auth fixture.
  Budget this explicitly — it exceeds the cost of auth itself.
- argon2 is native. `AuthService` must isolate hash/verify behind two private methods
  (or one small hasher provider) so a fallback to pure-JS `bcryptjs` is a one-file swap
  if the target cannot build natives. Do **not** pre-build the fallback. "argon2 builds
  on the deploy target" is a P2 exit check.
- **Session drift (no-refresh x 7d).** Auth.js jwt-strategy sessions are _sliding_ by
  default — verified against the Auth.js reference: `maxAge` 30d, `updateAge` 24h, so
  the cookie re-issues and extends on activity while the Nest JWT is fixed-lifetime.
  Left alone, the user looks logged in while every API call 401s, which is
  indistinguishable from an outage. Align NextAuth `maxAge` to the token lifetime and
  rely on the P4 401 handler; accept re-login at day 7 sharp.
- **Logout is client-side only.** The session cookie is discarded; the Nest JWT stays
  valid until expiry. Stated here so nobody "helpfully" adds a token blacklist
  mid-implementation — that is refresh-token scope returning through the side door.
- Acceptance criterion 4 is cheap to enforce mechanically, since every response already
  crosses one `TransformInterceptor` and one zod contract boundary. Pin it with a test
  asserting `/auth/me` and the login/register responses parse against a strict
  `userSchema`, rather than trusting select-exclusion alone.
- Stale in-repo contradiction to fix: `apps/api/.env.example:12` advertises
  `none | supabase | betterauth`, but the zod enum is `['none','noop']`.

## Unresolved questions

1. **Deploy target — does argon2 build there?** Blocks nothing before P2; mitigated by
   the hasher seam above. Tracked as a P2 exit check.
2. **Google OAuth client id/secret.** Blocks P3 _execution_ only — P1, P2 and the gate
   need nothing from Cloud Console. Carried as a P3 precondition: client id/secret
   provisioned and consent screen configured. Test id_tokens come from the OAuth
   playground once it exists.

_(A third question about 7d expiry with no pre-expiry revocation was raised and is now
closed — it duplicates the locked "no refresh tokens" decision. Recorded here so the
plan does not reopen it.)_
