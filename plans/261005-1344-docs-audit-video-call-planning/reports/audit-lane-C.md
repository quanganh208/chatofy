# Audit lane C — authentication, modules/extension/CI, deployment guide

Scope: `docs/architecture/authentication.md`, `docs/architecture/modules-extension-ci.md`,
`docs/deployment-guide.md`. Branch `docs/audit-and-video-call-planning`, 2026-10-05.
Line numbers are pre-edit.

## docs/architecture/authentication.md (12 fixes)

| #   | Line    | Old claim                                                                | Evidence                                                                                                                                                        | Fix                                                                                     |
| --- | ------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A1  | 19      | Password hashing owned by `AuthService`, two private methods             | `auth/password-hasher.ts` is the only file importing argon2; `PasswordHasher` provider in `auth.module.ts`                                                      | Owner → `PasswordHasher`                                                                |
| A2  | 29      | Mail: "SMTP, console, and the guard wrapping both"                       | `mail.module.ts` `buildInnerSender` → Console / Smtp / Noop, all wrapped by `GuardedMailSender`                                                                 | Added no-op                                                                             |
| A3  | 141     | "See the deployment guide." (no link)                                    | —                                                                                                                                                               | Linked `../deployment-guide.md#redis-…`                                                 |
| A4  | 149     | "Three of the four mail purposes read [locale] off a row"                | `registration.service.ts:161` VerifyEmail uses `dto.locale` (no row exists); only AccountExistsNotice + PasswordReset read the row                              | Two of four; VerifyEmail and NoAccountNotice take request locale                        |
| A5  | 284     | Session provider "polls every ten minutes"                               | `apps/web/src/components/session-provider.tsx:31` `refetchInterval={300}`                                                                                       | Five minutes, pointer to that file                                                      |
| A6  | 300     | Google step 3: "No row → create a passwordless account"                  | `auth.service.ts:169-175` refuses `!emailVerified` with 401 before create                                                                                       | Added the 401 refusal                                                                   |
| A7  | 349     | "Three unauthenticated routes send mail"                                 | Only `register` and `forgot-password` dispatch mail; `registration.service.ts` "There is no resend endpoint"                                                    | Two routes, named                                                                       |
| A8  | 353     | "per-recipient cooldown"                                                 | `guarded-mail.sender.ts` `cooldownKey` = purpose + recipient                                                                                                    | "per-recipient, per-purpose"                                                            |
| A9  | 368-373 | "One Postgres-backed suite … covers googleSub…"                          | `apps/api/test/*.db-e2e-spec.ts` = 5 suites; CI `api-e2e` and `api-e2e-db` both run Redis                                                                       | Plural suites, Redis need, named auth + rotation suites                                 |
| A10 | 430-434 | Bucket layout lists only `avatars/`; next prefix e.g. `exports/…`        | `conversation-audio.ts:130` `conversations/{ownerId}/{random16}.{ext}`; `storage.module.ts:52-63`                                                               | Added `conversations/` key shape                                                        |
| A11 | 450-456 | "Conversation audio must **not** go here … deliberately not this one"    | Recordings shipped in same bucket (59aeb0f0); `storage.module.ts` records owner's accepted-risk decision; landing copy amended (`packages/i18n/src/en.ts:549+`) | Rewritten as the accepted-risk decision, linked to `ai-providers.md` recordings section |
| A12 | 461/473 | Shared bucket exposes dev creds to "production avatars"; plain-text path | Same bucket holds recordings                                                                                                                                    | "avatars and recordings"; linked deployment-guide anchor                                |

Cited code comments confirmed covered by this file: `auth.service.ts:62` (persistent XSS → "The XSS story"),
`apps/web/auth.ts:44` (30-day sliding cookie → same), `apps/web/next.config.ts:18` (revocation + persistent
script → "What revocation exists" / XSS), `storage/avatar-image.ts:74` and `apps/api/.env.example:123`
(prefix is not an access boundary → "Bucket layout"). All cite `docs/system-architecture.md`, whose index
routes Authentication topics here.

Verified unchanged: 15-min HS256 TTL (`ACCESS_TOKEN_TTL_SECONDS`), refresh 32 random bytes base64url + SHA-256,
`rt:`/`rtfam:` key fields, 30-day family TTL, 10 s grace (`refresh-token-secret.ts`), reuse/orphaned verdicts
(`session-refresh.service.ts`), `isRevokedByPasswordChange` shared by adapter + refresh service, `@Public()`
handler-only (`jwt-auth.guard.ts:52`), `WS_SUBPROTOCOL = 'chatofy-v1'`, `afterInit` verifyClient, five
`isLiveSession` sites, 30-day `SESSION_MAX_AGE_SECONDS`, `POST /auth/revoke` from web + extension, 24 h register
token, reset key derivation, avatar 128 px WebP, `=s256-c`, `redirect: 'manual'`, `max-age=3600`.

