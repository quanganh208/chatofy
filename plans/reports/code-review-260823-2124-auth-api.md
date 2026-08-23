---
title: 'Code review — auth register/verify/reset (API, types, mobile, extension)'
date: 2026-08-23
reviewer: api-review
scope: 'apps/api, packages/types, apps/mobile, apps/extension — apps/web EXCLUDED'
plan: plans/260823-2053-auth-register-verify-reset-smtp/
---

# Code review — auth register/verify/reset API side

Scope: everything in the working tree except `apps/web`. Nothing committed.
Gate run below; two blocking findings.

## Gate results

| Command                                  | Result                                                               |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `pnpm --filter api test`                 | **pass** — 37 suites, 514 tests                                      |
| `pnpm --filter api typecheck`            | **pass**                                                             |
| `pnpm --filter api lint`                 | pass, 0 errors, 13 warnings (11 new, all `no-unsafe-*` in new specs) |
| `pnpm --filter api test:e2e`             | **pass** — 50 passed, 9 skipped                                      |
| `pnpm --filter api test:e2e:db`          | **pass** — 29 passed                                                 |
| `pnpm --filter extension test`           | **FAIL — 2 tests**, caused by this change (see B1)                   |
| `pnpm --filter extension typecheck`      | pass                                                                 |
| `pnpm --filter mobile typecheck`         | pass                                                                 |
| `pnpm --filter @chatofy/types typecheck` | pass                                                                 |

---

## Blocking

### B1 — `apps/extension` test suite is broken by the popup change

`src/popup-render.spec.tsx` — "renders its primary action" and "keeps a running
capture stoppable from the wrong tab" fail. Verified causal: stashing **only**
`apps/extension/entrypoints/popup/use-popup.ts` and
`apps/extension/src/access-token.ts` restores 8/8 passing.

Cause: `use-popup.ts:70` replaced a storage read with
`verifyAccessToken(stored.apiBaseUrl)` (`access-token.ts:47`), which does a real
`fetch` to `${apiBaseUrl}/auth/me`. In jsdom nothing mocks it; the request to
`127.0.0.1:3000` is refused asynchronously, so `setSignedIn` lands after
`mount()` resolves and the toggle is still disabled. Test output is also flooded
with `ECONNREFUSED` stack traces.

Two separate problems, both real:

1. **The suite is red.** Phase 2's Related Code Files names `use-popup.ts` and
   its Success Criteria ticks "The extension popup stops reporting 'signed in'
   once its token is refused" — there is **no test for `verifyAccessToken`
   anywhere** (`grep -rln verifyAccessToken apps/extension` → only the two
   source files), and the tests that did exist now fail.
2. **Popup init now blocks on a network round trip.** Signed-in state used to
   render from `chrome.storage` synchronously; it now waits for `/auth/me`. On a
   dead network the popup shows a disabled control for the full fetch timeout
   before the `catch { return true }` at `access-token.ts:58` restores it. The
   fail-open-on-network-error reasoning in the doc comment is right; what is
   missing is not blocking the first paint on it (render optimistically from
   storage, then downgrade on a 401).

### B2 — `resetPassword` stamps `passwordChangedAt` **before** the argon2 hash, reopening ~10 % of the window the ceiling exists to close

`apps/api/src/modules/auth/auth.service.ts:446-451`:

```ts
const changedAt = new Date(Math.ceil(Date.now() / 1000) * 1000); // T
await this.users.updatePasswordHash(
  userId,
  await this.hashPassword(dto.password), // ~100 ms AFTER T
  changedAt,
);
```

`changedAt` is computed at `T`, then ~50–150 ms of argon2 runs, then the write
commits at `T + H`. The old password stays valid for that whole interval.

Let `S = ceil(T/1000)`. The adapter accepts any token with `iat >= S`
(`jwt-auth.adapter.ts:87-90`). A login that completes in `[S·1000, T + H)` mints
`iat = S` and therefore **survives the reset for the full seven days**. That
interval is non-empty whenever `1000 - (T mod 1000) < H` — roughly 10 % of resets
with `H ≈ 100 ms`, giving an up-to-100 ms exploitable slice.

This is exactly red-team finding #3 the ceiling was adopted to close: the person
a reset locks out is the one who still knows the old password and can poll
`POST /auth/login` (10/60 s per IP, trivially parallelised across IPs) until a
token lands inside that second.

Fix: move the stamp after the hash, immediately before the write —

```ts
const passwordHash = await this.hashPassword(dto.password);
const changedAt = new Date(Math.ceil(Date.now() / 1000) * 1000);
await this.users.updatePasswordHash(userId, passwordHash, changedAt);
```

