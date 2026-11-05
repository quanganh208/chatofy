# Environment variables

Every env key in Chatofy: where it lives, which process reads it, and the
reasoning that does not fit in a template comment. The templates themselves
(`.env.example`, `prod.env.example`) stay short and link here.

## Where env lives

| Environment | File                                                                                    | Read by                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Development | `.env` at the repo root (template `.env.example`)                                       | Docker Compose, the api, the web, prisma, benchmarks, `apps/api/scripts/create-bench-user.cjs`, VS Code's api launch config |
| Production  | `~/.config/chatofy/prod.env`, chmod 600, outside the repo (template `prod.env.example`) | `docker-compose.prod.yml` via `--env-file`; deploy checks its key set with `scripts/check-prod-env.mjs`                     |
| Mobile      | `apps/mobile/.env`                                                                      | Expo, which reads only its own directory                                                                                    |
| Extension   | `apps/extension/.env`                                                                   | WXT, which reads only its own directory                                                                                     |

A variable already set in the real environment always wins over the file, in
every loader. How each dev reader finds the root file:

- api: `ConfigModule.forRoot({ envFilePath })` in `apps/api/src/config/app-config.module.ts`, resolved from the module's own directory, so `src/` and `dist/` agree and the cwd does not matter. Absent in the images, where the module skips the missing file.
- prisma: `apps/api/prisma.config.ts` calls dotenv with the root path.
- web: `apps/web/load-root-env.ts`, imported first by `next.config.ts`. Next has already loaded `apps/web` and caches that result, so the loader passes `forceReload`.
- benchmarks: each key helper reads the environment first, then the root `.env` (`readApiKey` in `benchmarks/translation-providers.mjs`).

**Never create `apps/api/.env` or `apps/web/.env*`.** Nothing reads the first.
The second is worse: Next watches `apps/web/.env*`, and a change there reloads
env from that directory and drops every root key until the next restart.

A git worktree needs its own root `.env`: copy the main checkout's. If its stack
runs at the same time, give it different host ports (see Compose below).

## Line forms

Both templates use two line forms, and the specs check them:

- `KEY=` or `KEY=value` — a live line. Blank means unset: the api schema reads
  an empty value as absent, so the feature behind it stays off.
- `# KEY=value` — the default already applied elsewhere (the zod schema, or
  `${KEY:-value}` in a compose file), shown for reference. Uncomment it only to
  override. A copied default is a second place to keep in step, and the api
  schema and its template drifted apart once already.

`apps/api/src/config/env.schema.spec.ts` checks the root template against the
api schema, the web keys, the tooling keys and the Compose defaults: every key
the schema reads is documented, nothing documented goes unread, and each
commented default still equals the real one. It does the same for
`prod.env.example`. `apps/web/src/config/env-example.spec.ts` checks the web's
own keys. `ConfigService.get()` returns `''` for a blank `KEY=` line, so code
falls back with `||` or an empty check, never `??`.

## All keys

D = dev root `.env`, P = prod.env. "Pinned" means compose sets it per service;
`environment:` outranks the env file, so setting it there does nothing.

