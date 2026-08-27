# Code Review — User avatar on Cloudflare R2

Plan: `plans/260827-1623-user-avatar-r2/plan.md` (6 phases, all marked Done)
Reviewed: uncommitted working tree, `main`. REPORT ONLY — no files modified.

## Scope

- 37 tracked files changed (+1581/−16) plus 14 untracked new files
- ~2,700 LOC in scope (source + specs + docs + infra)
- Focus: the 9 acceptance invariants, caller regressions, contract compatibility

## Overall assessment

The vertical slice holds. Every one of the 9 named invariants is implemented as
described, the specs are real (they assert state, not call counts), and the
red-team dispositions in `plan.md` are visible in the code rather than only in
prose. Repo patterns are followed: per-field repository method, `getR2Config`
all-or-nothing mirroring `getSmtpConfig`, `AVATAR_STORAGE`/`DisabledAvatarStorage`
mirroring `MAIL_SENDER`/`NoopMailSender`, explicit field lists in the mapper.

Two real defects sit on the **login path** and both are in the same place: the
Google import wrapper. Neither was caught because the specs mock `fetch` and use
an in-memory storage fake, so no test can observe an unbounded S3 call or count
imports across repeated logins.

No Critical findings. No blocking security hole.

## Critical Issues

None.

## High Priority

### H1 — `S3Client` has no request timeout and no retry cap, so a first Google login can hang well past the plan's stated bound

`apps/api/src/modules/storage/r2-avatar-storage.ts:47-56` constructs the client with
`endpoint`, `region`, `credentials` and nothing else. AWS SDK v3 defaults apply:
`maxAttempts: 3` with exponential backoff, and **no** `requestTimeout` on the Node
handler.

`apps/api/src/modules/auth/auth.service.ts:355-372` awaits `withGoogleAvatar`
inline before `sessionFor`, and `storeAvatarBytes` (`:393`) awaits
`this.avatars.put(...)`. `fetchGoogleAvatar` is bounded at 3s
(`google-avatar-importer.ts:5,93`) — the **put is not bounded at all**.

The plan's accepted constraint is _"Login must not fail, or measurably slow,
because of an avatar import"_, mitigated in the risk table by _"3s timeout,
redirects refused, wrapped so it cannot fail login"_. The wrapper does prevent
_failure_. It does not prevent an unbounded _stall_: a slow or half-open R2
endpoint makes the user's first Google sign-in wait through three attempts with
backoff, with the browser holding the request. The `try/catch` cannot help — a
hang is not a rejection.

Fix (either, preferably both):

```ts
// r2-avatar-storage.ts
new S3Client({
  endpoint,
  region: 'auto',
  credentials,
  maxAttempts: 2,
  requestHandler: new NodeHttpHandler({ connectionTimeout: 2000, requestTimeout: 3000 }),
});
```

and/or bound the whole import in `withGoogleAvatar` with a deadline, which is the
guarantee the plan actually claims.

### H2 — The Google import is retried on **every** Google login when it fails, not once per row

`auth.service.ts:359` gates on `user.avatarChangedAt !== undefined`, and
`avatarChangedAt` is only stamped by `updateAvatarKey`, which only runs after a
**successful** put (`:403`). On any failure — storage disabled, a 404 picture, a
non-image response, a fetch timeout — nothing is stamped, so the next login
re-enters the whole sequence.

`withGoogleAvatar` also never checks `this.avatars.enabled` before fetching (unlike
`setAvatar:256`, which checks first precisely to avoid wasted work). Consequence on
a deployment with R2 unset — which the plan documents as _supported and the normal
state in development_ (`apps/api/.env.example:56`, `docs/deployment-guide.md`
"Running without R2"):

**every Google sign-in, forever, performs an outbound HTTPS request to
`lh3.googleusercontent.com` (up to 3s), a `findById`, and a failed `put`** before
the session is returned.

That contradicts the plan on two counts: "imported at most ONCE per row" and "Login
must not fail, or measurably slow". It also weakens the "no `googleusercontent.com`
request from an authenticated page" story — the request moves to the server, but it
now happens on every login rather than once.

Minimum fix — short-circuit on the seam that already exists:

```ts
if (user.avatarChangedAt !== undefined || !identity.picture || !this.avatars.enabled) return user;
```

Decide separately whether a _transient_ failure should be retried on the next login
(defensible) or closed permanently. Today it is unbounded retry, and no spec covers
a second login after a failed import.

## Medium Priority

### M1 — The web surface throws away the 409 message the 409 was chosen to preserve, and mislabels a transient outage

