---
phase: 2
title: 'Token revocation and socket termination'
status: completed
priority: P1
effort: '1-1.5d'
dependencies: [1]
---

# Phase 2: Token revocation and socket termination

## Overview

Make an access token stop working once the password behind it changes — on HTTP,
at the WebSocket upgrade, and **on sockets that are already open**. Reverses a
stance the codebase documents in several places, so those comments change with
the code.

## Requirements

- Functional: a token issued before a password change is refused everywhere a
  token is accepted, including a live socket.
- Functional: a database fault produces a server error, never an authentication
  failure.
- Non-functional: the audio frame hot path is untouched. A socket pays the check
  once at upgrade, plus termination when a reset actually happens.

## Architecture

### One choke point for HTTP and upgrade

`JwtAuthGuard` calls `AUTH_ADAPTER.verifyToken` (`jwt-auth.guard.ts:56`), and
`translate.gateway.ts:107` hands _the same method_ to `createVerifyClient`. The
check goes inside `JwtAuthAdapter.verifyToken` and both inherit it with no wiring
change. The `AuthAdapter` interface does not change, and `JwtAuthAdapter` already
injects `UsersService`, so this adds no coupling.

### Ceil the write; keep strict `<`

```ts
passwordChangedAt != null &&
  Math.floor(claims.iat) < Math.floor(passwordChangedAt.getTime() / 1000);
```

The stored value is **ceiled to the next whole second** at write time:
`new Date(Math.ceil(Date.now() / 1000) * 1000)`.

Truncating _down_ — the earlier design — widened the surviving band to a full
second, and the attacker reset exists to lock out is exactly the person who knows
the password and can poll `POST /auth/login`. At 10/60s per IP a handful of
addresses covers every wall-clock second cheaply, and a token that lands inside
that second survives for a **full seven days** with no recourse: there is no
logout-everywhere, and a second reset writes the same second.

Ceiling closes it fail-closed. The cost is that a legitimate login in the same
second as the reset is refused once and succeeds on retry — and reset answers 200
with no session anyway, so nobody is mid-flight.

**Guard the `NaN` fail-open.** `AuthClaims` indexes to `unknown`, and
`Math.floor(undefined) < x` is `false` — the check _passes_. Once
`passwordChangedAt != null`, reject any token whose `iat` is not a finite number.

`passwordChangedAt` is written from the **app clock**, the same one that stamps
`iat`, so skew is structurally zero. Not SQL `now()`, and not `@updatedAt`, which
flips on any write — a `preferredLanguage` change would sign every user out.

### The read goes OUTSIDE the existing `try`

`verifyToken` wraps its body in `try { … } catch { throw new
UnauthorizedException('Invalid token') }`. That collapse is right for three
_cryptographic_ failures and wrong for an infrastructure one.

Put a Postgres round trip inside it and a restarted database answers every
request and upgrade with `401`. That is not merely noisy: `use-auth-recovery.ts`
treats a 401 from `GET /auth/me` as proof the session is gone and calls
`signOut({ redirectTo: '/login' })`. A 30-second database blip would forcibly
sign out every active user across web, extension and mobile — and they could not
sign back in, because login needs the same database. Today the same outage yields
a 500 and the hook correctly keeps the session.

Distinguish the two failure modes explicitly: a **null row** → 401 (the user is
gone); a **thrown read** → propagate as 5xx.

### Terminating open sockets

Revocation at the upgrade is not enough. `JwtAuthGuard` returns `true` for every
non-HTTP context (`jwt-auth.guard.ts:45`), no frame re-authenticates, and there
is no socket max-lifetime — so an attacker holding a stolen token keeps streaming
the victim's audio and transcripts indefinitely across the reset performed to
stop them. The socket is where the sensitive data actually is.

`createVerifyClient` currently **discards the claims** (`ws-auth.ts:50`), so the
server cannot even name a live socket's owner. Two changes:

1. Surface `claims.sub` from the verifier and record it per socket in a registry
   owned by the gateway.
