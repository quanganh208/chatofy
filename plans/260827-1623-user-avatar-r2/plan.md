---
title: 'User avatar on Cloudflare R2'
description: 'Avatar for User: R2-backed upload, once-only Google picture import, rendered in sidebar and /account.'
status: completed
priority: P2
effort: ''
tags: [api, web, prisma, storage, auth]
created: 2026-08-27
---

# User avatar on Cloudflare R2

## Overview

`User` has no avatar column. The UI primitives already exist
(`packages/ui/src/react/avatar.tsx`) but only ever render fallback initials. This plan
adds the columns, the storage, both write paths, and the two surfaces that read it.

Storage is **Cloudflare R2** (user decision). The repo already lives behind a
Cloudflare Tunnel, so R2 needs no new service in `docker-compose.prod.yml` — only
credentials, one build-time origin, and one deploy-time assertion.

The scope is a full vertical slice on purpose. `schema.prisma` documents that
`preferredLanguage` was dropped in `c9c8e6a` "because nothing read it and nothing could
write it"; a bare column with no read or write path would recreate exactly that.

## Accepted contract

**Outcome** — a user can set and remove an avatar; a Google account gets one imported
at first sign-in; it renders in the sidebar footer and on `/account`; the bytes live on
R2 and survive redeploy.

**Constraints**

- CSP is assembled at **build time** (`apps/web/next.config.ts` documents this for
  `NEXT_PUBLIC_API_BASE_URL`). The R2 origin must be a `NEXT_PUBLIC_` value present in
  the **build** environment, and it must not be a required compose variable — see the
  deploy-pipeline decision below.
- The prod `api` service has **no volume**. Nothing may touch the filesystem.
- The next-auth session is `strategy: 'jwt'` with no adapter (`apps/web/auth.ts:89`) —
  it lives in a cookie, so it can carry a short URL but never image bytes, and nothing
  the browser posts to it may be written there unchecked.
- Per-field repository methods only (`updateLocale`, `updatePasswordHash`,
  `linkGoogleSub`). No general `update`.
- Login must not fail, or measurably slow, because of an avatar import.
- The error envelope has no 5xx code but `INTERNAL_ERROR`, and
  `all-exceptions.filter.ts` replaces every 5xx message. Any failure a user must be able
  to act on has to be a 4xx.

**Non-goals** — multiple sizes or CDN transforms, avatars for any entity other than
`User`, re-importing the Google picture after the first time, adding
`SERVICE_UNAVAILABLE` to the shared error contract.

## Goals

| #   | Goal                                                                                 | Priority |
| --- | ------------------------------------------------------------------------------------ | -------- |
| 1   | `User` carries an avatar, additive migration, no backfill                            | P1       |
| 2   | Bytes live on R2; nothing is written to the API filesystem                           | P1       |
| 3   | A user can set and remove their own avatar; only their own row                       | P1       |
| 4   | **Removal is authoritative** — the object is gone, or the user is told it is not     | P1       |
| 5   | Google picture imported at most once per row, never over a user's own decision       | P2       |
| 6   | Avatar renders in the sidebar footer and on `/account`, initials as fallback         | P1       |
| 7   | R2 unconfigured degrades to a clear 4xx; it never blocks boot or an unrelated deploy | P1       |
| 8   | Contract exposes `avatarUrl`; the column stores a key, so the origin can move        | P2       |

## Phases

| #   | Phase                                                                             | Status |
| --- | --------------------------------------------------------------------------------- | ------ |
| 1   | [Phase 1: Schema and contract](./phase-01-schema-and-contract.md)                 | Done   |
| 2   | [Phase 2: R2 storage adapter](./phase-02-r2-storage-adapter.md)                   | Done   |
| 3   | [Phase 3: Upload and delete endpoints](./phase-03-upload-and-delete-endpoints.md) | Done   |
| 4   | [Phase 4: Google picture import](./phase-04-google-picture-import.md)             | Done   |
| 5   | [Phase 5: Web avatar surface](./phase-05-web-avatar-surface.md)                   | Done   |
| 6   | [Phase 6: Provisioning and docs](./phase-06-provisioning-and-docs.md)             | Done   |

