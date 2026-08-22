---
title: 'Phase 3: Enforcement + vertical slice gate'
status: todo
priority: P1
effort: '2.5-3d'
dependencies: [2]
---

# Phase 3: Enforcement + vertical slice gate

## Overview

Turn on enforcement everywhere at once, and wire **every** client in the same
commit: global HTTP guard, WebSocket handshake auth with a real dispatch gate,
the e2e fixture, migrated suites, a CI job that actually runs them, web hooks,
the extension, and the benchmark harness. This is the gate.

## Requirements

**Functional**

- [ ] Every route requires a valid token except an explicit per-route `@Public()` list
- [ ] `/ws/translate` verifies at the HTTP upgrade and refuses with 401 before a socket exists
- [ ] **No frame from an unverified socket reaches a session service**
- [ ] Web, extension, and the benchmark harness all authenticate
- [ ] CI runs the api e2e suite

**Non-functional**

- [ ] No added round-trip before the first turn on the WS path
- [ ] Exactly one token-minting path in test code, and it is the real endpoints

## WS auth: refuse at the upgrade, not after it

Verified against upstream source for the pinned versions, not assumed.

**The naive design is racy.** `web-sockets-controller.getConnectionHandler` does
`connection.next(args)` — a synchronous `Subject` emission that invokes
`handleConnection` — and then, **on the very next line**, `subscribeMessages(...)`
binds every `@SubscribeMessage` handler. `subscribeConnectionEvent` calls
`instance.handleConnection!(...args)` inside `.subscribe()` and **discards the
return value**. So an `async handleConnection` returns a pending promise at its
first `await`, and handlers are bound and dispatching while `verifyToken` is still
in flight. Worse, because that promise is discarded, a **rejected** `verifyToken` is
an unhandled rejection — and Node 24 defaults to `--unhandled-rejections=throw`,
so an unauthenticated request could terminate the API process.

**The fix is to refuse before a socket exists.** `ws`'s `verifyClient` runs inside
`handleUpgrade` — the exact path `noServer: true` uses — and aborts before
`completeUpgrade` ever constructs a WebSocket:

- sync form: `if (!this.options.verifyClient(info)) return abortHandshake(socket, 401)`
- async form (`verifyClient.length === 2`): `verifyClient(info, (verified, code, message, headers) => { if (!verified) return abortHandshake(socket, code || 401, ...) ; this.completeUpgrade(...) })`

And gateway decorator options reach it: `platform-ws`'s adapter destructures
`const { server, path, ...wsOptions } = options` and spreads `wsOptions` into
`new wsPackage.Server({ noServer: true, ...wsOptions })`.

So `@WebSocketGateway({ path: '/ws/translate', verifyClient, handleProtocols })`,
using the **2-arg async form**, gives a real HTTP 401 on the upgrade with **no
socket, no bound handlers, and no race to gate**. `info.req` carries the upgrade
request. Errors are handled inside the callback, so there is no discarded promise
to reject unhandled.

### Token transport: `Sec-WebSocket-Protocol`, not a query parameter

Chosen at validation over `?token=`. A URL-borne token lands in server and proxy
access logs and in connection history; the handshake header does not. The earlier
draft asserted the subprotocol route was unavailable because "browsers cannot set
an `Authorization` header on a WebSocket" — true, but it conflated `Authorization`
with the subprotocol field, which browsers _can_ set via the two-arg constructor.

Mechanics, and they are load-bearing:

- Client: `new WebSocket(url, ['chatofy-v1', token])`. The token rides as the
  second offered subprotocol. A JWT is base64url plus dots, so it is a valid
  RFC 6455 subprotocol token — no encoding needed.
- `verifyClient(info, cb)` reads `info.req.headers['sec-websocket-protocol']`, a
  comma-separated list, and takes the second entry. `verifyClient` runs before
  `completeUpgrade`, so the raw header is available.
- **`handleProtocols` must echo `'chatofy-v1'`.** This is the trap: if the server
  does not select one of the offered subprotocols, browsers close the connection
  immediately after a successful handshake. Returning `false` fails it outright.
  Never echo the token back.
- `handleProtocols` reaches the `ws` server through the same `wsOptions` spread
  that carries `verifyClient`, so both arrive through the gateway decorator.
- Node clients (`ws`) take the identical two-arg form, so the benchmark harness
  changes the same way the browsers do.

Consequences that simplify the rest of this phase:

- **`StreamSocket` is not touched.** It stays `send`-only, and its deliberately
  minimal two-line fakes across the session services and their specs keep compiling.
  An earlier draft added `close()` here, which would have broken every one of them.
- **No claims `WeakMap`.** An earlier draft added one mirroring `modes`, but `modes`
  has three readers (`translate.gateway.ts:109,111,272`) and this would have had
  **zero** — per-user ceilings are a non-goal, so nothing consumes it. Write-only
  state is not added. `verifyClient` proves identity at the door; if a later feature
  needs the identity _inside_ the socket, `handleConnection` re-parses the same
  token cheaply, and that is when the map earns its place.
