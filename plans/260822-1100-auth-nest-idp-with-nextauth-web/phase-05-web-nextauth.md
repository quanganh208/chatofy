---
title: 'Phase 5: Web NextAuth shell'
status: done
priority: P1
effort: '1.5-2d'
dependencies: [4]
---

# Phase 5: Web NextAuth shell

## Overview

Put NextAuth v5 on `apps/web` as a thin session shell: Credentials and Google
providers both terminating at the Nest API, session-exposed token, route gating,
expiry recovery, and the CSP that this design's token exposure depends on.

Note the WS/api-client token wiring already landed in Phase 3 — this phase adds
the session that supplies the token, not the plumbing that carries it. The WS token
rides the `Sec-WebSocket-Protocol` handshake header, not the URL, so nothing here
puts a credential in a link.

## Requirements

**Functional**

- [ ] Email/password and Google login both work from the web UI
- [ ] Every existing feature route requires a session
- [ ] A 401, or a WS handshake refusal, signs the user out and returns to login
- [ ] A CSP is served

**Non-functional**

- [ ] `next-auth` pinned to an exact beta version
- [ ] `apps/web` never touches the database
- [ ] No server secret is reachable from a `'use client'` import graph

## Architecture

`strategy: 'jwt'`, **no adapter** — Next never reaches Postgres and `DATABASE_URL`
stays out of `apps/web`.

- **Credentials provider** → `POST /auth/login`.
- **Google provider** → the server-side callback forwards `account.id_token` to
  `POST /auth/google`. The browser never posts it.
- **`session` callback** copies the Nest accessToken onto `session.accessToken`;
  the client reads it via `getSession()` and feeds `getHeaders` at
  `apps/web/src/clients/api-client.ts:11` — a seam unused since it was written.

**Server secrets do not go in `src/config/env.ts`.** That module runs
`envSchema.parse(...)` at import time and is imported by `'use client'` hooks
(`use-live-translate.ts:13`, `use-streaming-translate.ts:15`). Adding a required
non-`NEXT_PUBLIC_` key there throws a ZodError in the browser at module load —
white-screening the translate page — and the deadline fix is marking `AUTH_SECRET`
optional, which is precisely the failure that matters. Server config goes in a new
`src/config/server-env.ts` guarded by `import 'server-only'`.

**No route-handler proxy.** An XSS that can read the session can also ride the
cookie, so a proxy does not make theft impossible. But it is not a wash either —
see the token-exposure trade-off below, which is a live decision, not a settled one.

**Session drift.** Auth.js jwt sessions are sliding by default — `maxAge` 30d,
`updateAge` 24h — so the cookie extends on activity while the Nest JWT is
fixed-lifetime. Left alone the user looks logged in while every call 401s, which is
indistinguishable from an outage. Align `maxAge` to the token lifetime, and treat
the recovery handler as required: with no refresh flow it is the only recovery path.

**How the client detects auth failure on the WS path.** Phase 3 refuses
unauthenticated upgrades with an HTTP 401 via `verifyClient`, which browsers surface
as a generic connection error carrying no status. So the client disambiguates by
asking: on WS connect failure, call `GET /auth/me`. 401 → `signOut()`; success →
genuine network fault, retry. Phase 3 also widened `onClosed` to carry `(code,
reason)`, which covers the different case of a token expiring _mid-stream_ — a
server-side close, where the code is available.

**Logout is client-side only** — the cookie is discarded; the Nest JWT stays valid
until expiry. Stated so nobody adds a token blacklist mid-implementation.

Next 16 renamed `middleware.ts` → `proxy.ts`; Auth.js docs predate this.

## Open trade-off for the user (do not silently resolve)

The locked decision was "no refresh tokens, one 7d access token". Red-team raised a
consequence that was not on the table when it was made: because the token is
readable from client JS (by design, so `getHeaders` and the WS url can use it), an
XSS exfiltrates a **7-day, non-revocable bearer credential** usable from any host,
offline, after the tab closes — and WebSocket handshakes are not subject to CORS, so
the stolen string opens `/ws/translate` from the attacker's machine directly.