which shrinks the residual window from ~100 ms to DB-write latency (~1-5 ms).
Closing it entirely needs the stamp taken after the write commits, or a small
forward slack added before ceiling.

The unit test at `auth.service.spec.ts:539` only asserts
`changedAt.getTime() % 1000 === 0` and `>= Date.now() - 1000`; it cannot catch
this. A regression test should assert `changedAt >= (the moment the write was
issued)`.

---

## High

### H1 — Phase 3 Success Criterion is ticked but is now false

`phase-03-mail-module-and-abuse-controls.md` ticks:

> - [x] Exhausting the attacker-class budget does **not** stop verification or
>       reset mail for legitimate users

Verification mail is now `MailBudgetClass.AttackerTriggerable`
(`auth.service.ts:307`), so exhausting that tier **does** stop verification mail.
Same wording appears unticked in `plan.md`'s Success Criteria. The criterion is
now only half true (reset is protected; verification is not).

On the deviation itself (review item g): **the reasoning is sound.** The plan's
own rule is "user-requested action on a KNOWN ROW", and register-with-a-fresh-
address has no row, so classifying it `Reserved` would let an address-rotation
attacker at 5/60 s (7,200/day) drain the reserved tier through registration and
kill password reset product-wide — the precise failure the tiering exists to
prevent. Trading "attacker can kill registration" for "attacker can kill account
recovery" is the correct direction. It is documented honestly in
`docs/system-architecture.md` and argued in
`mail-sender.interface.ts:37-44`. What is wrong is only the tick.

The residual: an attacker who exhausts 300 AttackerTriggerable in ~1 h stops all
new registrations for the remainder of the rolling 24 h, with every route still
answering 202 and only a log line. If that is unacceptable, the clean fix is a
third tier (registration-verification with its own ceiling) rather than reverting
the classification. Either way the criterion text needs renegotiating with the
plan owner — do not silently re-tick.

New ceilings themselves (300/150, sum 450 < Gmail's ~500) introduce no new
problem I can find.

### H2 — `GuardedMailSender.lastSentAt` is never pruned, and its comment says it is

`guarded-mail.sender.ts:64-65`: "Both structures below are pruned lazily (on the
next relevant check, not on a timer) rather than swept".

Only `budgetLog` is pruned (`isBudgetExhausted`, line 144). `lastSentAt`
(line 79) is written at line 134 and **never** read-and-expired or deleted. The
map grows monotonically for process lifetime.

The follow-on claim "The cooldown map's growth is self-bounding" is true about
the _rate_ (≤ 450 new keys per rolling 24 h) and false about the _total_: ~164 k
entries/year, ~13 MB. Not an outage, but the comment asserts a property the code
does not have — which this review is specifically asked to catch. Either prune
entries older than `COOLDOWN_MS` inside the same lookup, or correct the comment
to say only the budget log is pruned and the cooldown map grows.

---

## Medium

### M1 — Race: a socket upgraded microseconds before a reset is never registered, and never closed

`ws-auth.ts:82-89` stamps the subject and calls `cb(true)`; the gateway registers
the socket in `handleConnection` (`translate.gateway.ts:325-334`). Between the
`findAuthStateById` read inside `verifyToken` returning and that registration,
`closeSessionsFor` (line 342) can run and find nothing to close. The socket then
lives unbounded — the guard returns `true` for every non-HTTP context and no
frame re-authenticates.

Window is sub-millisecond and requires the reset to land inside it, so severity
is low in practice; recording it because the whole point of the registry is that
a reset closes _everything_. A cheap mitigation: after registering in
`handleConnection`, re-read the auth state and close immediately if the token is
now stale.

Not a misattribution risk: the symbol-on-the-request approach
(`VERIFIED_USER_ID`, `ws-auth.ts:43`) is correct and its rationale about the
"last verified subject" variable is right. `handleConnection`'s `args[0]` being
the upgrade request is empirically confirmed by the real-`ws` e2e test at
`test/ws-auth.e2e-spec.ts:234` ("closes a socket that is already open…"), which
passes.

### M2 — Register's two branches are not quite symmetric on the response path

`auth.service.ts:281` (taken) calls `dispatchMail`, which defers everything into
`Promise.resolve().then(...)` — nothing runs synchronously. `auth.service.ts:290`
(fresh) calls `this.tokens.issueRegistration(...)` **directly**, so the
synchronous head of `JwtService.signAsync` (payload assembly, option validation,
secret concatenation) runs before `return`. Same asymmetry in `forgotPassword`
(line 373 vs line 394).