| Key                                                                                | Read by                                 | Required                                | Default                          | D                | P              |
| ---------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------- | -------------------------------- | ---------------- | -------------- |
| `DATABASE_URL`                                                                     | api, prisma, bench-user script          | yes                                     | —                                | ✓                | pinned         |
| `AUTH_JWT_SECRET`                                                                  | api                                     | yes (≥32 chars)                         | —                                | ✓                | ✓              |
| `CLOUDFLARE_REALTIME_APP_ID`, `_SECRET`                                            | api                                     | yes (boot refuses)                      | —                                | ✓                | ✓              |
| `CLOUDFLARE_TURN_KEY_ID`, `_API_TOKEN`                                             | api                                     | no; TURN on when both set               | —                                | ✓                | ✓              |
| `WEB_BASE_URL`                                                                     | api, web, compose (`AUTH_URL`)          | prod yes                                | `http://localhost:3001`          | default          | ✓              |
| `MOBILE_LINK_SCHEME`                                                               | api                                     | no                                      | `chatofy`                        | default          | —              |
| `CORS_ORIGIN`                                                                      | api                                     | no                                      | `WEB_BASE_URL`                   | —                | —              |
| `TRUST_PROXY_HOPS`                                                                 | api                                     | prod yes                                | `0`                              | default          | pinned `1`     |
| `REDIS_URL`                                                                        | api                                     | no                                      | `redis://localhost:6379`         | default          | pinned         |
| `AI_TRANSLATION_PROVIDER`                                                          | api                                     | no                                      | `commandcode`                    | default          | default        |
| `COMMAND_CODE_API_KEY`                                                             | api                                     | for `commandcode`                       | —                                | ✓                | ✓              |
| `OPENAI_COMPATIBLE_API_KEY`                                                        | api, benchmarks                         | for `commandcode`, `deepseek`, `openai` | —                                | ✓                | ✓              |
| `GEMINI_API_KEY`                                                                   | api, benchmarks                         | for `gemini`, minutes fallback          | —                                | ✓                | ✓              |
| `AI_SUMMARIZATION_PROVIDER`                                                        | api                                     | no                                      | follows translation              | —                | —              |
| `ELEVENLABS_API_KEY`                                                               | benchmarks only (Scribe reference)      | no                                      | —                                | ✓                | —              |
| `LOCAL_STT_URL`, `LOCAL_TTS_URL`                                                   | api                                     | no                                      | `http://localhost:8002` / `8003` | default          | pinned         |
| `TRANSLATE_SPECULATION_OVERLAP`, `_HOMOPHONES`                                     | api                                     | no                                      | `off`                            | default          | default        |
| `TRANSLATE_LIVE_COMMIT_SCALE`                                                      | api                                     | no                                      | `3`                              | default          | default        |
| `AUTH_SECRET`                                                                      | web                                     | yes                                     | —                                | ✓                | ✓              |
| `AUTH_GOOGLE_ID`                                                                   | web, api                                | no; both halves or neither              | —                                | ✓                | ✓              |
| `AUTH_GOOGLE_SECRET`                                                               | web                                     | no                                      | —                                | ✓                | ✓              |
| `AUTH_GOOGLE_MOBILE_IDS`                                                           | api                                     | no                                      | —                                | —                | —              |
| `NEXT_PUBLIC_API_BASE_URL`                                                         | web (build time)                        | prod yes                                | `http://localhost:3000`          | default          | ✓              |
| `SMTP_USER`, `SMTP_PASS`                                                           | api                                     | prod yes                                | —                                | ignored          | ✓              |
| `SMTP_HOST`, `SMTP_PORT`                                                           | api                                     | no                                      | `smtp.gmail.com`, `465`          | —                | —              |
| `MAIL_FROM`                                                                        | api                                     | no                                      | `SMTP_USER`                      | —                | —              |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`           | api                                     | no; all or none                         | —                                | ✓                | ✓              |
| `R2_PUBLIC_BASE_URL`                                                               | api, web (build time)                   | with the other four                     | —                                | ✓                | ✓              |
| `NODE_ENV`, `PORT`                                                                 | api                                     | no                                      | `development`, `3000`            | default          | images/compose |
| `POSTGRES_USER`, `POSTGRES_DB`                                                     | compose                                 | no                                      | `chatofy`                        | default          | pinned         |
| `POSTGRES_PASSWORD`                                                                | compose                                 | prod yes                                | `chatofy` (dev)                  | default          | ✓              |
| `POSTGRES_PORT`, `REDIS_PORT`, `LOCAL_STT_PORT`, `LOCAL_TTS_PORT`                  | dev compose                             | no                                      | `5432`, `6379`, `8002`, `8003`   | default          | —              |
| `LOCAL_STT_THREADS`, `LOCAL_TTS_THREADS`, `LOCAL_STT_CONCURRENCY`, `LOCAL_STT_LID` | dev compose → sidecars                  | no                                      | `8`, `8`, `4`, `on`              | default          | —              |
| `PROD_LOCAL_STT_THREADS`, `PROD_LOCAL_TTS_THREADS`, `PROD_LOCAL_STT_CONCURRENCY`   | prod compose → sidecars                 | no                                      | `4`                              | —                | default        |
| `CHATOFY_ENV_FILE`, `STT_MODELS_DIR`, `TTS_MODELS_DIR`                             | prod compose                            | no                                      | under `$HOME`                    | —                | default        |
| `SHADOW_DATABASE_URL`                                                              | prisma `migrate diff`                   | no                                      | —                                | ✓                | never          |
| `HF_TOKEN`                                                                         | model download scripts (from the shell) | no                                      | —                                | ✓                | —              |
| `ANTHROPIC_API_KEY`                                                                | `benchmarks/translation-judge`          | no                                      | —                                | ✓                | —              |
| `EXPO_PUBLIC_API_BASE_URL`                                                         | mobile                                  | yes                                     | —                                | mobile `.env`    | —              |
| `WXT_API_BASE_URL`                                                                 | extension (compile time)                | release yes                             | `http://localhost:3000`          | extension `.env` | —              |