- The gateway's own comment at `translate.gateway.ts:60-66` ("on an endpoint that
  takes no authentication") is now false and must be updated.

**Client-side consequence.** An aborted upgrade surfaces in browsers as a generic
connection error with no status — unlike a `close(4401)`, which would have been
distinguishable. The client therefore disambiguates by asking: on WS connect
failure, call `GET /auth/me`. A 401 means auth, and the app signs out; success means
a genuine network fault, and the app retries. One cheap request, no dependence on
close codes, and it works for the HTTP path identically.

`onClosed` is still widened to carry `(code, reason)` — a token that expires
_mid-stream_ is a server-side close, not a failed handshake, and that path benefits
from the code.

## e2e identity strategy (decided here, was previously unspecified)

All five e2e suites stub `PrismaService` as `{ $queryRaw: jest.fn() }` — an object
with no `user` model — and there is no Postgres in CI. A fixture calling the real
`POST /auth/register` would hit `prisma.user.create` and `TypeError`.

**Decision (validated): both substrates, split by what each proves.**

1. **In-memory `overrideProvider(USER_REPOSITORY)` for the existing suites.** That
   token is genuinely injected (`users.service.ts:17`) and is the seam designed for
   this. The fixture drives the **real** controller, service, argon2 and JWT
   issuance — so the "one mint path" rule holds — while only the database layer is
   faked. Fast, and needs no service container.
2. **One dedicated Postgres-backed suite for auth and the linking policy.** The
   in-memory path cannot prove the things most likely to break there: the
   `googleSub` unique constraint, real `create`/`findUnique` semantics, and the
   `onDelete: Cascade` reach on user-owned rows. That suite runs against a CI
   service container with `prisma migrate deploy`, and it is the _only_ one that
   needs the database, so the rest of the suite stays fast.

## Related Code Files

**Create**

- `apps/api/src/common/guards/jwt-auth.guard.ts`
- `apps/api/src/common/decorators/public.decorator.ts`
- `apps/api/test/utils/auth-fixture.ts` — `registerAndLogin(app, overrides?)`
- `apps/api/test/utils/in-memory-user.repository.ts`
- `.github/workflows/ci.yml` — new `api-e2e` job (runs the fast in-memory suites) **and** an `api-e2e-db` job with a `postgres` service container plus `prisma migrate deploy`

**Modify**

- `apps/api/src/modules/auth/auth.module.ts` — register `APP_GUARD` **here**, not in `CommonModule`. `CommonModule` has no `imports` (`common.module.ts:15`), and `AuthModule` is not `@Global`, so a guard registered there cannot resolve `AUTH_ADAPTER`. Registering in `AuthModule` avoids widening auth's DI surface by making it global.
- `apps/api/src/modules/translate/translate.module.ts` — import `AuthModule` so the gateway can resolve the verifier
- `apps/api/src/modules/translate/translate.gateway.ts` — `@WebSocketGateway({ path, verifyClient })` using the 2-arg async form; update the now-false "takes no authentication" comment at `:60-66`
- **Not** `session/stream-socket.ts` — deliberately untouched; see above
- `apps/api/src/modules/translate/translate.gateway.spec.ts` — the gateway's constructor is unchanged, so this spec needs no restructuring. Cover `verifyClient` as a plain unit test of the exported function rather than through the gateway.
- `apps/api/src/modules/health/health.controller.ts`, `meta/meta.controller.ts`, `auth/auth.controller.ts` — `@Public()` **per route**, never at controller granularity: `POST /auth/register`, `POST /auth/login`, `GET /`, `GET /health`, `GET /health/ready`, `/docs`. `GET /auth/me` is **guarded** — marking the controller public would ship it unauthenticated, and NextAuth calls it to hydrate the session.
- `apps/api/test/*.e2e-spec.ts` — adopt the fixture
- `packages/realtime-client/src/transport/translate-socket.ts:75`, `live-translate-socket.ts:57` — `new WebSocket(url, ['chatofy-v1', token])`; the url helpers stay unchanged; widen `onClosed?: () => void` to `(code: number, reason: string) => void`. The close code is currently dropped, which makes any server-initiated close indistinguishable from a network drop — needed for the mid-stream expiry case, not for handshake refusal.
- `packages/realtime-client/src/conversation/conversation-session.ts`, `live-session.ts` — surface the close code
- `apps/web/src/hooks/use-streaming-translate.ts:113`, `use-live-translate.ts:132` — pass the token to the transport
- `apps/extension/src/direction-session.ts:107,120` — token from `chrome.storage`, passed to the transport
- `benchmarks/live-translate/run-arms.mjs:145,252,341` — login preamble + `--token` override; same two-arg `ws` constructor