The comment at `auth.service.ts:288-289` — "Minted inside the detached path, not
before it, so neither branch does more work than the other on the way to the
response" — therefore overstates what the code does. The residual work is
sub-microsecond and unmeasurable across a network, so I am **not** calling this
an oracle; but the comment is load-bearing (it is what stops the next person
reordering it) and should say "started, not awaited" rather than "inside the
detached path". Making it literally true is one line: wrap the mint the same way
`dispatchMail` wraps the send.

Everything else in the register uniformity story checks out and is genuinely
tested: identical status and body (`auth.service.spec.ts:114`, byte-compared via
`JSON.stringify`, plus HTTP-level at `auth.db-e2e-spec.ts:203`), no row created
(`auth.service.spec.ts:99`), hash strictly before the lookup by
`invocationCallOrder` (`auth.service.spec.ts:141`), answer returned before any
send completes (`auth.service.spec.ts:204`, against a send that never resolves),
same throttle bucket for both branches (one route), and identical error shapes.

### M3 — 11 new lint warnings in the new specs

`jwt-auth.adapter.spec.ts:86,103,116`, `auth.service.spec.ts:224,265,524,580,630`,
`purpose-token.spec.ts:39,45,94` — all `no-unsafe-assignment` /
`no-unsafe-member-access`. Warnings, not errors, so the gate is green, but
`auth.service.spec.ts` is the highest-risk spec in this change and phase 1
explicitly demanded that its typing stay sharp. Worth typing the mock returns.

---

## Low

### L1 — An unbounded `name` can produce an unusable verification link

`registerRequestSchema.name` is `z.string().min(1)` with no maximum
(`packages/types/src/http/auth.ts:15`), and it is embedded in the registration
JWT (`purpose-token.ts:111`), which becomes `?token=…` in the mailed URL
(`auth.service.ts:308`). A 10 kB display name yields a ~13 kB link — past what
mail clients wrap cleanly and past several proxies' request-line limits, so that
user's verification silently never works. Phase 4's Risk Assessment named this
("check a long display name does not push the link past what mail clients wrap")
and nothing was checked or bounded. A `.max(80)` would settle it; the plan
already specifies the CR/LF strip that must accompany one.

### L2 — `NoopMailSender` "success" burns the cooldown and the budget

`noop-mail.sender.ts:111` resolves, so `GuardedMailSender` records the send
(lines 133-135). In the fail-closed no-SMTP configuration, a user who never
received anything is locked out of a resend for 10 minutes. Consistent with
"caller still sees success", but it is the same class of failure the "record on
success, not dispatch" rule was written to avoid.

### L3 — Aggregate existence side channel via the reserved tier

`Reserved` is only reachable by naming an address that **has** an account
(`auth.service.ts:379`). An attacker holding 149 accounts of their own can fill
the tier to 149/150, probe a target with forgot-password, then check their own
mailbox: no mail ⇒ the target had an account. One bit per rolling 24 h, 149
controlled accounts, ~50 min of requests at 3/60 s. Inherent to any tiering keyed
on row existence — which the plan mandated — and **made harder**, not easier, by
the reclassification in H1. Recorded so it is not re-discovered as new.

---

## Verified sound (do not re-litigate)

- **Key derivation.** `purpose-token.ts:92-107`. Register key
  `SECRET:register:`, reset key `SECRET:pwreset:<hash ?? ''>`. For a
  null-`passwordHash` row the reset key is `SECRET:pwreset:` — never the bare
  `AUTH_JWT_SECRET`, so an access token cannot verify as a reset token and the
  reverse fails too. Both directions are tested for the null-hash row
  specifically (`purpose-token.spec.ts:114-134`), plus the `purpose` claim check
  (lines 122, 179) as the second layer.
- **`unverifiedSubject` is lookup-only.** `auth.service.ts:425-434`: the decoded
  `sub` selects the row whose hash completes the key; the id written at line 447
  is `userId` returned from `verifyPasswordReset`, i.e. the **verified** payload.
  Asserted at `purpose-token.spec.ts:98`.
- **The DB read is outside the crypto catch.** `jwt-auth.adapter.ts:44-70`: the
  `try/catch` closes at line 54, `findAuthStateById` is at line 69. Null row →
  401 (line 70); thrown read propagates. Tested at
  `jwt-auth.adapter.spec.ts:139,147`.
- **Non-finite `iat` refused.** `jwt-auth.adapter.ts:77-80`, tested at
  `jwt-auth.adapter.spec.ts:126`. The `Math.floor(undefined) < x === false`
  fail-open is genuinely closed.
- **Same-second token refused** given a correctly ceiled write —
  `jwt-auth.adapter.spec.ts:96`. The comparison itself is correct; B2 is a defect
  in _when the writer takes its clock reading_, not in the comparison.