Phases 1→2→3 are strictly sequential. Phase 4 depends on 2+3. Phase 5 depends on 1 and 3. Phase 6 depends on 5. Phase 1 owns `R2_PUBLIC_BASE_URL` because its mapper is the
first thing that reads it; the other four `R2_*` keys land in Phase 2.

## Key design decisions

| Decision                                                          | Why                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two columns: `avatarKey` + `avatarChangedAt`                      | A null key means both "never had one" and "the user removed one". Importing is right for the first and wrong for the second. The timestamp splits them, in the shape `passwordChangedAt` already uses.                                                              |
| Column stores a key, contract exposes `avatarUrl`                 | Moving the public origin is an env change rather than an `UPDATE` over every row. The mapper composes the URL at the boundary.                                                                                                                                      |
| `avatarUrl` is `.nullable().default(null)`                        | `userSchema` is the client's `safeParse` boundary. A required key makes a newer client reject an older API's response, and `apiFetch` raises that as a thrown `ContractError` — a whole-page failure over a decorative field.                                       |
| Key is `avatars/{userId}/{random16}-{hash16}.{ext}`               | The hash keeps replacement cache-safe. The random half is what makes the key unguessable — the hash alone is not, since a Google-imported avatar's bytes are a public artifact.                                                                                     |
| Bucket is public-read; avatars are public by product intent       | An `<img>` sends no `Authorization` header, and presigned URLs expire and defeat caching. The plan does **not** claim unguessability as an access control.                                                                                                          |
| `Cache-Control: public, max-age=3600`, **no `immutable`**         | Content hashing already makes replacement safe. Deletion is what governs the TTL, and a year of `immutable` on a deletable public object means a removed photo keeps being served.                                                                                  |
| Removal deletes the object first and only then clears the columns | On a public bucket, clearing the column while the object survives means the photo stays published and the user was told 200. A retryable 409 is better than a false confirmation.                                                                                   |
| Replacement keeps a best-effort delete of the old object          | A replaced avatar is one the user still wants published, so a leftover object is storage waste — not a takedown that silently failed.                                                                                                                               |
| Storage-unavailable is **409**, not 503                           | `ApiErrorResponses` throws at import for any status outside its table (503 is not in it), and every 5xx message is replaced by the error filter. A 4xx keeps its message. Semantically imperfect and chosen over changing a contract shared by api, web and mobile. |
| No production boot gate for R2                                    | Avatars are P2; refusing to boot over them would block unrelated deploys. Replaced the earlier false rationale ("the 503 reports itself" — it does not) with a startup warning plus the 409.                                                                        |
| Upload is JSON base64 with a transport-level size limit           | The JSON limit is already 12mb (raised for audio), so no `multer`. The zod max bounds the _decode_, not the parse — the transport limit is what bounds memory.                                                                                                      |
| No `sharp`                                                        | The browser resizes to 128px webp; Google serves a pre-sized image via `=s256-c`.                                                                                                                                                                                   |
| Type decided by **magic bytes**, never the client's claim         | User-supplied bytes served from an origin the browser treats as ours.                                                                                                                                                                                               |
| Google import gated on `avatarChangedAt`, wrapped at three sites  | `loginWithGoogle` has three terminal returns and no join point; `sessionFor` is shared with password login, so hooking there would slow every password sign-in.                                                                                                     |
| `session.user.image` is overwritten **unconditionally**           | Auth.js's Google provider already puts `lh3.googleusercontent.com` in it. A conditional copy leaves a URL the new `img-src` forbids.                                                                                                                                |
| The avatar origin build arg is **defaulted, not `:?`**            | `deploy.yml` runs `compose config` before it builds anything, so a required-and-unset variable aborts the entire pipeline. A served-header assertion catches wrong values instead.                                                                                  |