## Why the clients land here, not later

An earlier draft enforced in this phase and wired web in Phase 5, with the
extension in a deferred Phase 6. That would take `apps/web` offline for two phases
and the shipped MV3 extension offline **indefinitely**, inside
meet.google.com / zoom / Teams, with no in-product explanation. The pressure that
creates points exactly one way — add an API bypass — which is the failure the
"no auth-off mode" decision exists to prevent.

Extension token wiring is `chrome.storage` plus one extra constructor argument. It is not the
`expo-auth-session` work that justifies deferring Phase 6.

## Implementation Steps

1. Add `@Public()` and `JwtAuthGuard`; register `APP_GUARD` in `AuthModule`; enumerate public routes individually. The guard's WS branch returns `true` — and that is safe _only_ because `verifyClient` already refused unauthenticated upgrades, so state the dependency in a comment. All three existing global providers bail out on non-HTTP context the same way.
2. Write `verifyClient` as an exported, independently testable function reading the token from `sec-websocket-protocol`; wire it and `handleProtocols` into the gateway decorator.
3. Wrap the verifier body so no error escapes the callback.
4. Write the in-memory `UserRepository` and `registerAndLogin` against the real endpoints.
5. Migrate every e2e suite onto the fixture. Expired-token case only: `app.get(JwtService).sign(payload, { expiresIn: '-1s' })` — the app's own service, same secret, no duplication.
6. Give the gateway spec a mock verifier via constructor arg.
7. Widen `onClosed` and thread the code through both session wrappers.
8. Two-arg `WebSocket` construction in both transports; update web hooks and the extension.
9. Add the `run-arms.mjs` preamble; accept `--token`.
10. Add both CI jobs — `api-e2e` (in-memory) and `api-e2e-db` (Postgres service container).
11. Full suite, then a harness run against a live API, compared to the Phase 1 baseline.

## Success Criteria

- [ ] `register -> login -> Bearer POST /translate` returns 200; no token returns 401 with the `UNAUTHORIZED` envelope
- [ ] `GET /auth/me` returns 401 without a token
- [ ] A valid token opens `/ws/translate` and completes one full turn
- [ ] A garbage token is refused at the **upgrade** with HTTP 401 and no socket is opened
- [ ] A spy asserts `sessions.start` / `live.start` were never invoked when a client pipelines a start frame in the same tick as a bad-token upgrade — the behavioural proof, not merely that a connection ended
- [ ] A `verifyToken` that **rejects** (not just resolves falsy) refuses the upgrade and does not crash the process
- [ ] An expired token (minted via the app's own `JwtService`) is rejected
- [ ] An unmarked route 401s, asserted on an `AppModule`-based suite (the health suite imports only `HealthModule` + `PrismaModule`, so it cannot prove this)
- [ ] `grep -rn "jwt.sign\|jsonwebtoken" apps/api/test` finds nothing outside the sanctioned expired-token case
- [ ] A connection offering no subprotocol, or only `chatofy-v1` with no token, is refused at the upgrade
- [ ] The server echoes `chatofy-v1` and the browser connection **stays open** — the specific failure mode is a handshake that succeeds then closes instantly
- [ ] The token never appears in a request URL (`grep` the harness and both transports for `token=`)
- [ ] Both CI jobs run and pass on this PR
- [ ] `node benchmarks/live-translate/run-arms.mjs --api http://localhost:3000` completes, compared against the Phase 1 baseline file by path
- [ ] `pnpm turbo run lint typecheck test` plus `pnpm --filter api test:e2e` green

## Risk Assessment

**Unauthenticated frames execute before rejection.** Structural, confirmed in
framework source: Nest does not await `handleConnection` and binds handlers on the
next line. Signal: the behavioural criterion above fails. Response: `verifyClient`
removes the window by construction rather than gating it — no socket is created, so
there is nothing to dispatch to. A `handleConnection`-based implementation would
additionally need `client.pause()`/`resume()` around the await and a `try/catch`
against the unhandled-rejection crash path; refusing at the upgrade needs neither.

**The benchmark harness breaks and the thesis loses its measurement toolchain.**
It opens `/ws/translate` directly at `run-arms.mjs:145,252`. Response: the preamble
ships here, and a harness run gates the phase. Note the harness needs fixtures built
before it can start at all.

**Guard 401s something unexpected** — a probe, Swagger, the root descriptor. Signal:
a failing suite or unreachable `/docs`. Response: extend the per-route list; never
widen the guard default.

**This is the largest commit in the plan.** It touches the API, both transports,
web, the extension, the harness and CI. It cannot be split without leaving the
product broken between phases, but it is correspondingly hard to bisect. Response:
land it behind a single revert-able merge and keep the Phase 1 baseline available
to compare against.
