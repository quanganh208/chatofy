# Audit — auth / users module (deep read)

Date: 2026-08-24 · Branch `main` · Scope: `modules/auth`, `modules/users`, `modules/mail`,
`common/guards` · Landed in PR #87 · Mode: read-only, nothing changed

Follow-up to `audit-260823-2353-oop-clean-code-redundancy.md`, which covered these files
structurally only.

## Verdict

**No vulnerabilities found.** This is the strongest part of the codebase — several defences
here are ones most production auth implementations miss. One genuine finding, and it is a
**deployment constraint, not a bug**: every rate limit and mail budget is in-process state.

Read 4,612 LOC across auth/users/mail. Every security claim in the comments was verified
against the code rather than taken on trust.

## Architecture — auth split by flow

PR #87 split one `AuthService` into three flow services sharing three collaborators:

```
AuthService          (sign in, Google link)   ─┐
RegistrationService  (register, verify)       ─┼─ PasswordHasher · AuthMailer · PurposeTokenService
PasswordResetService (forgot, reset)          ─┘   + normalizeEmail, SessionTerminator
```

Correct split: the three flows share _collaborators_, not logic. `PasswordResetService` is the
only one that **revokes** — isolating it makes "what does a reset invalidate?" answerable from
one file.

## What was verified (not just read)

### Token design — `purpose-token.ts`

| Property                         | Verified                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose-bound signing keys       | `secret:register:` vs `secret:pwreset:<hash>` — a register token cannot verify as a reset token even before the `purpose` claim check                                             |
| Password hash sealed in transit  | AES-256-GCM, fresh nonce per token, auth tag alongside → tampering fails to open rather than decrypting to something else                                                         |
| Key separation                   | `hkdfSync` with `info='chatofy:register-payload:v1'` → seal key independent of signing keys; rotating `AUTH_JWT_SECRET` rotates both                                              |
| Single-use reset, no token table | Reset key folds in the row's **current** password hash → completing a reset derives a different key, so every outstanding link dies. Elegant; no revocation table to keep in step |
| No oracle                        | Expiry / bad signature / malformed / failed seal all collapse to one `BAD_TOKEN`                                                                                                  |
| No mass-assignment               | Payload built field-by-field, never `{...pending}` — spreading would put the raw hash beside the sealed one                                                                       |
| TTLs                             | register 24h, reset 30min — reset is shorter because it grants sign-in; correct ordering                                                                                          |

`unverifiedSubject()` uses `jwt.decode` (unverified) to find which row's hash completes the
key. Chicken-and-egg is unavoidable and correctly handled: the decoded `sub` selects a row and
nothing else; the authoritative subject comes from the verified payload. **I checked the
injection angle** — `User.id` is `cuid()` (String, not UUID), so an arbitrary attacker string
returns `null` rather than throwing a 500.

### Enumeration defences — the strongest part

- **Deferred registration.** `POST /auth/register` creates **no row**; the hashed password
  rides in the token and redeeming the link creates the account. This kills the existence
  oracle at the root — the usual "create row + block login with 403" design leaks existence in
  two unauthenticated requests (register, then login with your own password: 403 = address was
  free, 401 = taken). Consequence: no unverified rows exist by construction.
- **Timing equalized on every path.** Login always runs an argon2 verify — against
  `PasswordHasher.dummy()` when the email is unknown _and_ when the row is Google-first with a
  null hash. Registration hashes **before** the existence check for the same reason. The dummy
  is computed once per process with its rejection pre-handled (an unhandled rejection would
  kill the process under Node 24).
- **Uniform responses** on register (202) and forgot-password (202), with detached sends so
  response time doesn't branch either.

### Revocation — verified end to end

`passwordChangedAt` is stamped **ceiled to the next whole second**, and
`jwt-auth.adapter.ts` compares with strict `<`. Both halves are load-bearing: `iat` has
one-second resolution, so truncating down would leave every token minted during the reset's own
second valid for its full 7 days. Also caught: a non-numeric `iat` is refused explicitly,
because `Math.floor(undefined) < x` is `false` and would have **passed** the check.

The DB read sits **outside** the catch that collapses crypto failures into 401 — so a brief
Postgres outage returns 5xx, not 401. Correct: web's `use-auth-recovery.ts` treats 401 from
`/auth/me` as proof the session is gone and calls `signOut()`, so collapsing a DB blip into 401
would force-sign-out every user across all three clients.

`SessionTerminator` closes live WebSockets on reset via an inverted dependency (transports
register themselves; auth never names the gateway). Necessary — the guard returns `true` for
non-HTTP contexts and no frame re-authenticates, so without it a stolen token keeps streaming
the victim's audio through the reset performed to stop it.

### Google linking — hardened both directions

