# Authentication

Part of the [system architecture](../system-architecture.md).

## Authentication

The Nest API is the identity authority. It hashes passwords (argon2id), verifies
Google id_tokens against Google's JWKS, and signs the access JWT every client
carries. NextAuth v5 on `apps/web` is a session shell over those endpoints and
never touches the database.

The alternative — NextAuth as the IdP with Nest verifying its session token —
fails the multi-client requirement outright: `apps/mobile` and `apps/extension`
can never hold a NextAuth cookie, and v5 session tokens are JWE, so Nest would
have to reimplement Auth.js key derivation.

| Concern               | Owner                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Password hashing      | `PasswordHasher`, the only file that names argon2id, so a bcryptjs swap is one file                                       |
| Token issue/verify    | `JwtAuthAdapter`, bound to the pre-existing `AUTH_ADAPTER` seam                                                           |
| Google verification   | `GoogleTokenVerifier` via `google-auth-library`, audience as an allowlist                                                 |
| HTTP enforcement      | `JwtAuthGuard` as `APP_GUARD`, registered in `AuthModule`                                                                 |
| WebSocket enforcement | `verifyClient` on the `ws` server, installed in the gateway's `afterInit`                                                 |
| Token revocation      | `JwtAuthAdapter.verifyToken` — one indexed read per request and per upgrade                                               |
| Socket termination    | `SessionTerminator`; `TranslateGateway` registers itself and closes the sockets                                           |
| Refresh rotation      | `RefreshTokenStore` — the only class that talks to Redis; one Lua script rotates, detects reuse, and re-issues atomically |
| Session renewal       | `SessionRefreshService` — `POST /auth/refresh`, and the gate that stops a refresh token resurrecting a reset session      |
| Purpose tokens        | `PurposeTokenService` — verification and reset links, keyed off `AUTH_JWT_SECRET`                                         |
| Mail delivery         | `MAIL_SENDER` (`MailModule`) — SMTP, console or no-op, always wrapped by the guard                                        |
| Web session           | `apps/web/auth.ts` — jwt strategy, no adapter; renews inside the `jwt` callback and publishes one `session.error` signal  |
| Session liveness      | `apps/web/src/lib/session-guard.ts` — one `isLiveSession` predicate, read at all five session-gating sites                |

### Tokens

**A fifteen-minute access token (HS256) plus a rotating refresh token held in
Redis.** Both are returned by every route that mints a session, and `expiresAt`
dates the access half.

The refresh token is opaque — 256 bits of `randomBytes`, base64url — and carries
no subject, no `iat` and no expiry a client can read. **Only its SHA-256 is ever
stored**, on every path including the grace window below; there is no moment at
which Redis holds a usable credential. SHA-256 rather than argon2 deliberately:
slow hashing prices up guessing a small search space, and against 256 bits of
machine entropy there is no search space to price up.

#### The key model

| Key                  | Holds                                                                                         | TTL                         |
| -------------------- | --------------------------------------------------------------------------------------------- | --------------------------- |
| `rt:<sha256(token)>` | its `familyId`, `status`, `spentAt`, `replacedBy`, and its lineage counters `gen` and `epoch` | the family's remaining life |
| `rtfam:<familyId>`   | `userId`, `issuedAt`, `revoked`, `famExpiresAt`, `lastUsedGen`, `epoch`                       | 30 days absolute            |

One refresh number, not two: the family cap is 30 days absolute, and the web
session cookie is set to the same 30 days so the two cannot disagree about when
a session is over.

Rotation is one-time-use and happens in a single Lua script, so validating,
invalidating and re-issuing cannot interleave. A spent record keeps its own TTL
— shortening it would blind detection, because an expired record answers
"not found", which is not the same answer as "reuse".

#### The grace window, and why the clock is not the theft signal

A token marked spent less than **ten seconds** ago is still honoured: the script
issues _another_ fresh token in the same family. This is a **simultaneity**
bound, not a tuning knob. `getSession()` is not deduped and runs per request, so
one screen can fire several renewals at once; without the window all but one
would 401, and the last cookie write might be the errored one — a mass logout on
every refresh. Re-issuing rather than handing back an identical successor is what
keeps the no-plaintext-at-rest property: returning the _same_ replacement would
require storing that replacement raw.