## docs/architecture/modules-extension-ci.md (17 fixes)

| #   | Line    | Old claim                                                                   | Evidence                                                                                                                                                                 | Fix                                                                             |
| --- | ------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| M1  | 9       | `common/` has pipes                                                         | `apps/api/src/common/`: decorators, exceptions, filters, guards, interceptors, middleware, swagger, types — no pipes                                                     | Corrected list                                                                  |
| M2  | 18      | "(see Data Flow)" — section no longer in this file                          | moved to `data-flow.md`                                                                                                                                                  | Linked                                                                          |
| M3  | 22      | conversations routes omit audio                                             | `conversations.controller.ts:142,180` `PUT/GET :conversationId/audio`                                                                                                    | Added                                                                           |
| M4  | 33      | "see _AI Context_ under Data Flow"                                          | `data-flow.md` heading                                                                                                                                                   | Linked anchor                                                                   |
| M5  | 34      | auth: "register/login/me, and the four mail flows"                          | `auth.controller.ts` also refresh, revoke, google, verify-email, avatar, reset                                                                                           | Listed, linked `authentication.md`                                              |
| M6  | 36      | "_Avatar storage_ and _Conversation recordings_ under Data Flow"            | Now in `authentication.md` and `ai-providers.md`                                                                                                                         | Linked both                                                                     |
| M7  | 37      | Missing modules                                                             | `modules/redis`, `health`, `meta` exist; `redis.module.ts` imported only by AuthModule                                                                                   | Added `redis/`, `health/`, `meta/`; users/ notes `toUserContract`               |
| M8  | 56      | translate page is "the one call site for `useTranslateSettings`"            | Also `components/preferences/conversation-defaults-section.tsx:43`                                                                                                       | Corrected                                                                       |
| M9  | 58      | `src/conversation/conversation-session.ts` (web)                            | Missing; lives at `packages/realtime-client/src/conversation/conversation-session.ts`                                                                                    | Path fixed                                                                      |
| M10 | 59      | `src/audio/` (web)                                                          | Missing; `packages/realtime-client/src/audio/` (+ `ordered-playback`, `microphone-graph`)                                                                                | Path fixed                                                                      |
| M11 | 68      | "Web + Mobile consume `@chatofy/api-client`"                                | `apps/mobile/package.json` deps: only `@chatofy/types`, `@chatofy/ui`                                                                                                    | Web consumes; mobile not yet                                                    |
| M12 | 158-160 | "The web and mobile paths stay half-duplex"                                 | `use-streaming-translate.ts:432` `fullDuplex: true` (and the same doc's next paragraph says so)                                                                          | Reworded: loop ruled out per device on web/mobile, by construction in extension |
| M13 | 175     | `development-journey.md` section 10 (plain text, wrong relative)            | `docs/development-journey.md` "## 10. Outstanding work"                                                                                                                  | Linked `../development-journey.md#10-outstanding-work`                          |
| M14 | 256     | Not in scope: "injecting the translated voice into the outgoing microphone" | Shipped: outbound path, `microphone-patch.ts`, `page-playback-sink.ts`, described earlier in the same section                                                            | Removed item                                                                    |
| M15 | 264-272 | CI job list (Build "API + Web + Mobile"; missing jobs)                      | `ci.yml`: mobile has no build script; jobs also include verify:build + web smoke, root script tests, display-fidelity, sidecar-unit, realtime-replay, single-React check | Rewritten outline; points at `ci.yml` as owner                                  |
| M16 | (new)   | CI alert workflow undocumented                                              | `.github/workflows/main-failure-alert.yml` (PR #204)                                                                                                                     | Added short paragraph                                                           |
| M17 | 286-288 | `api-e2e-db` "runs the database-backed auth suite"; api-e2e no services     | `ci.yml`: Redis in both jobs, migration-drift check, `test:e2e:db` runs all `*.db-e2e-spec.ts`                                                                           | Corrected; deploy summary notes the `head_repository`/`main` gate (7c7cb532)    |

Verified unchanged: wxt permissions/commands (`Alt+Shift+C`), `createDirectionSession` → `LiveDirectionSession` |
`ConversationSession`, `loadContextHints`, `startCapture`/`toggleCaptureFor`/`refreshMenuTitle`/`documentUrlPatterns`,
`mayUnmountOverlay` in `site-enablement.ts`, `CUT_LOOKAHEAD_MS=1500`, `CUT_MIN_QUIET_MS=100`, `MIN_SPEECH_MS=120`,
`RESUME_MIN_SPEECH_MS=40`, `isBusy = queue.isPlaying || turns.size > 0`, registry `vi`/`en`, two `ignoreGhsas`,
e2e `node e2e/run.mjs`, `benchmarks/realtime/analyze-continuous.mjs`.

## docs/deployment-guide.md (10 fixes)

| #   | Line            | Old claim                                                                       | Evidence                                                                                                                                                               | Fix                                                                          |
| --- | --------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| D1  | 53-54           | Omitting `--env-file` makes model paths expand empty                            | `docker-compose.prod.yml` uses `${VAR:?…}`; ran `docker compose -f docker-compose.prod.yml config` without it → "required variable CHATOFY_ENV_FILE is missing" exit 1 | Now: compose refuses to run; explains `CHATOFY_ENV_FILE`                     |
| D2  | 92              | Step order `checkout → build → pg_dump → …`                                     | `deploy.yml`: check prod.env → build (all profiles, serial) → seed → backup → migrate …                                                                                | Order fixed; bullets for env check and profile build                         |
| D3  | 119-123         | "The chain is now a SINGLE migration"                                           | `apps/api/prisma/migrations/` has init + 3 later migrations                                                                                                            | Baseline plus later migrations                                               |
| D4  | 128-129         | "nothing destructive left in the tree"                                          | Two destructive migrations in tree                                                                                                                                     | Reworded: on a fresh DB they act on empty tables                             |
| D5  | 138-140,175-206 | Language-registry migrations "committed and pending release"; release procedure | Merged in PR #180 (bcd8c087, 2026-09-29), deploy run 36513577356 "Apply migrations: success"; prod `_prisma_migrations` (read-only psql) lists both finished           | Heading/intro now "applied in production"; removed one-off release procedure |
| D6  | 145-147,167,324 | compose commands without `--env-file`                                           | Same as D1 — they fail at interpolation                                                                                                                                | Added `--env-file`; redis `config get maxmemory` validated live → 268435456  |
| D7  | 187             | Cites `plans/260928-…/reports/phase-04…`, `phase-06…`                           | Paths missing; removed in 953b93de                                                                                                                                     | Points to git history (parent of 953b93de)                                   |
| D8  | 414             | "_Bucket layout_ in `docs/system-architecture.md`"                              | Section now in `architecture/authentication.md`                                                                                                                        | Linked anchor; prefix list adds `conversations/…`                            |
| D9  | 500             | Without R2 "the API … logs one warning naming the missing capability"           | `main.ts:46-78` warning is inside the production-only block and names avatars only                                                                                     | Narrowed: production only, worded for avatars                                |
| D10 | 206             | "see the project memory on this" (not a repo artifact)                          | —                                                                                                                                                                      | Removed with D5 procedure                                                    |

Verified unchanged: ports/project names/threads table, `REDIS_URL` pinned, redis flags + `mem_limit: 512m`,
`AUTH_URL` derived from `WEB_BASE_URL`, `R2_PUBLIC_BASE_URL` defaulted build arg (`apps/web/Dockerfile:34`),
`check-prod-env.mjs` semantics, `concurrency: deploy-prod`, `timeout-minutes: 30`, job-level `if:` with
`head_repository.full_name`/`head_branch` (7c7cb532), `BACKUP_RETENTION 14`, avatar `max-age=3600`, recording
routes 409 without R2, runner unit name + labels (`gh api …/runners`), linger=yes, `docker-desktop.service`,
context `desktop-linux`, `~/chatofy/models/{stt,tts}`, repo public, fork approval `all_external_contributors`,
no WS keepalive in gateway, `postgres:16-alpine` in both compose files and CI.

## Validation

- Relative links + anchors in all three files: scripted check, 0 failures.
- Backticked file paths: all exist except the two plan reports (fixed, D7).
- `npx prettier --write` on all three. Line counts 484 / 320 / 580 (≤ 800).

## Open questions / concerns (code, not docs — out of lane)

1. `apps/api/src/modules/mail/interfaces/mail-sender.interface.ts:95` comment repeats the wrong "Three of the four purposes read it off the row".
2. `apps/api/src/main.ts:72-76` R2 warning says "Avatar upload and removal will be refused; everything else works" — recordings are refused too.
3. `docker-compose.prod.yml` header comment still says interpolations "expand to empty" without `--env-file`; they now abort.
4. Code comments citing `docs/system-architecture.md` still resolve via the index; no code edits made.
5. Kept "Deploying the refresh-token change" section (stateful release notes for a long-shipped change); its rollback rules still hold, but it could move out of the evergreen guide.