- **`verifyEmail` cannot be used to overwrite or inject.** `auth.service.ts:340`
  builds the `create` argument field by field from the verified payload; no
  spread. A non-duplicate DB fault is rethrown unchanged (line 352) and is
  therefore a 5xx, never "bad link" — tested at `auth.service.spec.ts:308`.
- **No secret reaches a response.** `findAuthStateById` returns a shape nothing
  above the auth path can name; `InMemoryUserRepository.toRecord` strips
  `passwordChangedAt` (`in-memory-user.repository.ts:35-40`); Prisma
  `updatePasswordHash` selects `RECORD_SELECT`. Asserted at
  `auth.db-e2e-spec.ts:239,264` and against a strict schema at
  `auth.service.spec.ts:651`.
- **Mail content.** `MailDispatch` has no free-text field
  (`mail-sender.interface.ts:65-70`); bodies are constants plus the link
  (lines 84-117); CRLF in `to` is rejected, not stripped
  (`guarded-mail.sender.ts:95`); log lines carry a masked recipient only.
- **Link origin is configuration, never `Host`.** `auth.service.ts:171-175`,
  `WEB_BASE_URL` defaulted in `env.schema.ts` and gated in production at
  `main.ts:29-53`. `void bootstrap()` + Node 24 makes the throw an actual refusal
  to boot.
- **Console sender selection is fail-closed.** `mail.module.ts:179` matches
  `development`/`test` exactly, not `!== 'production'`.
- **One mail seam.** `MailModule` exports only `MAIL_SENDER`
  (`mail.module.ts:218`), bound to `GuardedMailSender` wrapping the concrete
  sender — no unguarded seam is reachable.
- **Login is unchanged.** `auth.service.ts:465-480` is byte-identical to before;
  one generic 401, no new branch, `DUMMY_HASH_PROMISE` intact.
- **Callers walked.** `registerAndLogin` (`test/utils/auth-fixture.ts`) now seeds
  through `USER_REPOSITORY` then logs in; all five importing suites pass under
  both e2e configurations, and no suite disables `ThrottlerGuard`.
  `AuthClient.signUp`'s return type change reaches only
  `auth-provider.tsx:74-79` (mobile stub); mobile typechecks.
- **Stale-comment sweep.** `grep -rn "non-goal\|revocation\|non-revocable"` over
  `apps/api apps/extension apps/mobile packages docs README.md` returns no false
  claim. The `apps/web` half is out of this review's scope.

## Phase criteria: ticked but not satisfied

| Phase | Criterion                                                                        | Status                                                                     |
| ----- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 2     | "The extension popup stops reporting 'signed in' once its token is refused"      | No test exists; the change breaks 2 existing extension tests (B1)          |
| 3     | "Exhausting the attacker-class budget does not stop verification or reset mail"  | False for verification by deliberate design change (H1)                    |
| 5     | "A reset token is refused after use, after 30 minutes, and after a second reset" | Satisfied, but the _end-to-end_ revocation write it arms has the B2 window |

All other ticked criteria in phases 1–5 verified against code and tests.

## Recommended actions

1. Fix B2 — move the `changedAt` stamp after the hash; add a regression test
   asserting `changedAt >= write-issue time`.
2. Fix B1 — do not block popup first paint on `/auth/me`; add a spec for
   `verifyAccessToken` (401 clears, 5xx/network does not) and repair
   `popup-render.spec.tsx`.
3. Resolve H1 with the plan owner: either accept "registration mail is
   attacker-class" and rewrite the criterion, or add a third tier. Do not re-tick
   as-is.
4. H2 — prune `lastSentAt`, or correct the comment.
5. M2 — wrap the token mint the way `dispatchMail` wraps the send, so the comment
   becomes literally true.
6. M1, M3, L1, L2 as time allows.

## Unresolved questions

1. **H1 is a deviation from an accepted, red-teamed plan.** Reclassifying
   verification mail is a scope/security trade the plan owner made explicitly
   (finding #5). Who signs off on the change — and does the plan text get
   amended, or a third budget tier added?
2. Is "an attacker can stop all new registrations for 24 h from one IP" an
   accepted outcome? It is the direct consequence of the new classification and
   is not written down anywhere as accepted.
3. Should `name` gain a `.max()` now (L1), given the plan deferred it to
   "if a greeting is wanted later" but the link-length hazard exists today?
4. B2's residual DB-write window: acceptable, or should the stamp be taken after
   the write commits?
5. `apps/web` was excluded from this review — the proxy/redirect finding (#2) and
   the token-free api-client (#19) are unverified here.
