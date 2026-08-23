# Implementation — auth register/verify/reset + SMTP

Plan: `plans/260823-2053-auth-register-verify-reset-smtp/`
Executed: 2026-08-23, `/ak:cook --auto`, all 7 phases.

## Outcome

Registration no longer creates an account. Password hashed → packed into a signed
24 h token → mailed as a link; redeeming the link inserts the row. Register
answers 202 with one body for every address. A completed reset invalidates
earlier access tokens on HTTP, at the WebSocket upgrade, and closes that user's
already-open sockets.

## Phase status

| #   | Phase                                 | Result                                              |
| --- | ------------------------------------- | --------------------------------------------------- |
| 1   | Schema + repository seam              | Done                                                |
| 2   | Token revocation + socket termination | Done                                                |
| 3   | Mail module + abuse controls          | Done (delegated)                                    |
| 4   | Deferred registration + verification  | Done                                                |
| 5   | Password reset flow                   | Done                                                |
| 6   | Web auth pages                        | Done (delegated)                                    |
| 7   | Docs + gate                           | Done, except the manual browser pass — see Not done |

## What changed

**Schema.** One nullable column, `User.passwordChangedAt`. Migration
`20260823142610_add_user_password_changed_at`. No backfill, nothing read it until
phase 2. DB backed up before applying.

**Repository seam.** `findAuthStateById` (id + `passwordChangedAt` only — cannot
reach a response by construction), `findCredentialsById`, `updatePasswordHash(id,
hash, changedAt)` — hash and timestamp in ONE write, since a hash written without
its timestamp revokes nothing. Both doubles extended, no cast: the exhaustive
`jest.Mocked<UserRepository>` literal in `auth.service.spec.ts` keeps its
compile-time drift detection.

**Revocation** lives in `JwtAuthAdapter.verifyToken`, so `JwtAuthGuard` and the
gateway's `verifyClient` both inherit it with no wiring change. The DB read sits
**outside** the existing crypto `try` — a null row is 401, a _thrown_ read
propagates as 5xx. Collapsing both would turn a 30 s database blip into a forced
sign-out of every user across web/extension/mobile (`use-auth-recovery.ts` reads
401 from `/auth/me` as proof the session is gone) who then could not sign back in.
`iat` compared with strict `<` against a write **ceiled** to the next second;
non-finite `iat` refused (`Math.floor(undefined) < x` is `false` — it would have
passed).

**Socket termination.** `SessionTerminator` is a narrow seam transports register
_themselves_ with; `TranslateGateway` implements `closeSessionsFor` and closes
with 1008. The owner is read off the upgrade request that `verifyClient` stamped
(symbol-keyed) — **not** a "last verified subject" variable, which an upgrade that
verifies and then aborts would leave behind for the next socket, misattributing it.

**Purpose tokens.** `AUTH_JWT_SECRET` + purpose infix; reset additionally folds in
the row's _current_ hash, so a reset changes the key and kills every outstanding
link — single use, second reset and superseded link are all that one fact, with no
token table. The `:pwreset:` infix is load-bearing: without it a null-`passwordHash`
row derives the bare app secret and a stolen access token verifies as a reset
token. Tested explicitly for that row.

**Register timing.** Hash runs _before_ the existence check so both branches cost
the same. Asserted by `invocationCallOrder`, never elapsed time — a wall-clock
assertion on a 64 MiB argon2 sharing the translate threadpool either flakes or
uses an epsilon proving nothing, and a flaky security test gets skipped.

**e2e fixture.** `registerAndLogin` now seeds through the injected
`USER_REPOSITORY` then logs in for a real token. Works unchanged against the
in-memory double and Postgres, and spends **no** register throttle. All five
non-auth suites that import it pass untouched.

## Deviation from the plan — flagged for your decision

**Verification mail moved from the `Reserved` budget tier to
`AttackerTriggerable`.**

The plan states two things that conflict. Its criterion is _"mail for a
user-requested action on a **known row**"_; its example list puts _"verification"_
in the reserved tier. Register-with-a-fresh-address has no known row — the caller
invented the address. So with verification reserved, an attacker registering
rotating fresh addresses at the route's 5/60s (7,200/day from one IP) drains the
reserved ceiling in ~80 min, after which **nobody can reset a password** and every
route still answers 202. That is precisely the failure the tiering exists to
prevent — it is the plan's own arithmetic from its single-global-budget argument.

Applied the plan's principle over its example: `Reserved` now holds only mail that
can only be sent to a row that already exists (password reset), which is the only
traffic a ceiling can tell apart from an attack. Ceilings retuned 50/400 →
300/150: the attacker-facing tier now carries real registration volume, and reset
is low-volume and cooldown-bounded besides. Under Gmail's ~500/day either way.