Verified `verifyIdToken` with an **audience list** (sig + iss + exp + aud via Google's JWKS),
and `email_verified === true` strict-compared. Policy refuses: linking to a row that has a
password (squatting), linking an unverified address, and — the case most implementations
miss — an address already linked to a **different** `sub` (recycled Workspace address, where
overwriting would hand the new holder the previous person's transcripts).
`linkGoogleSub` uses `updateMany({where:{id, googleSub:null}})` — check and write in one
statement, so it is not racy.

### Guard coverage — fail-closed

`JwtAuthGuard` is registered as a global `APP_GUARD`, so routes are protected by default and
`@Public()` is an explicit opt-out. It reads `@Public()` from the **handler only**, not
`getAllAndOverride` across the class — deliberately, since a class-level mark would silently
exempt routes that never asked, which is exactly how `GET /auth/me` would ship open.

Every auth route carries `@Throttle`: forgot-password 3/min (hardest — the one route that mails
a sign-in-granting link), register 5/min, the rest 10/min.

### Input bounds — `packages/types/src/http/auth.ts`

Password max 128 is a **cost ceiling, not a strength rule** — it bounds argon2 CPU per request
(DoS defence). Login uses `z.string().min(1).max(128)`, deliberately **not** `passwordSchema`:
applying the 8-char minimum at login would tell a caller "no account has a password this short"
and would lock out anyone whose password predates a policy change. Subtle and correct.

### Mail guard — `guarded-mail.sender.ts`

Header-injection floor (rejects CR/LF in `to`, rejects rather than strips). Budget tiered into
`AttackerTriggerable` 300/day vs `Reserved` 150/day, so address-rotation at register's 5/60s
cannot starve the allowance password resets draw from. Cooldown keyed on **purpose + email**,
not email alone — keyed on address only, an attacker could trigger the "account exists" notice
at a victim's address to start a 10-minute window that swallows the victim's own reset mail.
Recipients masked in logs. Recorded on successful send only.

## Finding — in-process state is a deployment constraint

The only real finding. All three of these are per-process memory with no distributed backing
(verified: no Redis/ioredis dependency, no `ThrottlerStorage` override anywhere):

| State                      | Where                                                | Effect at N replicas                                                                                   |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Auth rate limits           | `ThrottlerModule.forRoot`, default in-memory storage | Every `@Throttle` limit becomes N× (forgot-password 3/min → 3N/min)                                    |
| Mail cooldown + 24h budget | `GuardedMailSender` private `Map`/arrays             | Ceilings become N×; cooldown stops suppressing duplicates across replicas                              |
| Sessions                   | `MemorySessionStore`                                 | **Already acknowledged** behind the `SESSION_STORE` seam ("Swap to RedisSessionStore… for production") |

Not a bug today — the app runs single-instance, and it is correct to not build Redis before it
is needed. But the security _reasoning_ in those comments is quantitative and assumes one
process (e.g. "7,200/day from one IP exhausts it in about eighty minutes"). Both numbers change
under horizontal scaling, and a restart resets both silently.

The session store already documents this constraint at its seam; throttling and mail budget do
not. **Recommendation:** one comment at each of the two sites naming the single-instance
assumption — matching what `sessions.module.ts` already does. No code change.

## Minor observations (not defects)

1. **No `helmet`.** CORS is configured (`main.ts:68`); `TRUST_PROXY` is handled with explicit
   reasoning about per-IP buckets collapsing behind a proxy. For a JSON-only API that renders no
   HTML the gap is small, but `helmet()` is one line and covers `X-Content-Type-Options`,
   `Referrer-Policy` and HSTS.
2. **Reset token travels as `?token=`** in the web URL — standard for mail links, and mitigated
   by the 30-min TTL and hash-bound single use, but it does land in browser history and any web
   access log. Worth knowing; no action implied.
3. **Silent mail drops on budget exhaustion** — user still gets 202, error is logged. Correct
   for uniformity, but means "resets stop working" is visible only in logs. Worth an alert if
   this ever goes multi-user.

## Answering the original OOP/clean-code question for this module

Best OOP in the repo. Every collaborator is injected behind an interface + Symbol token
(`USER_REPOSITORY`, `AUTH_ADAPTER`, `MAIL_SENDER`); argon2 is named in exactly one file
(`PasswordHasher`) so swapping it stays a one-file change; `SessionTerminator` inverts the
dependency so auth cannot name the gateway. No file exceeds 314 LOC. 6 spec files plus
`auth.db-e2e-spec.ts` (784 LOC) and `ws-auth.e2e-spec.ts` (315 LOC).

Nothing from the earlier hygiene list changes: the two `purpose-token.ts` constants remain the
only auth-module item, and it stays a judgment call.

## Unresolved questions

1. Is the API ever intended to run with more than one replica? If yes, the throttler and mail
   budget need shared storage before that happens — if no, a comment at each site is enough.
2. Add `helmet()`? One line, low value for a JSON API — your call whether it is worth the
   dependency.
3. Still open from the previous audit: were `REGISTER_PURPOSE` / `PASSWORD_RESET_PURPOSE`
   exported intentionally as public vocabulary?