## Success Criteria

- [ ] `prisma migrate deploy` applies cleanly on a database with existing rows; no backfill
- [ ] `GET /auth/me` returns `avatarUrl` (null when unset); a payload with the key absent still parses
- [ ] Upload → hard reload → avatar renders in sidebar and `/account`
- [ ] Remove → both surfaces fall back to initials **and the object is gone from the bucket**
- [ ] Remove with storage unreachable → 409, columns unchanged, the user can retry
- [ ] First Google login on a fresh account lands with an avatar, in the login response itself
- [ ] A removed avatar is never re-imported by a later Google login
- [ ] A password login performs zero outbound fetches
- [ ] With R2 env unset: API boots, logs one warning, uploads return 409 with a real message
- [ ] Oversized or non-image payload → 400, nothing written to R2
- [ ] A user cannot change another user's avatar (no user id in any request body)
- [ ] No `googleusercontent.com` request is made from any authenticated page
- [ ] An unset avatar origin does not block deploying api, migrate or web
- [ ] With it set, the deploy smoke asserts the served `img-src` names it
- [ ] `pnpm --filter @chatofy/api test`, `pnpm --filter @chatofy/web test`, **`pnpm turbo run typecheck`**, and `pnpm --filter @chatofy/api test:e2e:db` pass

## Risks

| Risk                                                                       | Mitigation                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A wrong-but-present avatar origin ships and every avatar is blocked        | The deploy smoke asserts the served `img-src` on every deploy, the same mechanism a real incident already justified for `connect-src`.                                                      |
| The two origin variables drift (`R2_PUBLIC_BASE_URL` vs the web build arg) | Enforced by that assertion plus a stated rebuild-not-restart rule. The dangerous case is an operator changing only the API side — a restart that appears to work.                           |
| A removed photo stays at the edge for up to an hour                        | Bounded and documented, rather than an unexamined year. Origin deletion is authoritative and verified in Phase 6 step 9.                                                                    |
| The byte cap bounds bytes, not pixels                                      | Cosmetic and bandwidth only — CSS pins the rendered size. A hard guarantee needs `sharp`, deliberately not taken.                                                                           |
| `test` does not compile everything the phases change                       | `apps/api` jest pins `rootDir: src`, and `test:e2e` ignores `.db-e2e-spec.ts`. Every phase that touches a shared interface lists `typecheck`.                                               |
| `avatarUrl` null also means "key set, origin unconfigured"                 | Only reachable by configuring an environment downward — the five R2 vars are all-or-nothing, so an environment without the base could never accept an upload. Documented in Phase 5 step 8. |
| Public bucket means any avatar is world-readable by URL                    | Accepted as product intent, stated plainly. Not defended by unguessability.                                                                                                                 |
| Google import adds an outbound call to the login path                      | At most once per row, 3s timeout, redirects refused, wrapped so it cannot fail login. Fallback is fire-and-forget; the wrapper is already shaped for it.                                    |

## Red Team Review

### Session — 2026-08-27

**Reviewers:** 4 (Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic), full verification tier.
**Findings:** 36 raw → 20 after dedup (20 accepted, 2 partial rejections). Every finding carried `file:line` evidence; none was dropped by the evidence filter.
**Severity breakdown:** 5 Critical, 7 High, 8 Medium.

