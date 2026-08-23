# Brainstorm — register page, email verification, password reset, Gmail SMTP

Date: 2026-08-23 · Branch: `main` · Advisory: `kongming` (`--advice`)

## Outcome

Web gains four unauthenticated pages — `/register`, `/verify-email`,
`/forgot-password`, `/reset-password`. Nest gains the endpoints behind them, a
`MailSender` seam, and Gmail SMTP delivery. Registration stops leaking which
emails have accounts. A completed reset invalidates access tokens issued before
it, on both the HTTP and WebSocket paths.

## Decisions taken by the user (2026-08-23)

| #   | Decision                                            | Consequence accepted                                                                            |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Email verification on register is **in scope**      | New column, two new endpoints, login gains an unverified branch                                 |
| 2   | Post-reset token invalidation is **in scope**       | One DB read per authenticated request **and** per socket upgrade                                |
| 3   | Mail lives in the **Nest API**                      | Web keeps no DB, no identity secrets; mobile/extension inherit the endpoints free               |
| 4   | `POST /auth/register` → **uniform 202, no session** | Closes the existence oracle; register no longer signs the user in; e2e auth fixture must change |

Decisions 1 and 2 **reverse two stances currently documented in source** —
`jwt-auth.adapter.ts:56` ("NOT a revocation path… a revocation this design has
already decided not to offer") and `auth.service.ts:122` ("closing it needs an
email-verification flow, which is out of scope"). Both comments must be rewritten,
not left contradicting the code.

Advisory counsel recommended keeping 1 and 2 as non-goals. Overridden by the
user, knowingly. Counsel then re-priced 2 against the wider scope and agreed the
check belongs in `JwtAuthAdapter.verifyToken` — the placement below is the agreed
answer, not a finding against counsel.

## Constraints

- API stays the sole identity authority. Web's NextAuth remains a thin session
  shell: `strategy: 'jwt'`, no adapter, no `DATABASE_URL`.
- Revocation must cover **both** enforcement paths. `JwtAuthGuard`
  (`common/guards/jwt-auth.guard.ts:56`) and the WS upgrade refusal
  (`modules/translate/ws-auth.ts:38`, wired at `translate.gateway.ts:107`) both
  call `AUTH_ADAPTER.verifyToken` and nothing else. WS carries the translate
  traffic — a check that misses it is not a revocation.
- Live `User` rows exist. The verification migration must not lock them out.
- Existing non-oracle guarantees hold: `login` answers wrong-password and
  unknown-email identically; `normalizeEmail` applies to every new email lookup.
- Single-instance API (the in-memory throttler already assumes it).

## Non-goals

Password change while signed in · mail queue or retries · HTML email templates
(plaintext only) · caching the revocation read · audit trail of reset requests ·
account lockout · cleanup cron
for stale unverified rows · relaxing the Google-linking rule for unverified
password rows · register / reset **pages** for mobile and extension (the API
endpoints are platform-neutral, so parity stays free later).

**Enabled, deliberately not built:** verification finally answers the squatting
scenario the Google-linking comment agonises over — a squatter who registers
`victim@company.com` can no longer verify, so cannot log in, so holds nothing.
That would permit relaxing branch 2b for unverified password rows. Out of scope;
recorded so the next person sees it was noticed.

## Direction

### Token scheme — stateless HMAC, no token table

Both mail-borne tokens are JWTs signed with a key **derived from the field the
action changes**, so redeeming one invalidates it and every outstanding sibling.
No token table, no `usedAt`, no cleanup job, no migration for tokens.

| Flow   | Derived key                                                                       | TTL    | Self-invalidates when        |
| ------ | --------------------------------------------------------------------------------- | ------ | ---------------------------- |
| Reset  | `AUTH_JWT_SECRET + ':pwreset:' + (passwordHash ?? '')`                            | 30 min | `passwordHash` is written    |
| Verify | `AUTH_JWT_SECRET + ':verify:' + (emailVerifiedAt?.toISOString() ?? 'unverified')` | 24 h   | `emailVerifiedAt` is written |

**The purpose strings are security-critical and must reach the plan verbatim.**
Without `:pwreset:`, a row with a null `passwordHash` derives exactly the bare
`AUTH_JWT_SECRET` — a stolen 7-day access token would then verify as a reset
token. Same argument for `:verify:`. A `purpose` claim is also checked on redeem,
belt and braces.

Redeem order: decode **unverified** to read `sub` → load that user's current
field → derive key → `verifyAsync` → check `purpose` → act. Never trust the
payload before the signature check.

**While a row is unverified the verify key is identical for every user** — its
variable component is the constant `'unverified'`, unlike the reset key's
per-user hash. That is safe _only_ because the per-user binding lives in the
signed `sub` claim. So redeem must act exclusively on `sub` and must never accept
an email or id alongside the token. Say why in the code, or someone will
"improve" it by adding an email parameter and turn one shared key into a
cross-account takeover.

One ~40-line issue/redeem helper parameterised by purpose and key-component —
not a module.

A redeemed reset token is itself proof of mailbox control, so completing a reset
also sets `emailVerifiedAt` if it was null.

### Revocation — one choke point, not two

`passwordChangedAt` is checked inside **`JwtAuthAdapter.verifyToken`**, not in
the guard. Both HTTP and WS already funnel through that one method, and
`JwtAuthAdapter` **already injects `UsersService`** — so this adds no new
coupling to the provider-agnostic `AuthAdapter` seam and no call-site changes.

**The same-second bug.** JWT `iat` is whole seconds; a `DateTime` carries
milliseconds. Reset writes `12:00:00.500`, the next login mints `iat =
12:00:00`, and a strict millisecond comparison rejects a session seconds old.
Truncate **both** to seconds and reject only a strictly older second:

```
passwordChangedAt != null && Math.floor(claims.iat) < Math.floor(passwordChangedAt.getTime() / 1000)
```

Strict `<`, never `<=` — rejecting the same second re-creates the exact bug the
truncation exists to fix. Truncate at write _and_ floor both in the comparison:
the comparison is the invariant, write-truncation is hygiene that stops a future
writer (a password-change endpoint, say) from silently reintroducing it.

**Guard the `NaN` fail-open.** `AuthClaims` types `iat` as `unknown`, and
`Math.floor(undefined) < x` is `false` — the check _passes_. Unexploitable today,
since forging a token without `iat` needs the secret, but it is one line: once
`passwordChangedAt != null`, reject any token whose `iat` is not a finite number.

`passwordChangedAt` is a **dedicated nullable column written from the app
clock** — the same clock that stamps `iat`, so skew is structurally zero. Not
SQL `now()`, and emphatically not `@updatedAt`, which flips on any write: a
`preferredLanguage` change would sign every user out.

The same read also rejects a token whose row is **gone**, which closes the
separately documented gap where a deleted user's token keeps working for seven
days. Free, but a real behaviour change — name it, don't let it look accidental.

**No caching.** A TTL cache re-opens exactly the revocation window this is being
built to close. If it ever matters: a 30s map keyed by userId, documented as
"revocation lag ≤ 30s". Not now.

Cost, to be written into the two comments that currently decline it: one indexed
PK select per authenticated HTTP request, and **once per WebSocket connection at
upgrade** — the audio frame path is untouched.

Both `jwt-auth.guard.ts` ("never reads the database") and `jwt-auth.adapter.ts`
("NOT a revocation path") go stale with this change. In this codebase the
comments are the spec; updating them is part of the work.

### Verification enforcement — after the password check, never before

`login` verifies the password first. Wrong password → the existing generic 401.
Correct password but unverified → a distinct 403 naming the reason, with a
resend affordance. That is not an oracle: the distinction is only reachable by
someone who already proved they hold the account.

**Blocking at login is what makes this cheap.** Tokens are minted in exactly one
place — `sessionFor`, reached only from register, login and google. If an
unverified account cannot pass login it never holds a token, so **no per-route
verified check, no new decorator, no new guard surface, and no WS change is
needed anywhere.** The alternative — let them in and gate the translate routes —
would need a new check on HTTP _and_ a second at the WS upgrade, to protect a
feature the user cannot reach anyway.

Migration backfills existing rows (`emailVerifiedAt = now()`). They predate the
rule; locking them out is a regression, and they cannot be re-verified without
unsolicited mail. `now()` rather than `createdAt` — it records that the migration
blessed them, which is the truth, instead of claiming they verified at signup.

**Deploy order is load-bearing: the backfill ships in the same migration as the
login enforcement.** Enforcement landing first locks out every live user.

`emailVerifiedAt` is also set at Google account creation and at Google link time
(case 2a) — `identity.emailVerified` is already required on both paths.

### Endpoints (Nest)

| Route                            | Answer                                                                                                   | Throttle |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| `POST /auth/register`            | **202 always** — new address gets a verify mail, taken address gets a "you already have an account" mail | 5/60s    |
| `POST /auth/verify-email`        | 200                                                                                                      | 10/60s   |
| `POST /auth/verify-email/resend` | **202 always**                                                                                           | 3/60s    |
| `POST /auth/forgot-password`     | **202 always**                                                                                           | 3/60s    |
| `POST /auth/reset-password`      | 200, no session — user goes to sign in                                                                   | 10/60s   |

SMTP send is **detached** (`void send().catch(log)`) on every uniform-202 route.
Awaiting it would make response time the oracle the status code just closed —
microseconds for unknown vs. up to seconds for a real send. All three
mail-bearing routes are the same shape: `@Public`, always 202, detached send,
throttled. Write the pattern once.

**Two details or the register oracle merely moves:**

1. **Equal-cost branches.** The fresh-address path pays ~100 ms of argon2 and the
   taken path currently pays none — a timing oracle replacing the status one.
   Hash the password _before_ the existence check so both branches cost the
   same. This is the same standard of care the existing `DUMMY_HASH_PROMISE`
   comment already applies to login.
2. `UserAlreadyExistsError` from the insert race stops mapping to 409 and
   instead triggers the same "you already have an account" mail. The two paths
   have to stay indistinguishable under a race, exactly as the current comment
   argues for the 409 they replace.

**Contract change, not a footnote:** `POST /auth/register` no longer returns an
`AuthSession`. That reaches `@chatofy/types` (a new register-response schema),
`auth.controller.ts`, `auth.service.ts`, `test/utils/auth-fixture.ts` and every
db-e2e test that registers to obtain a token. The fixture needs a verified user
by another route — mark verified directly, or redeem the link the console sender
prints.

### Mail module

`MailModule` + `MAIL_SENDER` symbol + `MailSender` interface, matching the
`AUTH_ADAPTER` / `USER_REPOSITORY` house pattern. `SmtpMailSender` uses
nodemailer against `smtp.gmail.com:465` with a Gmail **app password** (requires
2FA on the account; ~500 recipients/day; `From` must be the Gmail address or
Gmail rewrites it). A console sender that prints the link stands in when SMTP is
unconfigured outside production — that is also the local dev flow, so nobody
needs a Gmail account to develop this.

`@nestjs-modules/mailer` is not worth its weight for plaintext mail.

New env, all **optional at boot and enforced lazily** — the `GEMINI_API_KEY` /
`GOOGLE_CLIENT_IDS` convention, not the `AUTH_JWT_SECRET` one:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, and
`WEB_BASE_URL` (needed to build the emailed link — nothing in the API knows the
web origin today; `CORS_ORIGIN` defaults to `*` and cannot serve).

Never in a mail: any password, any access token, user-supplied text in the
subject (header-injection hygiene — keep subjects constant). The token appears in
the link and is never logged.

**Boot-time warning**, not a boot failure: when `NODE_ENV=production` and SMTP is
unset, log loudly that verify and reset mail will silently fail. Lazy enforcement
otherwise means the routes answer 202 and every send dies in a log nobody reads.

### Mail abuse — per-recipient cooldown is part of the floor

Three routes now send mail to an arbitrary address (register-taken, resend,
forgot). **Per-IP throttling bounds none of it per recipient.** At the register
route's 5/60s, one IP sends 7,200 "you already have an account" mails a day to
any address the attacker names — and burns Gmail's ~500/day cap in under two
hours, after which every legitimate verify and reset mail silently dies and the
sending account risks a volume lock.

Counsel originally listed per-email limiting as a non-goal and **reversed that**
once uniform-202 register joined the mail-bearing routes. It has been moved out
of the non-goals list above:

- **Required.** A per-recipient cooldown in the mail dispatch path — in-memory
  `Map<email, lastSentAt>`, drop-and-log a repeat send inside ~10 minutes. The
  HTTP response stays 202 either way, so no oracle changes; the response never
  depended on the send. ~15 lines, and the single-instance assumption already
  holds.
- **Recommended.** A global daily send counter (~400/day, log-and-drop past it).
  The cooldown protects a named victim; only the counter protects the Gmail
  quota against an attacker rotating recipients.

### Repository seam

Added to the interface, the Prisma impl, **and** the in-memory double:
`findCredentialsById`, `updatePasswordHash(id, hash, changedAt)`,
`markEmailVerified(id, at)`. A dedicated method each, mirroring `linkGoogleSub`,
rather than widening `UpdateUserDto`, which must not become able to write secrets.

**The read path must be decided here, not improvised.** Those three are writes;
`verifyToken` also needs to _read_ `passwordChangedAt`, and `findById` returns a
`UserRecord`, which does not carry it. Either widen `UserRecord` with both new
timestamps — check `toUserContract` and `RECORD_SELECT` don't leak them into a
response; both list fields explicitly, so this looks safe — or add a narrow
`findAuthStateById`. Left unspecified, an implementer picks one inside the
least-reviewed file in the change.

The in-memory double gains the two columns' _semantics_, not just the three
methods — a double that cannot express "unverified" cannot prove the login block.

### Web pages

`/register` (form + the existing `GoogleButton` — `/auth/google` already
auto-creates accounts) → on 202 renders a "check your email" state, **no
auto-sign-in**. `/verify-email?token=` → posts, then `/login?verified=1`.
`/forgot-password` → uniform confirmation text. `/reset-password?token=` → new
password, then `/login?reset=1`.

Token-in-URL hygiene, in order of how real each is: the GET must consume nothing
(email scanners follow links — the token is spent only on the explicit POST);
`history.replaceState` strips the query on mount; `Referrer-Policy: no-referrer`
on both token pages.

**The unverified-login message is a named work item, and the first thing to
spike.** NextAuth's Credentials `authorize` renders every failure as one
indistinguishable "wrong password" when it returns null — so an unverified user
who typed the _correct_ password is told their password is wrong, and acceptance
criterion 3 passes at the API while the UX contradicts it. Surfacing "verify your
email — resend" means throwing a `CredentialsSignin` subclass carrying a `code`
and mapping that code in the form.

This is **the single highest risk in the whole contract**, and the only one this
repo does not decide: everything else follows from code we control and have read,
while this depends on a third-party beta's behaviour. It is the one place the
plan can be written correctly and still be wrong. Spike it first in the web
phase. If the `code` path won't carry the distinction on beta.32, the fallback —
the form pre-checking against the API before calling `signIn` — changes the
page's structure, and that is much better known before the phase is scheduled
than during it.

### Migration

Two nullable columns on `User` — `emailVerifiedAt`, `passwordChangedAt` — plus
the grandfathering `UPDATE`. Same shape as `20260822114500_add_auth_columns`.
Back up before applying.

**`prisma migrate dev` emits DDL only — it will never write the `UPDATE`.** The
backfill has to be hand-added to the generated SQL. Forgetting it violates the
deploy-order rule silently, and nothing surfaces the mistake until the first live
user is locked out.

## Acceptance criteria

1. `POST /auth/register` returns 202 with a byte-identical body for a fresh and
   an already-registered address; a mail is sent in both cases, differing in
   content only.
2. Registering, then following the emailed link, then signing in, works
   end-to-end with the console sender and no Gmail account.
3. Correct password on an unverified account → 403 naming verification. Wrong
   password on the same account → the existing generic 401.
4. A reset token is refused after use, after 30 minutes, and after a second
   reset. A reset token cannot be redeemed as an access token, nor an access
   token as a reset token — asserted for a null-`passwordHash` row specifically.
5. An access token issued **before** a completed reset is refused on `GET
/auth/me` **and** on the `/ws/translate` upgrade. A token minted in the same
   second as the timestamp write is **accepted** — the same-second regression
   has a test of its own.
6. Existing rows can still sign in after the migration without verifying, and a
   `preferredLanguage` update signs nobody out.
7. A deleted user's still-valid token is refused on both paths.
8. An unverified user typing the **correct** password sees "verify your email"
   with a working resend on the login form — not the generic wrong-password text.
9. A second mail to the same address inside the cooldown is dropped, and the
   route still answers 202.
10. Following an already-used verification link renders "link used or expired,
    sign in" rather than an error page.
11. `pnpm --filter @chatofy/api test` (with `jwt-auth.adapter.spec.ts` reworked —
    `verifyToken` now reads the database and its specs need the users double
    wired in), the db-e2e suite (fixture updated for the 202 contract), web
    tests, lint, typecheck, and build all pass.

## Unresolved questions

- **Does the reset endpoint refuse a Google-first row (null `passwordHash`)?**
  Traced: proceeding opens no takeover — `loginWithGoogle` short-circuits at
  `findByGoogleSub` for an already-linked row, so the anti-squatting rule at 2b
  is never reached, and mailbox control is the same proof Google's
  `emailVerified` already attested. Recommendation is to proceed and mention the
  Google option in the mail body only (branching the HTTP response would be an
  account-shape oracle). Confirm during planning.
- Residual accepted by every email-reset design: a recycled mailbox lets its new
  holder inherit the previous owner's sessions and transcripts — the same
  scenario `loginWithGoogle` comment 2d refuses for relinking.
- Whether `/verify-email` should sign the user in directly rather than bounce to
  `/login`. Bouncing is assumed — the page never held the password.
