---
title: 'Phase 1: Cleanup, contracts, schema, test substrate'
status: done
priority: P1
effort: '1-1.5d'
dependencies: []
---

# Phase 1: Cleanup, contracts, schema, test substrate

## Overview

Delete the dead `AUTH_PROVIDER` surface, add the contracts and columns the real
implementation needs, make `AUTH_JWT_SECRET` a boot requirement **and supply it to
the test environment in the same step**, and capture the benchmark baseline before
anything changes. No enforcement yet.

## Requirements

**Functional**

- [ ] `AUTH_PROVIDER`, `authProviderSchema`, `AuthProvider`, `authProvidersResponseSchema`, `AuthProvidersResponse`, `AuthProvidersDto`, and `GET /auth/providers` no longer exist
- [ ] `User` carries `passwordHash` and `googleSub`
- [ ] `AUTH_JWT_SECRET` is required at boot; the app refuses to start without it
- [ ] A shared e2e env setup supplies that secret, so existing suites keep booting
- [ ] A pre-auth benchmark baseline exists on disk and is referenced by Phase 3

**Non-functional**

- [ ] Existing e2e suites still pass, retargeted off the deleted endpoint
- [ ] A reverse migration exists before the forward one is applied

## Architecture

`AuthController` is left in place but empty until Phase 2 refills it. The commit
must say why, so a later reader does not delete a controller that is about to be used.

`NoopAuthAdapter` **survives this phase** — `AuthModule` needs a binding for
`AUTH_ADAPTER` until `JwtAuthAdapter` exists, so it is deleted in Phase 2 in the
same commit that binds its replacement. Only its false doc comment dies here.

**On keeping the `AuthAdapter` seam:** an earlier draft justified it by claiming
Phase 3's gateway specs would use `overrideProvider(AUTH_ADAPTER)`. That was
false — `translate.gateway.spec.ts:35` constructs the gateway directly with
`new TranslateGateway(...)` and imports no `@nestjs/testing`. The seam is kept on
a narrower, true basis: `AuthAdapter` is 27 lines that already exist, deleting it
is churn beyond this request, and the gateway will take its verifier as an
ordinary constructor argument matching the file's existing mock style. Nothing in
this plan converts that spec to a testing module.

`emptyStringAsUndefined` already wraps optional vars, so an `AUTH_JWT_SECRET=`
placeholder correctly reads as absent and fails fast rather than booting empty.

## Related Code Files

**Delete**

- `apps/api/src/modules/auth/dto/auth-providers.dto.ts`

**Modify**

- `packages/types/src/http/auth.ts` — remove `authProviderSchema`, `AuthProvider`, `authProvidersResponseSchema`, `AuthProvidersResponse`; add `googleLoginRequestSchema { idToken: string }`
- `packages/types/src/http/index.ts:30,31,38,39` — **four** re-export lines, not two (`authProviderSchema`, `authProvidersResponseSchema`, `AuthProvider`, `AuthProvidersResponse`). Leaving 31 or 39 breaks the `packages/types/src/index.ts:7` barrel build.
- `apps/api/src/config/env.schema.ts:2-4,25` — drop the import comment block and `AUTH_PROVIDER`; add `AUTH_JWT_SECRET: z.string().min(32)`
- `apps/api/src/modules/auth/auth.controller.ts` — remove the route and now-unused imports
- `apps/api/src/modules/auth/adapters/noop-auth.adapter.ts:9` — fix the false doc comment
- `apps/api/.env.example:12-13` — remove `AUTH_PROVIDER` (its comment advertises a stale `none | supabase | betterauth` set that never matched the enum); add `AUTH_JWT_SECRET=` with an `openssl rand -base64 32` hint
- `apps/api/prisma/schema.prisma` — `User.passwordHash String?`, `User.googleSub String? @unique`
- `apps/api/test/jest-e2e.json` — add `setupFiles: ["<rootDir>/setup-env.ts"]`
- `apps/api/test/response-envelope.e2e-spec.ts:43,**47**,55,85,96,98` — retarget onto `GET /`. Line **47** is the one that breaks hardest and was missing from an earlier draft: `expect(res.body.data).toEqual({ provider: expect.any(String) })`. `GET /` returns `{name, version, description, status, docs?}`. The OpenAPI assertions also need the path key `'/'`, not only the schema name.
- `apps/api/test/shared-contract-client.e2e-spec.ts:2,60,71,78,85,92` — swap the mocked-fetch schema to the service descriptor
- `packages/types/src/domain/` — **export `serviceDescriptorSchema` from the shared package.** It is currently a module-local `const` in `apps/api/src/modules/meta/dto/service-descriptor.dto.ts:11-17` and is not exported. `shared-contract-client.e2e-spec.ts` exists to verify _cross-package_ contracts and imports from `@chatofy/types`; reaching into an api-internal DTO would silently convert it into an api-internal test. The api DTO then wraps the shared schema, matching how the other DTOs already work.
- `apps/api/src/common/interceptors/transform.interceptor.spec.ts:22,35` — path strings naming the deleted route
- `docs/system-architecture.md:15` — drop the removed schema names
- `pnpm-workspace.yaml` — add `argon2: true` under `allowBuilds`