| #   | Finding                                                                       | Severity | Disposition | Applied To    |
| --- | ----------------------------------------------------------------------------- | -------- | ----------- | ------------- |
| 1   | Removal cleared the column while the public object survived, cached a year    | Critical | Accept      | Plan, 2, 3, 6 |
| 2   | A removed avatar was resurrected by the next Google login                     | Critical | Accept      | Plan, 1, 4    |
| 3   | Phase 4's single insertion point does not exist; `sessionFor` is shared       | Critical | Accept      | 4             |
| 4   | `@ApiErrorResponses(503)` throws at import; no 5xx code but `INTERNAL_ERROR`  | Critical | Accept      | Plan, 2, 3    |
| 5   | `:?` build arg aborts the whole deploy pipeline at `compose config`           | Critical | Accept      | Plan, 6       |
| 6   | `apps/web/Dockerfile` ARG missing; smoke greps only `connect-src`             | High     | Accept      | 6             |
| 7   | Two env vars hold one origin with nothing checking agreement                  | High     | Accept      | Plan, 6       |
| 8   | `token.picture` already carries a Google URL; must be cleared unconditionally | High     | Accept      | 5             |
| 9   | Phase 1 could not compile: env key, `AuthService` ctor, `mockUsers`           | High     | Accept      | 1, 3          |
| 10  | Required `avatarUrl` key broke `userSchema`'s compatibility contract          | High     | Accept      | 1             |
| 11  | Named verification gates were wrong (`t.spec.ts`, `test:e2e`, `rootDir`)      | High     | Accept      | 1, 3, 4, 5    |
| 12  | SSRF: `fetch` follows redirects; allowlist spec too weak                      | High     | Accept      | 4             |
| 13  | `trigger === 'update'` wrote client-supplied data into the signed cookie      | Medium   | Accept      | 5             |
| 14  | No throttle on the new routes; the memory-mitigation claim was false          | Medium   | Accept      | 3             |
| 15  | `resize-avatar.spec.ts` could not test the geometry it claimed                | Medium   | Accept      | 5             |
| 16  | CSP interpolated an unvalidated env value                                     | Medium   | Accept      | 5             |
| 17  | "Content-hashed keys are not guessable" was an overclaim                      | Medium   | Accept      | Plan, 2       |
| 18  | Two-meaning `null` hid the Remove control when the origin was unset           | Medium   | Accept      | 1, 5          |
| 19  | Read-then-write race on `updateAvatarKey`                                     | Medium   | Accept      | 3             |
| 20  | Runbook omitted `--env-file`, so build args appear unset                      | Medium   | Accept      | 6             |

**Partial rejections (recommendation kept, reasoning corrected):**

- _"Every other mutating auth route declares `@Throttle`"_ — false. `@Patch('me')` has none. The throttle was still added, on the different ground that this route accepts the largest bodies in the controller and issues billable object-store writes.
- _"The key-vs-URL indirection does not earn its cost"_ — rejected. A full-URL column still requires an `UPDATE` over every row when the origin moves, and the custom domain was chosen precisely so the origin stays stable. The finding's _consequence_ — `null` meaning two things — was accepted (row 18).

**Product decisions taken during adjudication** (these changed accepted scope, not just wording): storage-unavailable is a 409 using an existing error code rather than adding `SERVICE_UNAVAILABLE` to the shared contract; removal is authoritative and fails loudly rather than best-effort; the import gate is a timestamp column rather than an import marker — the latter would still have re-imported after a user uploaded and then removed their own picture.

### Whole-Plan Consistency Sweep

Re-read `plan.md` and all six phase files after applying. Reconciled across the whole
plan, not only the edited phases:

- `immutable` / `max-age=31536000` removed everywhere; `max-age=3600` is stated in Phase 2, Phase 6 and this file's decision table with one rationale.
- The 503 story is gone from every file; Phase 2's architecture, Phase 3's decorator and error mapping, Phase 6's `.env.example` text and this file's constraints all say 409.
- "Best-effort delete" now appears only for the _replacement_ path; the removal path says authoritative in Phases 2, 3 and 6 and in Goal 4.
- `avatarChangedAt` is introduced in Phase 1, written by `updateAvatarKey` in Phases 1 and 3, read as the gate in Phase 4, and documented in Phase 6 step 8.
- `R2_PUBLIC_BASE_URL` is owned by Phase 1 and referenced as already-present in Phase 2; the phase-dependency note above matches.
- Verification commands corrected in every phase: `typecheck` added where a shared interface changes, `test:e2e:db` replaces `test:e2e` in Phase 3, and the `t.spec.ts` parity claim is replaced by `typecheck` in Phase 5.
- The phantom `avatar.service.spec.ts` is deleted from Phase 3's file list; the specs live in `avatar-endpoints.spec.ts` against `AuthService`, which is where the methods are.
- Phase 3's old criterion "Storage disabled → DELETE still clears the column and returns 200" is inverted to match the authoritative-delete decision.

