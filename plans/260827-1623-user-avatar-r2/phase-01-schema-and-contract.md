---
phase: 1
title: 'Schema and contract'
status: completed
priority: P1
effort: '4h'
dependencies: []
---

# Phase 1: Schema and contract

## Overview

Add the two avatar columns, thread them through the repository seam, and expose a
composed `avatarUrl` on the public `User` contract. No storage and no write path
yet — this phase ends with every read returning `avatarUrl: null`.

## Requirements

- Functional: `GET /auth/me` returns `avatarUrl`, null for every existing row.
- Non-functional: migration is additive with no backfill; the contract change cannot
  break an older API talking to a newer client; no secret column reaches a response.

## Architecture

**Two columns, one migration.** `avatarKey` holds the R2 object key. `avatarChangedAt`
records when this row's avatar last changed by any means — upload, removal, or import.

The second column exists because `avatarKey` alone cannot answer the question Phase 4
must ask. A null key means _both_ "never had an avatar" and "the user deliberately
removed one", and importing Google's picture is right in the first case and wrong in
the second. `avatarChangedAt` splits them: null means nothing has ever touched this
row's avatar, so an import is a first value rather than an overwrite; non-null means a
decision was already made and must not be undone.

A timestamp rather than a boolean, and stamped by hand rather than `@updatedAt`, for
the reason `passwordChangedAt` gives in this same model: `@updatedAt` flips on any
write, so editing a display name would silently re-enable the import. It is the same
shape as `passwordChangedAt` on purpose — a nullable instant recording when one
specific field last changed, read as a gate.

**Store the key, expose the URL.** The column holds an object key, not a full URL, so
moving the public origin is an env change instead of an `UPDATE` over every row.
`toUserContract` therefore takes the configured base as a second argument. It has
exactly three call sites, all in `auth.service.ts:184,196,209` (verified — no spec or
e2e file calls it), but the change ripples further than those: `AuthService` gains a
`ConfigService` dependency, and it is constructed positionally in a spec.

**`R2_PUBLIC_BASE_URL` is added to the env schema HERE, not in Phase 2.** `validateEnv`
returns only parsed schema keys and every consumer reads through
`ConfigService<Env, true>` with `{ infer: true }`, so a key absent from `envSchema` is
a compile error, and a cast would return `undefined` forever because `ConfigService`
never falls back to `process.env`. Reading it before the schema declares it is not
possible, so the schema entry belongs in the phase that first reads it. The other four
`R2_*` variables stay in Phase 2, where they are first used.

**`avatarUrl` is `.nullable().default(null)`, not a bare required key.**
`packages/types/src/domain/user.ts` documents twice that this schema is the client's
`safeParse` boundary and is kept permissive so a newer API cannot break an older
client. A required key inverts that guarantee in the other direction: a newer _client_
would reject an older API's response, and `apiFetch` turns a parse miss into a thrown
`ContractError`, not a missing field. The blast radius is the whole page — `getMe()`
rejects, `AccountCard` renders its load-failed state — over a decorative field. With
`.default(null)`, an absent key parses to null and `User` stays non-optional for
API-side consumers.

## Related Code Files

