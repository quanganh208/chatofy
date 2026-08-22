---
title: 'Phase 2: Auth core + endpoints'
status: todo
priority: P1
effort: '2-2.5d'
dependencies: [1]
---

# Phase 2: Auth core + endpoints

## Overview

Implement the identity authority: the user repository (currently entirely
unimplemented), argon2 hashing, JWT issuance and verification through the existing
`AuthAdapter` seam, the three password endpoints, and rate limiting on all of them.
Nothing is enforced yet — the guard lands in Phase 3.

## Requirements

**Functional**

- [ ] `PrismaUserRepository`'s four methods actually query the database
- [ ] `POST /auth/register` creates a user with an argon2 hash and returns an `AuthSession`
- [ ] `POST /auth/login` verifies credentials and returns an `AuthSession`
- [ ] `GET /auth/me` returns the caller's profile from a verified token
- [ ] `JwtAuthAdapter` implements `verifyToken`, `getUser`, and `issueToken`
- [ ] All three routes are rate limited per IP

**Non-functional**

- [ ] `passwordHash` cannot leave the repository layer
- [ ] Login failures do not reveal whether an account exists
- [ ] Token lifetime is 7d, matching the locked no-refresh decision

## Scope correction

`PrismaUserRepository` is **not** a working repository needing a tweak. All four
methods are `throw new NotImplementedException(...)`
(`prisma-user.repository.ts:19-33`). An earlier draft said "select-exclude
`passwordHash`" as if queries existed. They must be written from zero, which is
why this phase's estimate is 2-2.5d rather than the 1-1.5d first assigned.

## Architecture

`JwtAuthAdapter` fills the interface at `auth-adapter.interface.ts:22`, including the
optional `issueToken` documented from the start as "only for providers that issue
tokens themselves (e.g. custom JWT)". `AuthModule` swaps its `AUTH_ADAPTER` binding
from `NoopAuthAdapter` to `JwtAuthAdapter`, and `NoopAuthAdapter` is deleted **in
that same commit** — it cannot go earlier (the module needs a binding) and must not
survive later as a dead second implementation.

Hashing is isolated behind two private methods on `AuthService` so an argon2 →
`bcryptjs` swap stays a one-file change if the deploy target cannot build natives.

`passwordHash` is select-excluded in the repository so it never reaches
`UsersService` or a mapper. That is a convention, not a guarantee — the guarantee
is the strict-schema response test in the success criteria, which is the **only**
mechanical defence.

**Rate limiting.** The repo has none (`grep -rn "throttler\|rate-limit\|helmet"`
over `apps/api` returns nothing). Every auth route is `@Public()` by necessity, and
argon2id defaults to 64 MiB per hash on the libuv threadpool (4 threads, shared with
fs and crypto). ~20 concurrent logins pin ~1.3 GB and starve the turn pipeline —
on a machine whose translate path already budgets memory to the byte. This is one
module and a decorator, not a phase, and it belongs here rather than in a
"hardening later" that never comes.

**Account-existence oracle (accepted, documented).** This phase requires login
failures to be indistinguishable. `POST /auth/register` still answers 409 vs 201 on
an existing email, which is a perfect oracle for the same fact. Closing it properly
needs an email-verification flow, which is an explicit non-goal. It is therefore
**accepted and recorded here**, rather than left as a silent contradiction of this
phase's own requirement.

## Related Code Files

**Create**

- `apps/api/src/modules/auth/adapters/jwt-auth.adapter.ts` + spec
- `apps/api/src/modules/auth/auth.service.ts` + spec
- `apps/api/src/modules/auth/dto/auth.dto.ts` — **one** file holding all auth DTOs, matching `translate/dto/translate.dto.ts` which keeps two classes in one file. Not four single-class files.

**Modify**

- `apps/api/src/modules/auth/auth.module.ts` — `JwtModule` (secret + 7d from config), `ThrottlerModule`, bind `AUTH_ADAPTER` to `JwtAuthAdapter`, register `AuthService`
- `apps/api/src/modules/auth/auth.controller.ts` — three routes with per-route throttle
- `apps/api/src/modules/users/repositories/prisma-user.repository.ts` — implement all four methods; select-exclude `passwordHash`; add `findByGoogleSub` and a create path taking a hash
- `apps/api/src/modules/users/interfaces/user-repository.interface.ts` — extend `CreateUserDto` for the hash without exposing it on `UserRecord`
- `apps/api/package.json` — `argon2`, `@nestjs/jwt`, `@nestjs/throttler`

**Delete**

- `apps/api/src/modules/auth/adapters/noop-auth.adapter.ts` + spec (same commit as the binding swap)
- `docs/codebase-summary.md:45` and `docs/system-architecture.md:467` — both still name `NoopAuthAdapter` as the active binding; update rather than leave a reader concluding auth is unimplemented

## Implementation Steps

1. Implement `PrismaUserRepository` against the real schema.
2. Add `@nestjs/jwt` + `argon2`; wire `JwtModule` from config (`expiresIn: '7d'`).
3. Write `JwtAuthAdapter` including `issueToken`.
4. Write `AuthService` with the hasher seam: `register`, `login`, `findMe`.
5. Add `@nestjs/throttler` with a tight per-IP bucket on all auth routes.
6. Add the three controller routes with `createZodDto` DTOs in one file.
7. Swap the `AUTH_ADAPTER` binding and delete `NoopAuthAdapter` together.
8. Update the two doc tables.
9. `pnpm --filter api test && pnpm --filter api test:e2e`.

## Success Criteria

- [ ] Register then login round-trips; the token verifies through `verifyToken`
- [ ] `GET /auth/me` returns the right user for a valid token
- [ ] Wrong password and unknown email produce the **same** generic error and status
- [ ] Responses parse against `userSchema` — note `UserRecord` has `displayName?: string` and `createdAt: Date`, while `userSchema` requires `displayName` **nullable** (so `undefined` fails) and `createdAt` as a **string**. The mapper must normalize both.
- [ ] A test asserts login/register/me responses parse against a **strict** `userSchema` — the only mechanical proof `passwordHash` never leaks
- [ ] Exceeding the login rate limit returns 429 rather than queuing argon2 work
- [ ] `NoopAuthAdapter` no longer exists anywhere in the tree
- [ ] argon2 builds and runs on the deploy target _(open question 1 closes here)_

## Risk Assessment

**Deleting `NoopAuthAdapter` early leaves `AUTH_ADAPTER` unbound and the app
unbootable.** Signal: DI resolution error at startup. Response: the ordering above
is mandatory — binding swap and deletion are one commit.

**Unmetered argon2 on a public route is a cheap DoS against the translate
pipeline.** An earlier draft dismissed argon2 cost as "not a real risk at this
scale", which reasoned about legitimate load and said nothing about an attacker
choosing the request rate. Signal: threadpool saturation visible as turn-latency
regression under concurrent login traffic. Response: the throttler in step 5.

**`passwordHash` leaks through a mapper added later.** Response: the strict-schema
test, not code review.