**Unresolved contradictions: none.**

## Implementation notes

Recorded during execution — deviations from the phase text, and what the phases
got wrong about this repo.

| Phase | Plan said                                                                               | Reality                                                                                                                                                                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| all   | Verify with `pnpm --filter @chatofy/api test` / `@chatofy/web`                          | The workspace package names are `api` and `web`. `@chatofy/*` matches nothing and exits 0 on "No projects matched", which would have read as a pass.                                                                                                                                                                                  |
| all   | `pnpm turbo run typecheck` is the gate for `test/utils/` and i18n parity                | True, but it only passes after `pnpm --filter web build` has generated `.next/types`. On a clean tree web reports 25 typed-route errors that have nothing to do with this change. `next build` runs `tsc` over the spec files too and is the honest gate.                                                                             |
| 1 + 3 | `updateAvatarKey(id, key, changedAt)` in Phase 1; make the clear conditional in Phase 3 | Merged: the method takes an optional `expectedKey` and returns `UserRecord \| null` from the start, so the interface is not widened twice.                                                                                                                                                                                            |
| 2 + 3 | Only `delete` translates a storage failure                                              | `put` does too. Without it an R2 outage on upload surfaced as an opaque 500 rather than the 409 Goal 7 asks for.                                                                                                                                                                                                                      |
| 3     | e2e asserts a non-image → 400                                                           | Not reachable in the db-e2e environment: `setAvatar` checks `storage.enabled` _before_ decoding (Phase 3 step 5.1), so with R2 unset every upload is 409 whatever the payload. The 400 is proved in `avatar-endpoints.spec.ts`, where storage is enabled.                                                                             |
| 3     | e2e signs in per test                                                                   | `POST /auth/login` is throttled per address and the suites above had spent the budget. The avatar block issues its token through the real `AUTH_ADAPTER` instead — same adapter, same secret, same guard.                                                                                                                             |
| 3     | A 12mb body is refused at the transport layer                                           | It is, but it surfaces as **500**, not 413: `all-exceptions.filter.ts` only preserves an `HttpException`'s status, and body-parser throws a raw error. Pre-existing for every route, `/translate`'s 12mb included. Changing the shared filter was out of scope; the assertion was dropped rather than left asserting the wrong thing. |
| 6     | Step 9 — verify end to end against the real bucket                                      | **Not performed.** Needs Cloudflare credentials and a live bucket. Everything up to it is verified; this step remains for the operator.                                                                                                                                                                                               |

## Post-implementation review

Full review after all six phases: `plans/reports/code-reviewer-260827-1730-user-avatar-r2.md`.
All nine acceptance invariants verified against source; no critical defect. Four
findings changed behaviour and were fixed, each with a spec that had been missing.