- Create: `apps/api/prisma/migrations/<timestamp>_add_user_avatar/migration.sql`
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/config/env.schema.ts` (`R2_PUBLIC_BASE_URL` only)
- Modify: `apps/api/src/modules/users/interfaces/user-repository.interface.ts`
- Modify: `apps/api/src/modules/users/repositories/prisma-user.repository.ts`
- Modify: `apps/api/src/modules/users/mappers/to-user.mapper.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts` (3 call sites + constructor)
- Modify: `apps/api/src/modules/auth/auth.module.ts` (if the new dependency needs wiring)
- Modify: `apps/api/src/modules/auth/auth-flow.harness.ts` (`mockUsers` gains a method)
- Modify: `apps/api/src/modules/auth/auth.service.spec.ts` (positional constructor)
- Modify: `packages/types/src/domain/user.ts`
- Modify: `apps/api/test/utils/in-memory-user.repository.ts`
- Create: `apps/api/src/modules/users/mappers/to-user.mapper.spec.ts`

## Implementation Steps

1. `schema.prisma`: add both columns to `model User`.

   ```prisma
   // The R2 object key for this account's avatar, or null for none.
   //
   // A KEY, not a URL. The public origin is configuration — moving the bucket
   // behind a different domain must not be a data migration — so the key is what
   // is durable and `toUserContract` composes the URL from it at the boundary.
   avatarKey       String?
   // When this row's avatar last changed by ANY means: the account holder set one,
   // removed one, or a Google picture was imported on first sign-in.
   //
   // Null is the only state that permits an import. A null `avatarKey` cannot carry
   // that meaning on its own — removing an avatar produces the same null as never
   // having had one, and re-importing over a deliberate removal would leave a Google
   // user no way to have no picture.
   //
   // Deliberately not `@updatedAt`, for the reason `passwordChangedAt` gives: that
   // flips on any write, so renaming an account would re-open the import.
   avatarChangedAt DateTime?
   ```

2. `prisma migrate dev --name add_user_avatar`. Confirm the SQL is two nullable
   `ADD COLUMN`s with no default and no backfill.

3. `env.schema.ts`: add `R2_PUBLIC_BASE_URL` only, following the `emptyStringAsUndefined`
   convention, with a comment that the other `R2_*` keys arrive with the storage module
   and that this one is here because the mapper needs it first.

   ```ts
   // The public origin avatars are SERVED from — a custom domain attached to the
   // bucket. Not derivable from the account id: the r2.cloudflarestorage.com
   // endpoint is the S3 API and is not publicly readable.
   R2_PUBLIC_BASE_URL: emptyStringAsUndefined(z.string().url().optional()),
   ```

4. `user-repository.interface.ts`: add `avatarKey?: string` and
   `avatarChangedAt?: Date` to `UserRecord` beside `locale`, reusing that field's
   rationale. Add to `UserRepository`:

   ```ts
   /**
    * Sets or clears this row's avatar key and stamps when it changed, in one write.
    *
    * One method rather than a widened DTO, for the reason `updateLocale` gives: a
    * DTO built from a request body must not be able to name a column the caller has
    * no business setting. The two fields move together because a key written without
    * its timestamp leaves the Google import able to overwrite a deliberate choice.
    *
    * `changedAt` is supplied by the caller from the app clock, matching
    * `updatePasswordHash`, so there is no second clock to reason about.
    */
   updateAvatarKey(id: string, avatarKey: string | null, changedAt: Date): Promise<UserRecord>;
   ```

5. `prisma-user.repository.ts`: add both columns to the shared select, the row type and
   the record mapping (`?? undefined` for each), and implement `updateAvatarKey` beside
   `updateLocale`.

6. `packages/types/src/domain/user.ts`:

   ```ts
   // Derived from a stored object key, not a stored URL — see the api's User model.
   //
   // `.default(null)` rather than a bare required key: this schema is the client's
   // safeParse boundary, and a required field makes a NEWER client reject an OLDER
   // api's response — which `apiFetch` raises as a thrown ContractError, failing the
   // whole request rather than omitting one field.
   avatarUrl: z.string().nullable().default(null),
   ```

7. `to-user.mapper.ts`: widen the signature and compose.

   ```ts
   export function toUserContract(row: UserRecord, avatarBaseUrl?: string): User {
     return {
       // ...existing fields, still listed explicitly — never `...row`
       avatarUrl:
         row.avatarKey && avatarBaseUrl
           ? `${avatarBaseUrl.replace(/\/$/, '')}/${row.avatarKey}`
           : null,
     };
   }
   ```

   Both halves of the guard matter: no key means no avatar, and no configured base
   means no URL that could load. Note the consequence for Phase 5 — a row that HAS a
   key while the base is unconfigured also yields null, and Phase 5 must not use
   `avatarUrl === null` alone to decide whether a Remove control is reachable.

8. `auth.service.ts`: inject `ConfigService<Env, true>`, read `R2_PUBLIC_BASE_URL` once
   with `{ infer: true }`, pass it at all three call sites.

9. Update the three test seams the interface change breaks:
   - `auth-flow.harness.ts` — `mockUsers()` returns `jest.Mocked<UserRepository>` with
     one `jest.fn()` per method; add `updateAvatarKey`. Four specs call it
     (`auth.service.spec.ts:19`, `password-reset.service.spec.ts:35`,
     `mail-language.spec.ts:125`, `registration.service.spec.ts:31`) and all four fail
     to typecheck without this.
   - `auth.service.spec.ts:29` — `new AuthService(users, auth, google, hasher)` is
     positional; add the config argument.
   - `in-memory-user.repository.ts` — implement `updateAvatarKey`. Its `toRecord`
     spreads, so the two new fields flow through with no other change.

10. `to-user.mapper.spec.ts`: the mapper is a pure function and this phase has no write
    path, so its behaviour is provable only here — key + base composes a URL; key
    without base is null; base without key is null; a base with a trailing slash does
    not produce a double slash.

## Success Criteria

- [ ] `pnpm --filter @chatofy/api exec prisma migrate deploy` applies on a database with existing rows
- [ ] Generated SQL is two nullable `ADD COLUMN`s, no backfill, no default
- [ ] `GET /auth/me` returns `avatarUrl: null` for every pre-existing row
- [ ] `userSchema.safeParse` of a payload with NO `avatarUrl` key succeeds and yields null
- [ ] `toUserContract` returns null when the key is set but the base is not, and vice versa
- [ ] `UserDto` picks the field up automatically (`createZodDto(userSchema)`) and it appears in `/docs`
- [ ] The mapper still lists fields explicitly — no `...row`
- [ ] `pnpm --filter @chatofy/api test` passes
- [ ] **`pnpm turbo run typecheck` passes** — jest's `rootDir` is `src`, so `apps/api/test/utils/in-memory-user.repository.ts` is NOT compiled by `test`; typecheck is the only gate that catches it
- [ ] All four `mockUsers()` consumers still typecheck

## Risk Assessment

**The `test` command does not cover this phase's own deliverables.** `apps/api`'s jest
block pins `rootDir: "src"`, so the in-memory repository under `test/` is invisible to
it. Signal: a green `test` run followed by a red CI typecheck job naming four specs
nobody touched. Response: `typecheck` is in the success criteria above — run it in this
phase, not at the end of the plan.

**The optional `avatarBaseUrl` parameter lets a future caller silently get null.**
Signal: an avatar rendering as initials on a surface that should have it. Response:
there are three call sites and they are all in one file; if a second module ever maps
users, make the parameter required rather than defaulted.

**Two columns invite drift.** A key written without a timestamp, or vice versa, breaks
the import gate silently. Response: `updateAvatarKey` takes both and is the only write
path — there is no method that can set one alone.