`account-avatar-card.tsx:134-145` maps status → static i18n key. Both 409 causes
collapse to `web.account.avatarUnavailable` = _"Photo storage is not set up on this
server. Nothing was changed."_

But the API emits **two different** 409 messages
(`auth.service.ts:311-315`, `:396-398`):

- storage disabled → `'Avatar storage is not configured on this server'` ✓ matches
- storage **enabled**, delete/put failed → `'Could not remove the avatar right now — try again'`

In the second case the user is told the server is unconfigured and to contact an
operator, when the correct action is _retry_. The card's own doc comment
(`:129-132`) asserts _"The 409 carries a real message from the API precisely because
it is a 4xx"_ — the code never reads `err.message`. The whole justification chain in
`plan.md` ("A 4xx keeps its message, and the message is the whole value") terminates
at the API and is discarded one layer later.

Fix: either render `err.message` for 409 (it is server-authored and already safe
for a 4xx), or split the two into distinct codes/messages the client can key on.

Same function, lower stakes: 429 (the new `@Throttle 10/60s`) falls through to
`avatarFailed` = _"Try again."_ — which is wrong advice for a rate limit, and 400
is hard-coded to `avatarTooLarge` though the API also returns 400 for
"not a supported image" and "could not be decoded".

### M2 — `express` is imported for a runtime value but is not a declared dependency of `apps/api`

`apps/api/src/main.ts:6` — `import { json } from 'express'`. Every other express
import in the app is `import type` (`all-exceptions.filter.ts:10`,
`jwt-auth.guard.ts:9`, `auth.controller.ts:16`, …) and erases at compile time. This
one does not.

`apps/api/package.json` does not list `express`. It resolves today only because the
root `.npmrc` sets `node-linker=hoisted` and `pnpm --filter api deploy --prod
--legacy` (`apps/api/Dockerfile:82`) keeps the transitive tree flat. That is a
phantom dependency: it breaks silently if the linker changes, or if
`@nestjs/platform-express` ever moves express to a peer.

Fix: add `"express"` to `apps/api` dependencies pinned to the version
`@nestjs/platform-express` resolves, or use
`app.getHttpAdapter().getInstance()` / `body-parser` explicitly.

(Separately verified and **correct**: the ordering claim holds. `app.use(path, json)`
at `main.ts:29` registers ahead of `useBodyParser('json', {limit:'12mb'})` at `:33`;
body-parser sets `req._body` and the later parser skips, so 512kb is the effective
ceiling on `/auth/me/avatar`. No global prefix exists, so the literal path is right.)

### M3 — `NEXT_PUBLIC_AVATAR_BASE_URL` in `apps/web/src/config/env.ts` is never read

Added to the schema (`:17`) and the parse call (`:26`), but nothing consumes
`env.NEXT_PUBLIC_AVATAR_BASE_URL` — `next.config.ts:60` reads `process.env`
directly, as its own comment says it must. Grep confirms two hits, both in
`env.ts` itself.

It is not harmless: `.url()` there means a malformed value throws at module import
in the browser bundle, taking down the app for a variable that has no consumer —
while `next.config.ts` already validates the same value at build time where a
failure is cheap. Either delete it or state in a comment that its only job is the
runtime parse guard.

## Low Priority