| #   | Finding                                                                                                                                                                                                                                                                                                                                                           | Fix                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `import { json } from 'express'` in `main.ts` — express was NOT a dependency of `apps/api` and did not resolve from it. **Boot-breaking**, and worse than the review graded it: verified by resolving from `src/main.ts` and by booting the API.                                                                                                                  | Added `express` as a direct dependency; it is used as a runtime value, not a type. Boot re-verified (`/health` 200).                                                                                                                                                                                          |
| 2   | The Google import re-ran on **every** Google login when it failed. `avatarChangedAt` is stamped only by a completed write, and `withGoogleAvatar` never checked `storage.enabled` — so an R2-less deployment (the documented dev state) repeated the outbound fetch and a doomed put forever. Goal 5's "at most once per row" really meant "at most one success". | `!this.avatars.enabled` added to the gate. Spec: a Google login with storage disabled performs zero fetches.                                                                                                                                                                                                  |
| 3   | The `put` on the login path was unbounded. The SDK defaults to `maxAttempts: 3` with backoff and **no** request timeout; the importer's 3s timeout covers the fetch _from Google_, not the write to R2. The `try/catch` prevented failure, not a stall — so the constraint "login must not measurably slow" was only half-met.                                    | `maxAttempts: 2` plus a 5s request / 2s connection timeout on the `S3Client`. Spec asserts both.                                                                                                                                                                                                              |
| 4   | The web card mapped every 409 to "storage is not set up", but the API sends a second 409 for a _transient_ outage — so a user in an R2 incident was told the server has no storage configured and not to retry.                                                                                                                                                   | **Product decision:** one message true of both causes, rather than rendering the API's English-only message to a Vietnamese reader or adding `SERVICE_UNAVAILABLE` to the shared contract (still declined — see open question 2). The card's comment, which claimed to read the API's message, was corrected. |

Also fixed from the Low list: the in-memory repository double threw where the
Prisma `updateMany` returns null for a missing row; a stale `coverCrop` docstring
naming a parameter that does not exist; a `session-menu` spec asserting less than
its name claimed; and a docs cross-reference pointing "below" at a section above.

Accepted without change: orphaned objects when a column write fails after a
`put` — storage cost only, the column stays authoritative (already in Risks).

## Follow-up: the second origin variable was removed

Raised after the review: `NEXT_PUBLIC_AVATAR_BASE_URL` was unnecessary. It was —
though not because the value could be read at runtime. Two things were measured
first:

- `next.config.ts`'s `headers()` **is** baked into the routes manifest at build
  time. A build made without the value, started with it set, still serves the old
  header. So a build-time value is genuinely required and the plan was right about
  that.
- `proxy.ts` (Next 16's renamed middleware) runs at runtime, but its matcher
  deliberately excludes `/`, `/login`, `/register`, `/verify-email` and the rest.
  Generating the CSP there would strip it from the sign-in page, so it is not a
  home for this.

What was actually unnecessary is the `NEXT_PUBLIC_` **prefix**, and therefore the
second name. That prefix exists to inline a value into the _client_ bundle, and no
client code ever read this one — `next.config.ts` runs in plain Node at build time
and can read any variable. Phase 5 step 1 also put it in `apps/web/src/config/env.ts`,
where nothing read it at all; the review flagged that as M3.

So web now takes **`R2_PUBLIC_BASE_URL`** — the API's own variable — as its build
arg. One name, one line in `prod.env`, read at runtime by the API and at build
time by web. Verified: `compose config` resolves the same value into both the
api's environment and the web build args, and the served `img-src` still names the
normalised origin when set and is byte-identical to the old header when unset.

This deletes the plan's "two origin variables drift" risk outright, along with the
`env.ts` entry, and simplifies the deploy smoke to grepping one key. What survives
is the rebuild rule: because the value is baked at build, changing the origin is a
**web rebuild**, not only an API restart — which is what the `img-src` assertion
guards on every deploy.

## Open questions

1. Column name: `avatarChangedAt` (mirrors `passwordChangedAt`, avoids reading as a
   sibling of Prisma's `@updatedAt`) versus `avatarUpdatedAt` as originally proposed.
   Semantics are identical; only the name differs.
2. `409` for storage-unavailable is semantically imperfect. If the shared
   `errorCodeSchema` ever gains `SERVICE_UNAVAILABLE`, this is the first call site to
   move.

<!-- slug: user-avatar-r2 -->
