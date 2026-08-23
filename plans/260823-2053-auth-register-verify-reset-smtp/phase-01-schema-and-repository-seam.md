---
phase: 1
title: 'Schema and repository seam'
status: completed
priority: P1
effort: '3-4h'
dependencies: []
---

# Phase 1: Schema and repository seam

## Overview

One nullable column on `User`, and the repository methods later phases read and
write through. No backfill, no data migration, no behaviour change.

## Why there is no `emailVerifiedAt` column

Deferred registration removes the need for one. Under this design a row only
exists once its verification link has been redeemed, so **every password row is
mailbox-proven by construction** and Google rows already carry `googleSub`.
Nothing would ever read the column.

Dropping it also removes the whole class of migration hazard the earlier design
carried: a one-shot backfill `UPDATE` only covers rows present when it runs, so
anyone registering between this phase's deploy and the enforcement deploy would
have been locked out. There is no window to get wrong now.

## Requirements

- Functional: `passwordChangedAt` exists, is readable by the auth path on every
  request, and is writable only through a named method.
- Non-functional: `UserRecord` must not become a way for a secret to reach a
  response. `RECORD_SELECT` and `toUserContract` both list fields explicitly —
  keep it that way.

## Architecture

**The read path is decided here, not improvised in phase 2.**
`findAuthStateById(id)` returns `{ id, passwordChangedAt }` — the per-request
read. It cannot leak into a response by construction, which a widened
`UserRecord` could, and it matches how `findCredentialsByEmail` already isolates
secret-adjacent reads.

**`UsersService` needs a passthrough.** `JwtAuthAdapter` injects `UsersService`,
not the repository, and that service exposes only
`findById`/`findByEmail`/`create`/`update`. Phase 2 cannot reach
`findAuthStateById` without it.

**Writes** get a dedicated method — `updatePasswordHash(id, hash, changedAt)` —
mirroring `linkGoogleSub`. `UpdateUserDto` must never become able to write a hash.

`CreateUserDto` is **not** widened. Register constructs its object field by field
(`auth.service.ts:134-138`), and it must keep doing so: a future
`this.users.create({ ...dto })` would let a client set fields it should never
control.

## Related Code Files

- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<generated>/migration.sql`
- Modify: `apps/api/src/modules/users/interfaces/user-repository.interface.ts`
- Modify: `apps/api/src/modules/users/repositories/prisma-user.repository.ts`
- Modify: `apps/api/src/modules/users/users.service.ts` — the passthrough phase 2 needs
- Modify: **both** `UserRepository` doubles —
  `apps/api/test/utils/in-memory-user.repository.ts` (used by the non-DB e2e
  suite) and the exhaustive `jest.Mocked<UserRepository>` object literal at
  `apps/api/src/modules/auth/auth.service.spec.ts:33-41`, which fails to compile
  the moment the interface grows
- Read: `apps/api/src/modules/users/mappers/to-user.mapper.ts` (confirm no spread)

## Implementation Steps

1. Back up the database before touching it.
2. Add `passwordChangedAt DateTime?` to the `User` model.
3. Generate with `prisma migrate dev --create-only`, then apply. The repo's
   `prisma:migrate` script is plain `migrate dev`, which generates **and
   applies** in one step — fine here because there is no hand-written SQL to add,
   but `--create-only` is the habit to keep for any migration that needs editing.
4. Add `findAuthStateById(id)`, `findCredentialsById(id)` and
   `updatePasswordHash(id, hash, changedAt)` to the interface, the Prisma
   implementation, and **both** doubles. Add the `findAuthStateById` passthrough
   to `UsersService`.
5. Fix the `jest.Mocked<UserRepository>` literal by adding `jest.fn()` entries —
   **never** by casting through `as unknown`, which would permanently remove the
   compiler's ability to catch the next interface drift in the highest-risk spec
   in this change.

## Success Criteria

- [x] Migration applies cleanly on a fresh database and on one holding rows
- [x] No response anywhere gains the new column — asserted, not assumed
- [x] Both doubles compile without a cast
- [x] `pnpm --filter @chatofy/api test` and typecheck pass

## Risk Assessment

**A cast is used to unblock the spec.** Signal: `as unknown as
jest.Mocked<UserRepository>` appears in the diff. Response: reject it in review —
the whole value of that literal is that it is exhaustive.

**Rollback:** the column is nullable and nothing reads it until phase 2. Note
that the repo has **no down-migration convention** — `prisma/migrations/` is
forward-only — so a rollback means a new forward migration, not a revert.