2. On `updatePasswordHash`, close that user's sockets.

Keep the registry in the gateway, not in `AuthService` — the API layer must not
learn about sockets. A narrow interface the gateway registers with, or an event
the gateway subscribes to, keeps the direction of dependency right.

## Related Code Files

- Modify: `apps/api/src/modules/auth/adapters/jwt-auth.adapter.ts` (+ spec — it
  now reads the database, so the spec needs the users double wired in)
- Modify: `apps/api/src/common/guards/jwt-auth.guard.ts` (comment only)
- Modify: `apps/api/src/modules/translate/ws-auth.ts` — surface `claims.sub`
- Modify: `apps/api/src/modules/translate/translate.gateway.ts` — socket registry
- Modify: `apps/extension/entrypoints/popup/use-popup.ts` — clear the stored
  token on a 401
- Test: `apps/api/test/` — upgrade refusal, and termination of a live socket

### The extension is a real touchpoint

Revocation creates a state only web can currently detect: "stored token is dead
before its `exp`". The popup calls `clearAccessToken` from exactly one place —
explicit sign-out (`use-popup.ts:185`) — and infers "signed in" from a stored
string being present. After a reset it keeps saying signed in while every capture
fails, and a refused upgrade carries no readable status, so the user sees nothing
actionable and has no reason to press the one button that would fix it.

This is a consequence of the revocation decision, so finishing it belongs here.

## Implementation Steps

1. Read `passwordChangedAt` via the phase-1 passthrough, **outside** the existing
   `try`. Null row → 401. Thrown read → propagate as 5xx.
2. Reject a non-finite `iat`, and a strictly older second.
3. Surface `claims.sub` from `createVerifyClient`; register the socket under it.
4. Close a user's open sockets when `updatePasswordHash` runs.
5. Rework `jwt-auth.adapter.spec.ts` for its new database dependency.
6. Tests: a token whose `iat` precedes a **directly written** `passwordChangedAt`
   is refused on HTTP and at the upgrade; a same-second token is refused (ceiled
   write); a non-finite `iat` is refused; a deleted user's token is refused; a
   repository that **throws** yields 5xx, not 401; an open socket is closed when
   the column is written.

   These are adapter/unit-level and prove the **check**. Phase 5 proves the
   **write** end to end — the two must not assert the same thing, or one will be
   skipped as redundant and the untested half is the one that matters.

7. Rewrite the stale comments this phase falsifies — see the enumeration in
   phase 7, and note the "never reads the database" string is in
   `jwt-auth.adapter.ts:54`, **not** in the guard.

## Success Criteria

- [x] A pre-change token is refused on `GET /auth/me` and at the `/ws/translate`
      upgrade, proven against a directly written timestamp
- [x] A token minted in the same second as the write is refused
- [x] A token with no `iat` is refused
- [x] A deleted user's token is refused
- [x] A repository failure yields a **5xx**, not a 401
- [x] A `preferredLanguage` update signs nobody out
- [x] An already-open socket is closed when its owner's password changes
- [x] The extension popup stops reporting "signed in" once its token is refused
- [x] `pnpm --filter @chatofy/api test` passes

## Risk Assessment

**No caching.** A TTL cache re-opens the window this phase exists to close. If
read cost ever measures as a problem: a 30s map keyed by userId, documented as
"revocation lag ≤ 30s". Not now, and not without a measurement.

**Nothing writes the column until phase 5.** The interim ships the per-request
read with only the row-gone benefit. That row-gone rejection is a **real
behaviour change** — a deleted user's token stops working — not a no-op; name it
in the comment rather than letting it look accidental.

**Rollback is not symmetric once phase 5 is live.** Removing the check does not
restore the prior state, it _resurrects_ tokens a reset deliberately killed,
silently, because nothing records which were revoked. After phase 5 the only safe
rollback is a forward fix; an emergency removal must be paired with rotating
`AUTH_JWT_SECRET`, which invalidates everything.