Consequence accepted: during a registration flood, new signups can be blocked —
but existing users can still recover their accounts. Previously both died.

## Deployment-affecting change

`main.ts` now **refuses to boot in production** if the four `SMTP_*` vars are not
all set, or if `WEB_BASE_URL` is still the localhost default. The plan left this
as "refuse — or warn loudly"; the stronger option was taken, mirroring
`AUTH_JWT_SECRET`'s no-auth-off-mode precedent (red-team finding 13, rated High).

Consequence: an existing production deployment that sets neither will stop
starting after this ships. That is the intent — unset SMTP silently drops every
verification and reset mail, and a default `WEB_BASE_URL` mails a
plausible-looking wrong link — but it needs to be in the deploy notes, not
discovered at rollout. Dev, test and CI are unaffected: the gate is
production-only and every mail var is optional at the schema level.

## Code review, and what it caught

An independent `code-reviewer` pass over the API side returned two blocking
findings. Both were real, both verified before fixing, both fixed.

**B2 — `resetPassword` stamped `passwordChangedAt` BEFORE hashing.** The stamp
was computed, then `await this.hashPassword(...)` evaluated as an argument
(~100 ms of argon2), then the write committed. The old password stays valid
until that write, so a login completing after the ceiled second but before the
commit minted a token that outlived the reset **for the full seven days** — red
team finding 3 reappearing through argument-evaluation order. Fixed by hashing
first and stamping immediately before the write; residual is now the DB round
trip (single-digit ms), and is stated in the comment rather than implied.

Regression test added and **verified to fail against the reintroduced bug** — a
controlled clock starting on an exact second with the hash advancing it 900 ms,
so it catches the ordering deterministically rather than the ~1-in-10 of the time
a timing-based test would.

**B1 — I broke the extension test suite** (`popup-render.spec.tsx`, 2 tests) and
had not run it: `use-popup.ts` began awaiting a real `fetch` to `/auth/me` during
popup init. Two problems, both fixed: the suite was red, and popup first paint
now blocked on a network round trip — on a dead network the user saw a disabled
control for the whole timeout. Now painted from storage immediately and
downgraded only on a definite 401. Added `access-token.spec.ts` (5 tests), which
did not exist: `verifyAccessToken` had no coverage at all.

Also fixed: the cooldown map was never pruned while its comment claimed it was
(now pruned, comment true); `NoopMailSender` resolved on a send that reached
nobody, burning the user's 10-minute cooldown (now rejects); `name` was
unbounded and rides in the mailed link (now `.max(80)` + control-character
refusal — phase 4 named this risk and nothing had bounded it); a sub-millisecond
race where a socket registered just after a reset would never be closed (now
re-checked after registration, which closes the interleaving entirely); and two
comments that overstated what the code did.

**Renegotiated, needs your decision:** phase 3's criterion _"exhausting the
attacker-class budget does not stop verification or reset mail"_ is now half
true — reset is protected, verification is not, because of the tier change above.
Both criteria cannot hold at once; protecting account recovery was chosen. If
blocking new registrations for the rest of a 24 h window is also unacceptable,
the clean fix is a **third tier** for verification with its own ceiling, not a
return to `Reserved`. Ticks were removed from the phase and plan rather than
silently re-ticked.

**L3 — a residual oracle in the reserved tier, recorded not fixed.** Because
`Reserved` is reachable only by naming an address that HAS an account, filling it
to one below its ceiling and watching whether your own reset mail arrives leaks
one bit about a target. It costs 149 real, separately-verified mailboxes and
yields one bit per 24 h, and it is inherent to any budget keyed on row existence —
which is what the tiering is. Removing it would mean removing the protection.
Written into `mail-sender.interface.ts` beside the tier definition, with an
explicit warning not to "fix" it by failing open, which would trade one bit a day
for the product-wide recovery outage the tier exists to prevent.

All 11 new lint warnings cleared (`jwt.decode`'s generic instead of assertions,
typed mock returns, and asserting on `typeof message` rather than an `any`-typed
`expect.any`). The 2 that remain are pre-existing and in files this work did not
touch.

## Gate

| Check                           | Result                                          |
| ------------------------------- | ----------------------------------------------- |
| `pnpm --filter api test`        | 515 passed, 37 suites                           |
| `pnpm --filter api test:e2e`    | 50 passed (9 skipped, pre-existing)             |
| `pnpm --filter api test:e2e:db` | 29 passed                                       |
| `pnpm --filter web test`        | 348 passed, 14 files                            |
| `pnpm --filter extension test`  | 200 passed, 18 files                            |
| `pnpm lint` (all packages)      | 10/10, **0 errors** (14 warnings, pre-existing) |
| `pnpm typecheck` (all packages) | 14/14 clean                                     |
| `pnpm build` (all packages)     | 8/8, all four new routes present                |