**No timeout could be the theft detector.** A renewal has two lossy legs, and the
second is unbounded: if the browser never receives the response, the `Set-Cookie`
is lost and nothing says when that spent token is next presented — seconds if the
user is active, hours if the laptop lid was closed. So detection is by
**lineage**, and the two lineage failures answer **differently**:

| Signal                                                                    | Verdict    | What happens                                                                            |
| ------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `gen < lastUsedGen` — presented after a LATER generation was already used | `reuse`    | 401, family revoked, that user's live sockets closed, logged as theft                   |
| `epoch < fam.epoch` — an orphan of a token that was forgiven              | `orphaned` | 401 for that token only. **Family survives, no sockets close, nothing logged as theft** |

A spent token whose lineage never advanced is **forgiven once**, logged as
`recovered` rather than as theft, and the epoch bump that forgives it orphans
whatever succeeded it — so the same token is never forgiven twice.

**Why the two are not one verdict.** The server cannot tell a lost successor from
a held one: "the browser is holding n1" and "n1 was lost in transit" are the same
Redis state. When both signals meant theft, an ordinary duplicate refresh arriving
more than the grace window late — a slow mobile leg, a suspended tab, a retried
request — revoked the family and dropped that user's meeting on every device about
fourteen minutes later, reported as a theft that never happened. Only the `gen`
check is supported by the timescale argument above; the epoch check is not, so it
now costs one re-login on one browser instead.

What that gives up, stated plainly: a thief who forces a forgiveness no longer
triggers a family-wide revocation. Their orphaned token is refused, the victim is
bounced to a fresh sign-in, and the thief's own leaf survives in the old family
until it expires. The trade was taken deliberately — a false global logout is a
certainty at scale, and this attack needs the token already stolen.

Detection latency and damage are bounded by one access-token lifetime, the same
as classic one-time rotation. What is given up is that a thief presenting a token
_after_ the victim has already rotated gets one 15-minute access token instead of
zero.

**Stated because it is a real cost:** `SessionTerminator.terminate()` closes every
connection that user holds on **all** devices, not just the compromised family —
there is no family-to-socket mapping to scope it with. So one unauthenticated
call reaching the `reuse` branch drops that user's meeting everywhere.

The exposure is narrower than it was. That branch is now reachable only by a
**generation regression** — a token presented after a later generation was already
used — so a merely orphaned or stale token cannot trigger it. What it still means:
anyone holding a genuinely superseded refresh token can, once per family, end that
user's live calls on every device. Accepted deliberately: leaving a thief
streaming the victim's audio through a revocation is worse, and holding such a
token already implies profile or physical access.

#### Fail-closed on Redis, but nobody is signed out

`POST /auth/refresh` answers **503, never 401**, when the token store is
unreachable — the same distinction `JwtAuthAdapter.verifyToken` already makes
between a null row and a thrown read, and for the same reason: every client reads
a 401 as proof the session is dead.

| Redis state                    | What the user sees                                                   |
| ------------------------------ | -------------------------------------------------------------------- |
| Down, access token still fresh | Nothing. Up to fifteen minutes of normal use.                        |
| Down, access token expired     | Requests fail with the screen's own error state. **Not signed out.** |
| Down, tries to sign in         | Login fails with a server error. New sign-ins unavailable.           |
| Recovers                       | The next renewal succeeds; the app self-heals with no user action.   |