Under this design, compromise, logout, and password change currently all mean
nothing for an already-issued token. The only lever is rotating `AUTH_JWT_SECRET`,
which signs out every user.

Options, for the user to choose:

- **Keep 7d, add the CSP** (planned below) and accept the window.
- **Shorten the lifetime** materially, accepting re-login friction.
- **Add refresh**, reversing the locked non-goal.

The plan proceeds on the first unless told otherwise, because it is the locked
decision — but it is recorded here rather than buried.

## Related Code Files

**Create**

- `apps/web/auth.ts`, `apps/web/app/api/auth/[...nextauth]/route.ts`
- `apps/web/proxy.ts` — route gating
- `apps/web/src/config/server-env.ts` — `import 'server-only'`; `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- `apps/web/app/login/page.tsx`, `src/components/auth/login-form.tsx`, `google-button.tsx`

**Modify**

- `apps/web/package.json` — pinned `next-auth@5.0.0-beta.x`
- `apps/web/next.config.ts` — add `headers()` serving a CSP. The file has none today, and the plan's stated mitigations for token exposure are otherwise "don't use localStorage" and "it expires in a week".
- `apps/web/src/clients/api-client.ts:11` — wire `getHeaders`
- `apps/web/src/components/layout/app-shell.tsx` — session-aware header
- **Not** `apps/web/src/config/env.ts` — deliberately untouched

## Implementation Steps

1. Install the exact pinned beta; confirm `pnpm install` resolves against Next 16 without `--legacy-peer-deps`.
2. Configure NextAuth: jwt strategy, `maxAge` aligned to the token lifetime, both providers, `jwt` + `session` callbacks.
3. Add `server-env.ts`; keep every secret out of the client env module.
4. Build the login page. Google-button availability comes from Auth.js's own built-in `GET /api/auth/providers`, not from the API.
5. Wire `getHeaders`; add the recovery handler — HTTP 401 → `signOut()`, and WS connect failure → probe `GET /auth/me` to distinguish auth from network before deciding.
6. Add `proxy.ts` gating; keep `/login` and static assets open.
7. Add the CSP in `next.config.ts`.
8. Manual pass: password login, Google login, protected redirect, expiry recovery.

## Success Criteria

- [ ] `pnpm install` resolves `next-auth` against Next 16 without peer-dep overrides
- [ ] Both login methods land an authenticated session
- [ ] Visiting `/translate` unauthenticated redirects to `/login`
- [ ] An expired token produces `signOut()` + redirect, **not** a silent stream of 401s — tested for the HTTP 401 path and for the WS handshake-refusal path via the `/auth/me` probe
- [ ] A WS failure while the token is still valid retries instead of signing out
- [ ] NextAuth `maxAge` equals the Nest token lifetime
- [ ] No non-`NEXT_PUBLIC_` key is referenced from a `'use client'` import graph
- [ ] A CSP header is present on responses
- [ ] `grep -rn "localStorage" apps/web/src` shows no token persistence
- [ ] `pnpm --filter web test && pnpm --filter web build` green

## Risk Assessment

**Auth.js is in maintenance mode; v5 has been beta for years and `latest` is still
v4.24.15.** The plan's one structural risk, contained by design: NextAuth touches a
cookie and two callbacks, so replacing it never reaches Nest or the shared
contracts. Signal: a beta bump changes callback shape and `account.id_token` stops
arriving. Response: stay pinned.

**Sliding-session drift** (above). Signal: users report being logged in while
everything fails. Response: the recovery handler — HTTP 401 direct, WS via the `/auth/me` probe.

**Token exposure window** (see the open trade-off). Signal: this is not a
detectable-at-runtime risk; it is a decision. Response: user's call, recorded above.

**CORS.** `CORS_ORIGIN` defaults to `*`, and sending `Authorization` triggers
preflight, where `*` plus credentials misbehaves. Set the explicit web origin here;
the `chrome-extension://` origin was needed in Phase 3 when the extension gained its
token, so verify both are present.