Note: the plan's gate commands say `--filter @chatofy/api` / `@chatofy/web`. The
actual package names are `api` and `web`.

## Not done

- **The manual browser pass** (phase 7 step 5–6): register → verify → sign in →
  forget → reset → sign in in a real browser, a translate socket held open across
  a reset, and the extension popup dropping "signed in" after a reset. Needs a
  human at a browser. Socket closure across a real reset IS covered by an
  automated test against a real `ws` server (`ws-auth.e2e-spec.ts`), including
  that a bystander's socket survives.
- **The manual timing measurement** of register's two branches (phase 7 step 7),
  deliberately not a CI gate per phase 4.
- Nothing committed — no commit was requested.

## Unresolved questions

1. Plan open question 1 — do phases deploy independently or as one release? If
   independently, phases 2 and 5 should ship together, or phase 2's per-request
   read costs latency for no revocation benefit in between.
2. Plan open question 2 — `/verify-email` bounces to `/login` rather than signing
   the user in. Implemented as assumed (the page never held the password).
3. Budget ceilings 300/150 are a judgment call, not measured. Retune via
   `BUDGET_CEILINGS` in `guarded-mail.sender.ts` once real volume is known.
4. Rollback asymmetry stands: once reset has run in production, removing the
   revocation check _resurrects_ tokens a reset deliberately killed, silently.
   An emergency removal must be paired with rotating `AUTH_JWT_SECRET`.

---

## Follow-up cleanups (requested after the plan, 2026-08-23 ~22:30)

### `APP_URL` removed

Asked why both `APP_URL` and `WEB_BASE_URL` exist. They are **not** duplicates —
`APP_URL` was the API's own public URL, `WEB_BASE_URL` is the web app's origin and
is what mailed links are built from. But `APP_URL` was read in exactly one place,
a startup log line, and influenced no behaviour. Removed from `env.schema.ts`,
`main.ts` and `.env.example`; the log now uses `http://localhost:${PORT}`.

Verified by booting the built API (`pnpm start:prod`, PORT=3099): log prints the
correct URL, `/health` answers 200.

**Not** consolidated, deliberately: `CORS_ORIGIN` looks like it duplicates
`WEB_BASE_URL` but must stay independent — the extension calls the API from a
`chrome-extension://` origin, so narrowing CORS to the web origin would break it
silently. Recorded so the next tidy-up does not "fix" it.

The three names for "the API's URL" (`NEXT_PUBLIC_API_BASE_URL`,
`WXT_API_BASE_URL`, and formerly `APP_URL`) are not fully avoidable — Next and WXT
each mandate their own prefix for build-time inlining.

### Redundant tables and migrations removed

`ConversationSession` and `TranscriptSegment` were placeholder models. Verified
unused before dropping: no `prisma.conversationSession` / `prisma.transcriptSegment`
call anywhere, no sessions controller (the `sessions.ts` HTTP contract in
`@chatofy/types` has no implementation), and both tables held **0 rows**.

Care worth noting: those two NAMES do appear across the codebase, but as a
client-side class in `@chatofy/realtime-client` and a zod contract in
`@chatofy/types` used by the live WebSocket events. Neither was backed by these
tables, and neither was touched.

Migrations squashed 3 → 1 (`20260823153702_init`) by **baselining**, not by
`migrate reset`, so the existing user row survived. Sequence: back up → drop the
two empty tables → clear `_prisma_migrations` → `prisma migrate resolve --applied`.

The squash was verified rather than assumed: the baseline was applied to a fresh
scratch database and compared against the live one. Columns, types, nullability,
defaults and all three indexes are **identical**. Two differences, both explained
and harmless — column ORDER (live had later columns appended by `ALTER TABLE`;
irrelevant in Postgres), and the `uuid-ossp`/`pgcrypto` extensions, which come
from `docker/postgres/init.sql` on first container start rather than from any
migration, and which nothing in the codebase uses (`cuid()` is generated in JS).

Observation, not acted on: the deleted `20260822114500_add_auth_columns` carried a
`down.sql` while the other two did not — so the repo's down-migration convention
was inconsistent, not absent as phase 1's rollback note assumed. The new baseline
has none; a down for an `init` baseline would just be `DROP TABLE "User"`.

Gate after both cleanups: api 515 · e2e 50 · db-e2e 29 · web 348 · extension 200;
lint 0 errors; typecheck 14/14; build 8/8.