**A reachable-but-EMPTY Redis is the dangerous third state**, and it is neither
"up" nor "down": every token reads as not-found, which is a clean 401, which is a
silent total logout. A container recreated against a fresh volume, a restored
snapshot, an AOF rewrite failure, or an eviction all produce it. The named prod
volume and the `maxmemory` ceiling paired with `maxmemory-policy noeviction` are
load-bearing, not tidiness — the policy alone is Redis's own default and bounds
nothing. See the [deployment guide](../deployment-guide.md#redis-and-the-one-volume-you-must-not-lose).

#### The one setting a row carries

`User.locale` — the language this account's **mail** is written in, and nothing else.
Which language the web UI renders in lives in a cookie and needs no row; this column
exists because mail is composed when no browser is present to ask.

Two of the four mail purposes read it off a row already in hand (`AccountExistsNotice`,
`PasswordReset`). `VerifyEmail` has no row yet, so it takes the requesting locale and
the verification link carries it into the row it creates. `NoAccountNotice` cannot and
must not read a row: it is sent precisely because no row matched, so it takes the
REQUESTING locale unconditionally. Resolving it by looking anything up would give a real
address the stored preference and an unknown one a default — a difference the recipient
can see, and therefore the account-enumeration signal that `POST /auth/forgot-password`'s
uniform answer exists to remove. `apps/api/src/modules/auth/mail-language.spec.ts` asserts
both halves: no second read on that path, and the same awaited work on both branches.

The switcher writes the cookie and, when there is a session, the column — one control,
one choice. A separable "mail language" was considered and rejected: two language
settings to reconcile is a worse product than one on a tool with a single language pair.

#### What revocation exists

`JwtAuthAdapter.verifyToken` reads two columns — the row's id and its
`passwordChangedAt` — on **every authenticated request and every socket
upgrade**, and refuses the token if either says it should no longer work:

- **A deleted user's token stops working.** The row is gone, so there is nothing
  to authenticate as. Previously only `GET /auth/me` noticed.
- **A completed password reset invalidates every token issued before it.** The
  reset stamps `passwordChangedAt` from the app clock, ceiled to the next whole
  second, and any token whose `iat` is a strictly earlier second is refused.
  Ceiling rather than truncating is what stops a token minted inside the reset's
  own second from surviving its full lifetime. The comparison is
  `floor(issuedAt) < ceil(changedAt)`, lifted into
  `password-change-revocation.ts` and read by BOTH callers — two copies of it
  drifting apart is a silent revocation hole.
- **A refresh family issued before the reset cannot mint a new access token.** A
  refresh token is opaque and carries no `iat`, so the check above cannot see it;
  without a second gate it would mint a token with a _fresh_ `iat`, later than
  `passwordChangedAt`, and silently resurrect the session the reset existed to
  kill — with every existing test still green. `SessionRefreshService` compares
  the family's own `issuedAt` through the same predicate and revokes the family
  on refusal. The reset path itself performs **no Redis write at all**, so a
  Redis outage cannot leave a reset half-applied.
- **Open sockets are closed.** Revocation at the upgrade does not reach a
  connection that is already established, and no frame re-authenticates — so the
  reset also asks `SessionTerminator` to close that user's live sockets, with
  close code 1008. Without it, a stolen token keeps streaming the victim's audio
  and transcripts straight through the reset performed to stop it.

Because the check reads the database, it distinguishes two failures that look
alike: a **null row** is a 401, a **thrown read** propagates as a 5xx. Collapsing
both into 401 would turn a thirty-second database blip into a forced sign-out of
every active user — `use-auth-recovery.ts` reads a 401 from `GET /auth/me` as
proof the session is gone — who then could not sign back in, because login needs
the same database.

#### What it still does not cover

**There is no logout-everywhere.** One sign-out revokes **this browser's** refresh
family server-side — web and extension both call `POST /auth/revoke` on the way
out, so the credential is dead when you leave rather than sitting renewable for
the remainder of its thirty days. That is a real change and it is also the whole
of it: other devices hold their own families and are untouched, and the access
token already issued runs out its remaining ≤15 minutes. Rotating
`AUTH_JWT_SECRET` remains the only way to invalidate everything at once.
Enumerating a user's sessions would need a `rtu:<userId>` index, which does not
exist and is not needed for anything else.

**Do not read password-reset revocation as lazy, or as having a fifteen-minute
window.** It does not. `JwtAuthAdapter.verifyToken` checks `iat` against
`passwordChangedAt` on every authenticated request and every socket upgrade, so
every access token issued before a reset dies instantly, exactly as before; the
refresh family dies at its next refresh, which is the first moment it is used for
anything; and live sockets are cut immediately by `SessionTerminator`. There is
no window of continued access.

**The XSS story, both halves or neither.** The refresh token stays inside the
httpOnly JWE session cookie and is never copied into `session` — client JS cannot
read it. What an XSS _can_ read is `session.accessToken`, now valid ≤15 minutes
rather than up to seven days.

That helps against exfiltrate-once-and-leave, and **only** against that. A
_persistent_ XSS — and `apps/web/next.config.ts` concedes `script-src` still
carries `'unsafe-inline'` — calls `/api/auth/session` from the victim's browser
whenever it likes; the httpOnly cookie rides along automatically, the renewal
happens server-side, and a fresh access token is minted on demand, indefinitely.
And the ceiling went **up**: the session cookie moved from seven days to thirty
and it slides on every read, so the attacker's proxy window is now thirty days
from last use rather than seven days from issue. Stating only the shrinkage would
be overclaiming. The CSP remains the compensating control, with the limits stated
there.

### Why the guard is registered in `AuthModule`

`CommonModule` holds the rest of the cross-cutting pipeline, but it has no
`imports` and `AuthModule` is not `@Global`, so a guard registered there could
never resolve `AUTH_ADAPTER`. Registering it beside the token it depends on
avoids widening auth's DI surface by making the module global.

`@Public()` is read from the **handler only**, never the controller. A
class-level exemption would be invisible at the route it exempts — putting one on
`AuthController` ships `GET /auth/me` unauthenticated with nothing in that file
saying so.

### WebSocket auth: refused at the upgrade

`/ws/translate` authenticates during the HTTP upgrade, not after it.

Nest's `web-sockets-controller` emits the connection event synchronously and
binds every `@SubscribeMessage` handler on the next line, discarding whatever
`handleConnection` returns. An `async` check there would leave handlers bound and
dispatching while verification was still in flight, and a _rejected_ verification
would be an unhandled rejection — which Node 24 turns into a process exit. So an
unauthenticated request could both execute frames and kill the API.

`ws` calls `verifyClient` inside `handleUpgrade` and aborts with HTTP 401 before
`completeUpgrade` constructs a WebSocket. No socket exists, no handler is bound,
and there is no window to gate. It is installed in `afterInit` rather than passed
through `@WebSocketGateway`'s options because decorator arguments are evaluated
at class-definition time, before a DI container exists to resolve the verifier
from; `ws` re-reads `options.verifyClient` on every upgrade, so assigning it
afterwards takes effect.

The token travels in `Sec-WebSocket-Protocol`, offered as
`[WS_SUBPROTOCOL, token]` — a URL-borne credential would land in server and proxy
access logs and in browser connection history. Browsers cannot set
`Authorization` on a WebSocket but can offer subprotocols, and node's `ws` takes
the identical two-argument form, so every client authenticates the same way. The
server **must** select `chatofy-v1` and must never echo the token: a handshake
that selects none of the offered subprotocols succeeds and is then closed
instantly by the browser.

A client cannot read the refusal's status — an aborted upgrade surfaces as a bare
error — so on any connection failure it probes `GET /auth/me`. A 401 from that
probe now **starts** recovery rather than concluding it: the shared path attempts
a renewal and signs out only if that renewal is terminally refused.

**Shortening the access token changed nothing about a LIVE socket.** No frame
re-authenticates and a socket has no maximum lifetime, so one already open stays
open until it closes for its own reasons; cutting a live socket is still
`SessionTerminator`'s job alone. What changed is the **reconnect**, which must
present a live token at the upgrade. Two things carry that: the session provider
polls every five minutes (`refetchInterval` must fit inside the renewal skew; see
`apps/web/src/components/session-provider.tsx`), and the recovery path refreshes through
`useSession().update()` rather than `getSession()`. That distinction is
load-bearing — `getSession()` does not update the provider's React state, and the
socket reconnects from exactly that state, so refreshing the other way would
succeed while the socket redialled with the same dead token and looped until the
next poll.

### Google account linking

Ordered, and hardened in both directions:

1. Known `googleSub` → sign in. The column is unique and never reassigned.
2. Otherwise look up by email:
   - row has a `passwordHash` → **refuse** (409). Never auto-link.
   - `email_verified !== true` → refuse (401).
   - passwordless and verified → attach `googleSub` and sign in.
3. No row → refuse when `email_verified !== true` (401), otherwise create a
   passwordless account.

Step 2's first branch is now belt **and** braces, and worth keeping as both.
Registration proves mailbox control — a row exists only once its verification
link has been redeemed — so nobody can create an account for
`victim@company.com` without holding that mailbox, and the squatting scenario
this branch defends against can no longer be set up through the product.

The rule stays because it costs nothing and it is the last thing standing
between a mailbox that was compromised some other way and a silent takeover.
Were it removed, a naive "verified email, so link" would sign the real owner into
the other row, whose password is still there, leaving its holder read access to
the victim's sessions and the full text of their translated meetings — until the
victim reset their password, which now does end it.

### Registration proves mailbox control

`POST /auth/register` **creates no account.** It hashes the password, packs it
with the address and name into a signed 24-hour token, and mails that as
a link; redeeming the link is what inserts the row. Every password account is
therefore mailbox-proven by construction, and no unverified row ever exists.

The route answers **202 with one body for every address** — fresh or already
registered — and hashes _before_ the existence check so the two branches cost the
same. Both properties are load-bearing:

- The obvious alternative — create an unverified row, refuse its login with a
  distinct 403 — reopens the account-existence oracle in two unauthenticated
  requests. Register `victim@corp.com` with a password you choose (same answer
  either way), then log in with it: a **403** means the address was free and your
  row now exists, a **401** means it was taken. The row's existence is the leak,
  so no wording closes it. Creating nothing does.
- Because no unverified rows exist, **login gained no new branch and keeps its
  single generic 401.**

Single use falls out of the unique index rather than a token table: a second
redemption loses the insert and is answered with the plain fact that the account
exists, which is also the honest answer to a double-clicked link or a mail
scanner that followed it.

Password reset uses the same machinery with a different key derivation —
`AUTH_JWT_SECRET` plus a purpose infix plus the row's **current** password hash,
so completing a reset changes the key and kills every outstanding link at once.
The purpose infix is not decoration: without it, a row with a null `passwordHash`
would derive the bare `AUTH_JWT_SECRET`, and a stolen access token would verify
as a reset token.

### Mail cannot be aimed at a mailbox, or at the product

Two unauthenticated routes — `POST /auth/register` and `POST /auth/forgot-password` —
send mail to an address the caller names (there is no resend route: submitting the
form again is the resend), and
per-IP throttling bounds none of it _per recipient_. Two controls sit inside the
sender bound to `MAIL_SENDER`, so there is no unguarded seam to inject instead:

- a **per-recipient, per-purpose cooldown**, recorded on a successful send rather than on
  dispatch, so a send killed mid-flight does not burn the user's window;
- a **tiered rolling-24h budget**. The reserved tier carries only mail that can
  be sent to a row that already exists — password reset — because that is the
  only traffic a ceiling can tell apart from an attack. Registration mail draws
  on the attacker-facing tier alongside the already-registered notice: its
  address was invented by the caller, and putting it in the reserved tier would
  let someone registering rotating addresses drain the allowance account
  recovery depends on.

No user-supplied text reaches any mail body, subject or header — bodies are
constants plus the link, and the dispatch type has no field for anything else.

### Test substrate

Two, split by what each proves. Most suites override `USER_REPOSITORY` with an
in-memory implementation: the real controller, service, argon2 and JWT issuance
all run, only the user store is faked. They still need Redis, because login mints
a refresh family. The Postgres-backed suites (`*.db-e2e-spec.ts`, their own jest
config and CI job, with Postgres and Redis service containers) cover what a Map
cannot — for auth, the `googleSub` unique constraint, real `findUnique` semantics
and the linking policy end to end (`auth.db-e2e-spec.ts`), and real Lua, TTLs and
atomicity for rotation (`refresh-token-rotation.db-e2e-spec.ts`).

Test code mints tokens exactly one way, through the real endpoints
(`test/utils/auth-fixture.ts`). The single exception is the expired-token case,
which signs through the app's own `JwtService` so it cannot drift from the secret
the app verifies against.

### Avatar storage

Avatar bytes live in a **Cloudflare R2** bucket, served to the browser from a
public custom domain. Nothing touches the API's filesystem — the prod `api`
service has no volume — and no image decoder runs server-side: the browser
resizes to 128px WebP before uploading, and Google's picture is requested at
`=s256-c`, already the size we want.

Three decisions are worth stating because each one is easy to undo by accident.

**The column stores a KEY, not a URL.** `User.avatarKey` holds
`avatars/{userId}/{random16}-{hash16}.{ext}`; `toUserContract` composes
`avatarUrl` from it and the configured public base at the response boundary.
Moving the bucket behind a different domain is therefore an environment change
rather than an `UPDATE` over every row. The content hash makes replacement
cache-safe (new bytes are a new URL); the random half is what makes the key
unguessable, since a Google-imported avatar's bytes are a public artifact whose
hash anyone could recompute. Nothing in the design _leans_ on unguessability —
the bucket is public-read by product intent.

**`User.avatarChangedAt` exists because `avatarKey` cannot answer the question
the Google import has to ask.** A null key means both "never had an avatar" and
"the account holder removed one", and importing Google's picture is right in the
first case and wrong in the second — a Google user who removes their photo would
get it back on the next sign-in, with no way to have none. The timestamp splits
those two states: null means nothing has ever touched this row's avatar. Every
write path stamps it (upload, removal, import), so the import happens at most
once in a row's life and never over a deliberate choice. It is deliberately not
`@updatedAt`, for the reason `passwordChangedAt` gives in the same model: that
flips on any write, so renaming an account would re-open the import.

**The type comes from the bytes, never from what the client declares.** These are
user-supplied bytes served from an origin the browser treats as ours, so the
stored `Content-Type` is pinned from a magic-byte sniff (WebP, PNG, JPEG only).
The upload contract carries raw base64 rather than a data URL for the same
reason: a data-URL prefix declares a type the API is not allowed to trust.

The Google importer refuses redirects (`redirect: 'manual'`) and parses the
picture URL with `new URL` against a host allowlist rather than string-matching
it. Both matter: `fetch` follows up to 20 redirects by default, this process can
reach the local speech sidecars and the compose network, and the fetched bytes
land in a _public_ bucket — so a followed redirect would be a read-SSRF
exfiltration primitive for anything whose first bytes sniff as an image.

#### Bucket layout, and the one rule that governs it

The bucket is meant to be shared by the whole project, not owned by avatars.
`R2_BUCKET` is a project-wide variable and keys are namespaced by feature:

```
avatars/{userId}/{random16}-{hash16}.{ext}
conversations/{ownerId}/{random16}.{ext}
```

A feature adds its own top-level prefix rather than its own bucket, so one origin
and one credential pair serve everything.

**A prefix is a namespace, never an access boundary.** Two properties of R2 make
that non-negotiable rather than stylistic:

- **Public access is bucket-level.** Connecting a custom domain or the r2.dev
  subdomain publishes the _whole_ bucket. There is no setting that makes
  `avatars/` public while a sibling prefix stays private.
- **API tokens scope to a bucket, not a prefix.** A token that can write
  `avatars/` can read and write every other prefix beside it, so a leaked
  credential's blast radius is the bucket.

So the bucket boundary is the **access-policy** boundary. The bucket described
here is public-read by product intent, and everything that goes in it is
world-readable by URL to anyone who has that URL.

Conversation recordings live here anyway, and knowingly. Their design contract
required a second, non-public bucket; the owner chose this shared public-read
bucket instead, as an accepted risk, so recordings
live under `conversations/` and lean on 64 bits of key entropy plus an
owner-scoped playback route instead of an access boundary. The landing copy was
amended in the same release. The decision and its consequences are in
[Conversation recordings](./ai-providers.md#conversation-recordings-and-the-access-boundary-they-do-not-have);
anything else that must not be world-readable still needs a second bucket.

The bucket is `chatofy`, and **development and production share it**. That was
chosen deliberately over a bucket per environment, and it has a cost worth
stating rather than discovering: the credentials in a developer's
`apps/api/.env` can write and delete production avatars and recordings, and the removal path is
authoritative, so a bug exercised locally acts on real objects. Nothing in the
code knows which environment it is talking to. The mitigation that costs nothing
is a separate R2 token per environment, both scoped to this one bucket, so a
leaked one can be revoked without rotating the other. Because the bucket name
does not carry the word "public", that property has to be remembered — which is
what this section is for.

Removal is authoritative: the object is deleted first and the columns are cleared
only after that succeeds, so a failure is a retryable 409 rather than a 200 over
a photograph that is still published. That is true of the ORIGIN; the edge keeps
serving a deleted object for a few hours longer, and the measured window is in
the [deployment guide](../deployment-guide.md#removal-and-the-one-hour-cache-window)
along with the bucket and origin-variable detail.