**Create**

- `apps/api/test/setup-env.ts` — fixed `AUTH_JWT_SECRET` (and the `DATABASE_URL` idiom currently repeated per-spec)
- `apps/api/prisma/migrations/<ts>_add_auth_columns/migration.sql`
- `apps/api/prisma/migrations/<ts>_add_auth_columns/down.sql` — hand-written reverse (`ALTER TABLE "User" DROP COLUMN "passwordHash"`, `DROP COLUMN "googleSub"`, `DROP INDEX "User_googleSub_key"`). Prisma Migrate has no down mechanism; without this a code revert leaves drift that `prisma migrate dev` offers to fix by **resetting the database**, which cascades through `ConversationSession` and `TranscriptSegment`.
- `benchmarks/live-translate/baseline/<stamp>-rows.jsonl` — see below

## Benchmark baseline

Phase 3 asserts post-auth latency is comparable to a pre-auth baseline. **No such
baseline exists** — `benchmarks/live-translate/` has no `data/` or `results/`
directory, `analyze.mjs` has no comparison logic, and `.gitignore:111` excludes
`results/`. The baseline must be captured **now**, while the pre-auth state is
still the working tree, or the criterion is unfalsifiable later.

Capturing it requires building fixtures first (`build-fixtures.mjs`); `run-arms.mjs`
otherwise `ENOENT`s on `data/manifest.json` before opening a socket. Fixtures derive
from VIVOS/LibriSpeech and are not redistributable, so commit only the aggregated
`rows.jsonl` under a path outside the ignored `results/`.

## Implementation Steps

1. Take a database backup before migrating. (State the step directly; do not cite a repo rule for it — none exists in `docs/`, `.claude/rules/`, or `CLAUDE.md`.)
2. Build bench fixtures, run `run-arms.mjs` against the current pre-auth API, and commit the aggregated baseline.
3. Remove the `GET /auth/providers` route; delete `AuthProvidersDto`.
4. Sweep the provider enum out of `packages/types` and **all four** `index.ts` re-export lines.
5. Update `env.schema.ts`; create `test/setup-env.ts` and wire `setupFiles` in `jest-e2e.json` in the same commit.
6. Add both `User` columns; write forward and reverse SQL; apply; `prisma generate`.
7. Retarget the two e2e suites onto `GET /`.
8. Add `argon2` to `allowBuilds`; install; confirm it builds. Run `pnpm audit --audit-level=high` — CI fails on any new high advisory (`ci.yml:174`) against an ignore list documented as "meant to shrink", and this plan introduces four new production dependencies across its phases (`argon2`, `@nestjs/jwt`, `google-auth-library`, `next-auth`). Triage anything new rather than appending to `ignoreGhsas`.
9. Fix the `.env.example` and `noop-auth.adapter.ts` comments.
10. `pnpm --filter api test && pnpm --filter api test:e2e && pnpm turbo run lint typecheck`.

## Success Criteria

- [ ] `grep -rn "AUTH_PROVIDER\|authProvider\|AuthProvidersResponse\|AuthProvidersDto" apps packages` returns nothing **except** `apps/mobile/src/providers/auth-provider.tsx` and `app-providers.tsx` (an unrelated React `AuthProvider` symbol — state this exclusion or the criterion gets waved through as noise)
- [ ] `pnpm --filter @chatofy/types build` succeeds (catches a half-deleted barrel export)
- [ ] API refuses to boot with `AUTH_JWT_SECRET` unset or empty, with a readable message
- [ ] All seven e2e specs still boot and pass via `pnpm --filter api test:e2e`
- [ ] Reverse SQL applies cleanly against a migrated database in a scratch environment
- [ ] A committed baseline file exists and Phase 3's criterion names it by path
- [ ] `pnpm audit --audit-level=high` passes without new entries added to `ignoreGhsas`

## Risk Assessment

**Making `AUTH_JWT_SECRET` required breaks every e2e suite that boots `AppModule`.**
Four suites instantiate it, and `validateEnv` throws on any failure. An earlier draft
deferred the test secret to Phase 3, which would have left Phase 1 merging red —
undetected, since CI does not run api e2e (fixed in Phase 3). Response: the setup
file ships in step 5, same commit as step 5's schema change.

**argon2 fails to build on the deploy target.** Signal: install or CI failure on a
non-local platform. Response: swap to `bcryptjs` behind the Phase 2 hasher seam.

**Revert leaves database drift.** Signal: `prisma migrate dev` offers a reset.
Response: the reverse SQL above, plus the backup from step 1.