- **L1** `avatar-crop-geometry.ts:20-21` — the doc block describes a `size`
  parameter ("`size` is the output edge … It is accepted so callers pass one
  number") that `coverCrop(srcW, srcH)` does not have. Stale from an earlier
  signature.
- **L2** `apps/api/test/utils/in-memory-user.repository.ts:163` — `updateAvatarKey`
  **throws** for a missing row; `PrismaUserRepository.updateAvatarKey`
  (`prisma-user.repository.ts:257`) returns `null` (count 0). The production path
  turns that null into `UnauthorizedException` (`auth.service.ts:404`); the double
  cannot reproduce it. Return `null` in the double.
- **L3** `session-menu.spec.tsx:71` — "renders initials rather than a broken image
  for a failed URL" asserts only `textContent` contains `QA`, which is equally true
  of the no-image case at `:63`. happy-dom never loads images, so the test proves
  the environment, not the behaviour. Assert the `<img>` is absent _and_ that
  `AvatarImage` received the URL, or drop the claim from the name.
- **L4** `docs/system-architecture.md:770` — the `storage/` bullet says "See
  _Avatar storage_ below"; that section is ~230 lines **above** it.
- **L5** Two concurrent uploads (or a first Google login racing itself across two
  devices) both read `previous`, both `put`, and both write unconditionally
  (`auth.service.ts:403`, no `expectedKey`). The loser's object is orphaned in the
  bucket. Storage waste only — consistent with the plan's accepted "replacement
  keeps a best-effort delete" stance — but nothing reclaims it and there is no
  lifecycle rule in the runbook.
- **L6** `prod.env.example:68` puts the bucket on `cdn.chatofy.quanganh208.dev`, a
  sibling subdomain of the app. Content-Type is pinned from a magic-byte sniff
  (good), but the deployment runbook does not tell the operator to set
  `X-Content-Type-Options: nosniff` on the public bucket. Auth.js cookies are
  host-only so the practical risk is small; worth one line in the runbook.

## Verification of the 9 stated acceptance criteria

| #   | Invariant                                                                                     | Verdict                 | Evidence                                                                                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Removal authoritative; failure → 409, columns unchanged                                       | **Holds**               | `auth.service.ts:292-334`; delete precedes `updateAvatarKey`; both 409 paths assert unchanged columns in `avatar-endpoints.spec.ts:182-204` and against a real DB in `auth.db-e2e-spec.ts:827-845`                                                                                      |
| 2   | Import once per row, gated on `avatarChangedAt`, at 3 terminal returns, never in `sessionFor` | **Partial — see H1/H2** | Gate `:359` correct (`toRecord` normalises null→absent, `prisma-user.repository.ts:53`); all three returns wrapped `:146,:169,:221`; `sessionFor` untouched; password login proven fetch-free (`auth.service.spec.ts`). But "once" only means "one _success_", and the put is unbounded |
| 3   | Storage-unavailable is 409, never 5xx                                                         | **Holds**               | `ConflictException` at `:257,:311,:396`; `@ApiErrorResponses(400,401,409,429)` — no 5xx; e2e asserts `error.code === 'CONFLICT'`                                                                                                                                                        |
| 4   | No user id in any avatar body                                                                 | **Holds**               | `uploadAvatarRequestSchema` has one field (`packages/types/src/http/auth.ts`); `DELETE` has no body; both use `req.auth!.userId`; global `APP_GUARD: JwtAuthGuard` (`auth.module.ts:95`), 401s proven in e2e                                                                            |
| 5   | Magic bytes only, 256KB cap                                                                   | **Holds**               | `avatar-image.ts:62-65`; client claim never consulted; `ContentType` pinned from the sniff (`r2-avatar-storage.ts:66`); cap checked pre-sniff                                                                                                                                           |
| 6   | SSRF: parsed URL, `redirect:'manual'`, bounded body, timeout                                  | **Holds**               | `google-avatar-importer.ts:15-29` (protocol + userinfo + exact-suffix), `:91-94`, `readBounded:48-65`. `withSize` truncates at the first `=` in the path only — cannot alter the host. Lookalike/userinfo/http/local all covered by spec                                                |
| 7   | `user.image` copy unconditional; `trigger==='update'` re-reads GET /auth/me                   | **Holds**               | `apps/web/auth.ts:199` (no truthiness guard), `:211` `token.picture = user.image ?? null`, `:220-226` ignores the browser payload entirely                                                                                                                                              |
| 8   | `avatarUrl` is `.nullable().default(null)`                                                    | **Holds**               | `packages/types/src/domain/user.ts:32`; forward-compat asserted in `to-user.mapper.spec.ts:46`                                                                                                                                                                                          |
| 9   | `updateAvatarKey` takes optional `expectedKey`                                                | **Holds**               | Interface `:215-220`; `updateMany` with conditional WHERE (`prisma-user.repository.ts:248-256`); used by `removeAvatar:322`; lost-race path covered `avatar-endpoints.spec.ts:225`                                                                                                      |

## Regression walk (requested callers)

- **`toUserContract`** — 8 call sites, all in `AuthService`, all pass
  `this.avatarBaseUrl`. Field list still explicit; `avatarKey`/`avatarChangedAt`
  do not leak (`to-user.mapper.spec.ts:63`). No other module calls it.
- **`UserRepository.updateAvatarKey`** — new method; both implementations plus the
  jest mock (`auth-flow.harness.ts:72`) updated. Divergence noted in L2.
- **`AuthService` constructor** — 2 new params; all three construction sites
  (`auth.module.ts` DI, `auth.service.spec.ts`, `avatar-endpoints.spec.ts`) updated.
- **`loginWithGoogle`** — all three terminal returns wrapped; the four refusal
  branches (2b/2c/2d/link-race) are untouched and still throw before any avatar
  work. Existing linking-policy specs unchanged.
- **`apps/web/auth.ts`** — `jwt` became `async`; Auth.js awaits the callback, so no
  caller change. `session` still sync. `fetchAvatarUrl` has no timeout, matching the
  existing `postToApi` (`:49`) — consistent with the file, not a new regression.
- **`main.ts` parser ordering** — verified above (M2 parenthetical). The
  route-scoped 512kb wins.

## Contract compatibility

`userSchema` gained `avatarUrl` as `.default(null)`, so the **output** type makes it
required while the **input** accepts its absence. Old API → new client parses (the
stated goal). New API → old client: extra key, `userSchema` is non-strict, ignored.
`apps/mobile` and `apps/extension` reference `User` only in a comment. No breaking
change. `uploadAvatarRequestSchema` is additive.

Migration `20260827095557_add_user_avatar` is two nullable `ADD COLUMN`s — additive,
no backfill, no table rewrite on Postgres.

## Edge cases scouted (not in the diff)

- Google login racing itself → double import, one orphaned object (L5)
- Upload racing removal → covered by `expectedKey`; the reverse order (removal then
  upload) restores the avatar, which is correct last-writer-wins
- `updateAvatarKey` returning null in `storeAvatarBytes` → object already in R2,
  row gone → orphan. Unreachable in practice (the token was just verified)
- `readBounded` on a 200 with no body → `null`, handled
- `redirect:'manual'` in undici → non-`ok` response → `null`, handled
- Oversized body → 500 not 413 (**excluded by instruction, pre-existing**)

## Positive observations (risk-calibration only)

- `avatar-endpoints.spec.ts` and `r2-avatar-storage.spec.ts` assert _state_ (what is
  in the fake bucket, what the column holds) rather than call counts. The
  "columns UNCHANGED" cases are the ones that would have been faked by a weaker
  suite, and they are real.
- `auth.db-e2e-spec.ts:793` asserts `userSchema.strict().parse` against a live
  Postgres response — the additive-migration claim is proven, not asserted.
- `storage.module.spec.ts:34` parameterises "only %s is missing" over all five keys,
  so the all-or-nothing rule cannot rot one key at a time.
- The AWS SDK error is deliberately **not** logged as an object
  (`r2-avatar-storage.ts:94-98`) because it carries the signed auth header. Correct,
  and the spec at `:108` enforces it.

## Recommended actions

1. **H1** Bound the R2 client: `maxAttempts` + `NodeHttpHandler` timeouts, and/or a
   deadline around the whole `withGoogleAvatar` call.
2. **H2** Add `|| !this.avatars.enabled` to the import gate; decide and document
   whether a failed import retries on the next login.
3. **M1** Surface the API's 409 message (or split the two 409 causes) so a transient
   outage stops reading as "not set up on this server".
4. **M2** Declare `express` in `apps/api/package.json`.
5. **M3** Remove `NEXT_PUBLIC_AVATAR_BASE_URL` from `apps/web/src/config/env.ts` or
   comment why an unread key is parsed there.
6. L1–L6 as convenient.

Items 1–3 are the ones I would want fixed before this lands, because all three
change behaviour a user or an operator actually observes and none is covered by an
existing test.

## Metrics

- Type coverage: no `any` introduced; two `as unknown as` casts, both in test doubles
  (`auth-flow.harness.ts:113`, `storage.module.spec.ts:8`) — the established pattern
  for `ConfigService` stubs in this repo
- Lint suppressions added: 0
- New specs: 8 files, 47 test cases; no `.skip`, no `.only`
- Reported gates (not re-run here): api 648, web 493, e2e 50, e2e:db 35, typecheck 16/16, lint 0

## Unresolved questions

1. **H2 policy** — should a failed import close the gate permanently (stamp
   `avatarChangedAt` on failure, one attempt ever) or keep retrying? The plan says
   "at most once per row" but the code implements "at most one success". This is a
   product call, not a bug I can resolve.
2. **M1** — render the server's 409 message verbatim, or add a second error code so
   the client can distinguish unconfigured-vs-unreachable? The second is cleaner but
   touches the shared error contract, which the plan explicitly scoped out.
3. **L5** — is an R2 lifecycle rule for orphaned `avatars/**` objects wanted, or is
   the leak small enough to ignore? Nothing currently reclaims them.
4. Phase 6 step 9 (real-bucket verification) remains unperformed by instruction —
   H1 and L6 are both things only a live bucket would surface.