## Secrets

`AUTH_JWT_SECRET` (at least 32 characters) signs and verifies every access token
the api issues, and derives the keys for verification and reset links. There is
no "auth off" mode, so the api refuses to boot without it. Rotating it signs
every user out at once. That is still the only blanket revocation; a password
reset only invalidates that user's earlier tokens and closes their open sockets.

`AUTH_SECRET` signs the web's session cookie. `next build` needs it too, because
`/login` is prerendered. It and the two Google keys are server-only: they live in
`apps/web/src/config/server-env.ts` behind `import 'server-only'`, never in
`src/config/env.ts`. That module parses at import time and is imported by
`'use client'` hooks, so a required key there would throw in the browser.

## WEB_BASE_URL

The web's canonical public origin, written once. Three consumers: the api builds
every mailed link from it (verification, password reset, the "you already have
an account" notice); the web resolves `og:image` and its icons against it; prod
compose hands it to the web as `AUTH_URL`. The api allows exactly this origin
for CORS unless `CORS_ORIGIN` names more.

It is **never** derived from a request's `Host` header. That would turn an
attacker-supplied host into a poisoned link inside a signed, mailed URL. The api
refuses to boot in production while the value is still the localhost default,
because a plausible-looking wrong origin in a mailed link is worse than an
obviously broken one.

## MOBILE_LINK_SCHEME

The URL scheme the phone app registers (`scheme` in `apps/mobile/app.json`,
`chatofy`). When register or forgot-password is called with `client: 'mobile'`,
the mailed link is `<scheme>://verify-email?token=…` (or `reset-password`,
`forgot-password`, `sign-up`) instead of a web link, so following it opens the app.

Like `WEB_BASE_URL` it is configuration, never taken from the request: `client` only
chooses between the two values the operator set, and anything but `mobile` reads as
`web`. A stranger can therefore make a victim's mail carry the app link instead of
the web link, but cannot change where the token goes, and the token reaches only the
mailbox. The cost is inconvenience (the app link does nothing on a computer), not a
leak. A custom scheme can be claimed by another Android app; before the app is
published to a store, move these links to verified app links on the web origin.

## TRUST_PROXY_HOPS

How many reverse proxies sit in front of the api. A **count**, never `true`.
With 0 behind an ingress or CDN, every request looks like it came from the proxy,
so the per-IP auth rate limit becomes one global bucket and one attacker's login
attempts lock everyone out. `true` makes `X-Forwarded-For` attacker-controlled
and removes the limit altogether. Prod compose pins it to 1.

## Redis

`REDIS_URL` holds the rotating refresh-token families: one keyed SHA-256 hash per
token and one per family, never a plaintext credential. The api boots without
Redis. A stopped Redis costs new sign-ins and token renewals, which answer 503
rather than 401, so nobody is signed out over an outage. `pnpm --filter api
test:e2e` needs Redis running, because the fast e2e suites log in for real. The
request throttle does not use Redis: its counters are per replica.

## Translation providers

`AI_TRANSLATION_PROVIDER` defaults to `commandcode`, the host production runs.
That selection calls two hosts: Command Code first (deepseek-v4-flash-fast, then
gpt-5.6-sol polishing each finished line), and the DeepSeek row whenever Command
Code fails or its plan's usage window is spent. It therefore needs **both**
`COMMAND_CODE_API_KEY` and `OPENAI_COMPATIBLE_API_KEY`. A missing key is not
failed over: each host is built eagerly and throws a configuration error on
first use. A machine holding only the OpenAI-compatible key sets
`AI_TRANSLATION_PROVIDER=deepseek`. Before switching a deployment to
`commandcode`, deploy the web, extension and mobile builds that know
`server.translation.polished`: an older client reads that event as a broken
connection.

`OPENAI_COMPATIBLE_API_KEY` is one key for the whole OpenAI-compatible family,
because exactly one such host is ever selected. The endpoint, model and per-host
flags are not env: they live beside the host's name in
`apps/api/src/modules/translate/providers/register-default-providers.ts`. A
model id only means anything against the endpoint that serves it, and a model
override once sent `gpt-5-nano` to api.deepseek.com, which answered 400 on every
turn. To try a host that is not in that table, use
`benchmarks/error-analysis/translate-rows.mjs` with `--provider
openai-compatible --base-url … --api-key-env …`.

DeepSeek replaced Gemini for translation after a measurement on 2026-09-22
(`benchmarks/error-analysis/rows.jsonl`): p50 720 ms against 1114 ms for
gemini-3.5-flash-lite, with no refusal, softening or hedging across the
sovereignty corpus. The cost is data governance rather than latency:
conversation content reaches servers operated in China.

`GEMINI_API_KEY` is not the production translation key. It authenticates the
minutes fallback, which is selected independently of translation, the `gemini`
translation provider, and the benchmarks, whose `live-translate` arm dials
Gemini Live directly. It takes several keys, comma-separated, and the
translator rotates turns across them.
Gemini meters quota per **project** per model, so keys from the same Google
Cloud project share one bucket and rotation buys nothing. Enabling billing on a
project removes its free tier.

`AI_SUMMARIZATION_PROVIDER` picks the minutes host: `commandcode`
(gemini-3.7-flash, with Gemini direct as fallback) or `gemini`. Unset, it follows
translation: `commandcode` there means `commandcode` here, anything else
`gemini`. With the defaults, minutes therefore also run on Command Code; set
`gemini` to keep them on Gemini direct.

The cost knobs default to the cheaper turn measured in `benchmarks/call-budget`:
about 54% of the calls and 59% of the billed tokens, the same final translations,
p50 within 5%. `on`, `on` and `1` restore the earlier turn. What each knob trades
is documented in `apps/api/src/modules/translate/session/translation-cost-policy.ts`.

## Google sign-in

`AUTH_GOOGLE_ID` is the web's OAuth client id, the name Auth.js reads, and the
only audience `POST /auth/google` accepts. Both web halves or neither: the button
is offered only when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set. Unset on
the api, the route answers 501 rather than blocking the boot.

`AUTH_GOOGLE_MOBILE_IDS` adds the phone app's clients to the accepted audiences: a
comma-separated list of OAuth client ids (iOS, Android, and the web-type id), each
named, never a wildcard. The route accepts an id_token issued to any id in
`AUTH_GOOGLE_ID` plus this list. With only mobile ids set the route still works.

Creating the mobile clients (Google Cloud Console → APIs & Services → Credentials):

1. iOS: a client of type iOS with bundle id `dev.quanganh208.chatofy`.
2. Android: a client of type Android with package `dev.quanganh208.chatofy` and the SHA-1
   of the keystore that signs the build (a debug build uses the debug keystore's).
3. Put the ids in `apps/mobile/.env` as `EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS` and
   `EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID`, and the same ids in the api's
   `AUTH_GOOGLE_MOBILE_IDS`. The mobile ids are inlined at build time, so rebuild the
   dev client after a change. A platform with no id does not show "Continue with Google".

`apps/mobile/app.config.ts` derives the iOS redirect scheme from the iOS client id,
so no URL scheme is copied by hand.

Production reuses the dev client on purpose: one Google client carries several
redirect URIs. The redirect URI must be registered exactly:
`https://chatofy.quanganh208.dev/api/auth/callback/google`. The accepted
trade-off is that a leaked dev client secret is also a leaked prod one. Set
these before the web image is built.

## AUTH_URL derivation

Auth.js reads `AUTH_URL` from the environment. Prod compose sets it on the web
service from `WEB_BASE_URL`, so the domain is written once. It is required even
with `trustHost: true`. The web container binds `HOSTNAME=0.0.0.0` and
`PORT=3001`, and without `AUTH_URL` Auth.js derived its callback from those,
sending Google `redirect_uri=https://0.0.0.0:3001/...`. Google rejects that as an
OAuth policy violation (400 `invalid_request`), not as a redirect mismatch. That
is what makes it confusing: the Cloud Console shows the correct URIs and sign-in
still fails. It is a runtime value: changing `WEB_BASE_URL` needs a web restart,
not a rebuild.

## Mail

Real mail is sent only when `NODE_ENV` is neither `development` nor `test`, and
`SMTP_USER` and `SMTP_PASS` are set. In dev and test the console sender always
wins and prints links to stdout, so register, verify and reset work without a
Gmail account. It also means a stray SMTP password in a dev `.env` can never
mail a live account-takeover link. `SMTP_PASS` is a Gmail **app** password, which
requires 2FA on that account. Production refuses to boot without both. Blank and
missing are the same: a blank pair once started a sender that failed every mail
at Gmail (fixed in `apps/api/src/modules/mail/mail.module.ts`). `MAIL_FROM` sets
only the display name. Gmail rewrites the address to `SMTP_USER` regardless.

## R2 storage

One bucket, `chatofy`, shared by every feature and by both environments. Keys
are namespaced per feature (`avatars/…`, `conversations/…`). The bucket is
**public-read**: R2 publishes a bucket as a unit and scopes tokens per bucket, so
a prefix is a namespace, not an access boundary. Conversation recordings stored
there are world-readable by URL, with no authentication and no revocation. The
mitigation is 64 bits of entropy in the object key, plus an owner-scoped api route
as the only way the app reaches the bytes (`conversation-audio.ts`). A private
bucket later would be a second bucket variable and one factory in
`storage.module.ts`, not a data migration, because the column stores a key.

All five keys or none. With any one missing, `PUT` and `DELETE /auth/me/avatar`
answer 409 with a message naming the cause (409, because the exception filter
replaces every 5xx message), and everything else works. Scope the token to this
one bucket with Object Read & Write: the api never reads objects back.

`R2_PUBLIC_BASE_URL` is the bucket's custom domain, not the
`r2.cloudflarestorage.com` S3 endpoint, which is not publicly readable. It must
be a sibling hostname (`chatofy-cdn.<apex>`), because Cloudflare's free Universal
SSL covers the apex plus one label only. The same variable is read twice: the api
mints avatar URLs from it at runtime, and the web bakes it into the CSP `img-src`
at build time. Changing it is therefore a web **rebuild**. A restart alone looks
like it worked while the deployed CSP still forbids every URL the api mints. The
deploy smoke asserts the served `img-src` against this value.

## Build-time keys

`NEXT_PUBLIC_API_BASE_URL` and `R2_PUBLIC_BASE_URL` are read when the web image
is built (Next inlines the first; `next.config.ts` derives the CSP from both), so
changing either is a rebuild. The api hostname is a sibling
(`chatofy-api.<apex>`) for the same certificate reason as the CDN. Prod compose
passes both as build args. Turbo hashes them into the web build's cache key
only when they are real environment variables (CI, Docker). A local `turbo run
build` that takes them from the root `.env` does not see them in the hash, so
after changing either one, rebuild with `--force` or a stale CSP can be
replayed from cache.

## Compose

Dev `docker-compose.yml` reads the root `.env` for interpolation only, and passes
no env file to its containers. Postgres reads `POSTGRES_USER`, `POSTGRES_PASSWORD`
and `POSTGRES_DB` only when it initialises an empty data directory. Changing them
against an existing volume silently does nothing and the healthcheck then fails,
so run `docker compose down -v` first. Change the host ports only for a second
checkout running its own stack, and mirror them in `DATABASE_URL`, `REDIS_URL`
and `LOCAL_*_URL`. Measured on this machine, 8 sidecar threads (the physical core
count) beat 16. Prod uses its own `PROD_`-prefixed knobs (default 4) because both
stacks share the cores.

In prod compose, `CHATOFY_ENV_FILE`, `STT_MODELS_DIR` and `TTS_MODELS_DIR` default
under `$HOME`. Override them only with absolute paths: compose does not expand
`~`, and a relative path resolves against the CD runner's empty checkout, so the
sidecars come up with no weights.

## Known risks

- **Dev and prod share credentials.** The R2 token, the Cloudflare Realtime and
  TURN secrets, the Google client secret, and the OpenAI-compatible and Command
  Code keys are the same values in the dev `.env` and in prod.env. A leaked dev
  file is a production compromise. Separating them was deferred on 2026-11-03.
  The first step is a second R2 token, scoped to the same bucket, for dev.
- **Rollback across the env changes.** A deploy of a ref older than the
  translation-default change needs `AI_TRANSLATION_PROVIDER=commandcode` added
  back to prod.env, or it translates on that ref's default.
