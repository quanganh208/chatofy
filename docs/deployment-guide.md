# Deployment guide

How Chatofy reaches production, and what has to be true on the host for it to
work. Production is a Docker stack on the maintainer's own machine, published
through a Cloudflare Tunnel, deployed by a GitHub Actions self-hosted runner on
that same machine.

- Web — <https://chatofy.quanganh208.dev>
- API — <https://chatofy-api.quanganh208.dev>

## The two stacks

Dev and production run **side by side on one host**, sharing nothing. Isolation
is by compose project name, published port, and volume.

|                | dev (`docker-compose.yml`)       | production (`docker-compose.prod.yml`) |
| -------------- | -------------------------------- | -------------------------------------- |
| project        | `chatofy`                        | `chatofy_prod`                         |
| postgres       | `127.0.0.1:5432`                 | `127.0.0.1:5433`                       |
| api            | host `:3000` (not containerised) | `127.0.0.1:4000`                       |
| web            | host `:3001` (not containerised) | `127.0.0.1:4001`                       |
| local-stt      | `127.0.0.1:8002`                 | `127.0.0.1:8012`                       |
| local-tts      | `127.0.0.1:8003`                 | `127.0.0.1:8013`                       |
| speech threads | 8 each                           | 4 each (both stacks share 16 cores)    |

Every production port binds `127.0.0.1`. The tunnel reaches them over loopback,
so nothing needs to listen on `0.0.0.0`.

## Configuration

The production environment file lives **outside the repository** at
`~/.config/chatofy/prod.env`, mode `600`. It is deliberately not in git and
deliberately not in GitHub Actions secrets — the deploy target is the same
machine that runs the workflow, so routing secrets through GitHub would add
exposure and buy nothing. `prod.env.example` in the repo root documents every
key; read it before changing anything, as several values are forced rather than
chosen.

**Every** compose invocation must pass it:

```bash
docker compose -f docker-compose.prod.yml --env-file ~/.config/chatofy/prod.env <cmd>
```

Omit `--env-file` and the model-path variables expand to empty, so the speech
sidecars bind-mount the wrong directory and start with no weights.

### Values that are not free choices

| Key                                 | Constraint                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                          | Must be `production`. The schema is a strict enum with no `staging`, and any other value also flips the web CSP onto its `unsafe-eval` dev branch.                                                                                                                                                          |
| `WEB_BASE_URL`                      | The API refuses to boot in production while this is the default. Every mailed link is built from it.                                                                                                                                                                                                        |
| `AUTH_URL`                          | Required despite `trustHost: true`. Without it Auth.js builds OAuth callbacks from the container's bind address (`0.0.0.0:3001`), which Google rejects as a policy violation — the Cloud Console looks correct while sign-in fails.                                                                         |
| `NEXT_PUBLIC_API_BASE_URL`          | Read at **build** time. It is inlined into the bundle _and_ generates the CSP `connect-src`, including the `wss://` origin. Changing it is a rebuild, never a restart.                                                                                                                                      |
| `CORS_ORIGIN`                       | The exact origin, never `*` — credentials mode is enabled only when it is not the wildcard.                                                                                                                                                                                                                 |
| `SMTP_*`                            | All four, or all four absent. Absent refuses to boot (loud); a blank value is treated as absent for the same reason.                                                                                                                                                                                        |
| `TRUST_PROXY_HOPS`                  | `1`, measured at the origin. Wrong values fail silently by collapsing the per-IP auth rate limit into one shared bucket.                                                                                                                                                                                    |
| `R2_*`                              | All five (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`) or none. A partial set disables avatars rather than half-working. Unlike `SMTP_*`, this does **not** refuse to boot — it warns, and the two avatar routes answer 409. See _Avatar storage_ below. |
| `R2_PUBLIC_BASE_URL`                | Read by **both** services — at runtime by the API, at **build** time by web, which bakes it into the CSP `img-src`. Changing the origin is therefore a **web rebuild**, not only an API restart.                                                                                                            |
| `STT_MODELS_DIR` / `TTS_MODELS_DIR` | Absolute paths. `services/local-*/models` is gitignored with zero tracked files, so a relative path resolves to an empty directory inside the runner's checkout.                                                                                                                                            |

## The deploy pipeline

`.github/workflows/deploy.yml`, triggered by `workflow_run` on the **CI**
workflow (`branches: [main]`, gated on `conclusion == 'success'`), plus
`workflow_dispatch` for manual runs and rollback.

`on: push` is deliberately not used: it starts the deploy _in parallel with_ CI,
which reads like a gate and is not one. `pull_request` is deliberately absent and
must stay absent — this executes on a self-hosted runner on a personal machine.

Step order, and why:

```
checkout(head_sha) → build → pg_dump → migrate → up -d --wait → smoke(local) → smoke(tunnel) → tag → prune
```

- **checkout `head_sha`** — under `workflow_run` the default checkout is not necessarily the commit CI validated.
- **backup before migrate** — the dump must land between the build and the schema change, and is asserted non-empty. A zero-byte dump is worse than none because it invites trusting it.
- **migrate as its own step** — a failed migration aborts before any running container is replaced, so the old stack keeps serving. It runs from the image's `builder` target, because `prisma` is a devDependency and is not in the runtime image.
- **tunnel smoke asserts the CSP** names the production API origin. A 200 on the page is not sufficient evidence: a stale web image serves a healthy-looking page whose policy names the wrong origin, and the browser then blocks every request.

Runs are serialized (`concurrency: deploy-prod`, never cancelling in progress —
a run can be sitting between backup and migrate) and bounded by
`timeout-minutes: 30`.

## Migrations that are not zero-downtime

`deploy.yml` runs `migrate` **before** `up -d --wait`, so a schema change lands
while the previous containers are still serving. That is correct for an additive
migration and unsafe for a destructive one, and the pipeline cannot tell them
apart. Two entries so far:

- **`add_conversation_history`** — additive (two new tables). Deploys normally.
- **`rekey_meeting_minutes`** — **NOT zero-downtime.** It drops `ownerId` and
  `sessionId` from `MeetingMinutes`, so the moment it lands the running OLD api's
  `ownerId_sessionId` queries fail, and a browser tab holding the old bundle keeps
  calling `/sessions/:id/minutes`, a route this release deletes. Take a short
  maintenance window:

  ```bash
  docker compose -f docker-compose.prod.yml stop api web
  docker compose -f docker-compose.prod.yml --profile migrate run --rm migrate
  docker compose -f docker-compose.prod.yml up -d --wait
  ```

  The migration **guards itself**: it raises if `MeetingMinutes` holds any rows,
  which aborts `migrate deploy` non-zero and leaves the old stack serving. That
  guard exists because `migrate deploy` reports migration names and not
  per-statement row counts, and the deploy step checks only the exit code — so a
  non-empty table would otherwise be destroyed with nobody the wiser. `pg_dump`
  first regardless; the pipeline already does.

- **`add_conversation_search_indexes`** — additive, but it needs an extension.
  See the prerequisite below.
- **`add_unaccented_search`** — additive. Adds `ConversationTurn.searchText`,
  backfills it, and replaces the three per-column trigram indexes with one over
  the new column. The backfill is a single `UPDATE` over the table; on a history
  of any realistic size it is fast, but it does take a write lock for its
  duration. Needs the `unaccent` extension — again, see below.

## Rollback

Two different failures with two different answers:

- **Bad code** — `workflow_dispatch` with an earlier ref. The layer cache makes the rebuild fast.
- **Bad migration** — `pg_restore` from the dump taken immediately before it. `prisma migrate deploy` is forward-only, so re-deploying older code rolls back _code_ and never _schema_; when a migration is destructive this is the only path.

Backups live in `~/chatofy-backups` (14 retained).

## Avatar storage (R2)

Avatar bytes live in a Cloudflare R2 bucket served through a public custom
domain. Nothing is written to the API's filesystem — the prod `api` service has
no volume — and R2 needs no service in `docker-compose.prod.yml`, only
credentials, one build arg, and the deploy assertion below.

### One-time setup

1. **Cloudflare → R2 → create bucket** `chatofy` (location APAC). One bucket
   serves the whole project and both environments, with keys namespaced per
   feature (`avatars/…`). Everything in it is world-readable by URL — read
   _Bucket layout_ in `docs/system-architecture.md` before putting anything new
   in it.
2. **Bucket → Settings → Public access → connect a custom domain**, e.g.
   `chatofy-cdn.quanganh208.dev` — a **sibling** hostname, not `cdn.chatofy.…`.
   On the free plan Cloudflare Universal SSL covers the apex plus one label, so a
   two-label name has no certificate and every avatar fails TLS in the browser.
   This is the same constraint that made the API `chatofy-api.…`. Wait for the
   DNS record to go active, then
   verify **before wiring anything else**:

   ```bash
   curl -I https://chatofy-cdn.quanganh208.dev/
   ```

   Do this first on purpose. A bucket that is not actually public produces the
   same symptom in a browser as a missing CSP entry — an image that does not
   load — and separating the two failures in time is the only cheap way to tell
   them apart later.

3. **R2 → Manage API Tokens** → a token with **Object Read & Write scoped to
   this bucket only**. The API never reads objects back; the browser fetches them
   from the public domain. Nothing here justifies an account-wide key.
4. Put all five `R2_*` values in `prod.env`. Do this _before_ deploying, since
   `R2_PUBLIC_BASE_URL` is also a build arg for web.
5. **Rebuild the web image.** The origin is compiled in; `up -d` alone does not
   pick it up.

### One origin variable, read two ways

`R2_PUBLIC_BASE_URL` is a single value in `prod.env` that **both** services read,
which is what makes it impossible for them to disagree:

- the **API** reads it at runtime through `env_file` and composes every avatar
  URL from it;
- **web** takes it as a **build arg**, because `next.config.ts` bakes the CSP into
  the routes manifest at build time. (Measured, not assumed: a build made without
  the value and started with it set still serves the old header.)

It carries no `NEXT_PUBLIC_` prefix deliberately. That prefix exists to inline a
value into the _client_ bundle, and no client code reads this one — only
`next.config.ts`, which runs in plain Node at build time.

The practical consequence: **changing the origin is a web rebuild**, not only an
API restart. An operator who edits `prod.env` and restarts just the API will see
it mint new URLs immediately while the deployed CSP still forbids them, and every
avatar silently fails. The deploy smoke is the guard — it greps the served
`img-src` from the tunnel and fails the deploy unless it names the configured
origin, exactly as it already does for `connect-src`. That is the only check that
survives a missing Dockerfile `ARG`, a typo'd domain, or a stale web image.

The build arg is **defaulted, not required**, in `docker-compose.prod.yml`.
`deploy.yml` runs `compose config` before it builds anything and compose expands
every interpolation at config time, so a `:?` here would abort the entire
pipeline — api, migrate and the seed jobs included — over a profile picture.
Unset means avatars are off and everything else deploys; the smoke skips its
assertion and says so.

### Running without R2

Supported, and the normal state in development. The API boots, logs one warning
naming the missing capability, and `PUT`/`DELETE /auth/me/avatar` answer **409**
with a message saying storage is not configured. 409 rather than 503 because the
shared error contract has no 5xx code but `INTERNAL_ERROR` and the exception
filter replaces every 5xx message — a 503 would be indistinguishable from a
crash. Every avatar surface falls back to initials.

### Removal, and the one-hour cache window

Removing an avatar deletes the **object first** and only then clears the
columns. If the delete fails the request fails with a retryable 409 and the row
is untouched: on a public-read bucket, clearing the column while the object
survives would leave a photograph published after its owner asked for it to be
taken down, having told them it succeeded.

Objects are stored with `Cache-Control: public, max-age=3600` and deliberately
**no `immutable`**. Content-hashed keys already make replacement safe at any TTL,
so deletion is what governs the number.

**Measured on the deployed custom domain, the effective window is four hours,
not one.** Cloudflare's zone Browser Cache TTL overrides the origin header —
an object written by the API with `max-age=3600` is served through
`chatofy-cdn.<apex>` as `public, max-age=14400`, and a `GET` still returns 200
after the origin object has been deleted. So a removed photo can stay reachable
from the edge for up to **four hours**.

Deletion at the origin remains authoritative and immediate; this is the edge
window on top of it. To bring it back to the hour the application asks for, add
a Cache Rule scoped to the `chatofy-cdn` hostname that respects origin
cache-control — do **not** change the zone-wide Browser Cache TTL, which also
governs the app itself. Closing the window entirely needs a cache-purge call on
deletion, which requires a second API token and is out of scope.

## Host prerequisites

- **Postgres `pg_trgm` and `unaccent`** — history search uses trigram GIN indexes
  (`add_conversation_search_indexes`) and a one-time normalizing backfill
  (`add_unaccented_search`); each migration creates the extension it needs with
  `CREATE EXTENSION IF NOT EXISTS`. `postgres:16-alpine` — what both compose files
  and the CI service run — ships contrib, so both succeed there. A managed
  Postgres that does not allow an extension fails on the migration named for
  search rather than on the one that creates history, which is deliberate: the
  failure is then legible.

  `unaccent` is needed only for that backfill. Text written afterwards is folded
  by the application (`normalizeForSearch`), so a deployment cannot end up with
  search that half-works because the extension was dropped later.

- **Database collation** — no longer load-bearing for search, and worth stating
  because it once was. Matching folds case in the application before it reaches
  SQL, and compares with `LIKE` rather than `ILIKE`, so how a given collation
  folds accented uppercase (`Ộ` vs `ộ`) no longer decides whether a search works.
  A deployment initialised with `C` collation is fine for this feature.
- **Runner** — `actions.runner.quanganh208-chatofy.chatofy-local.service`, a systemd _system_ service. Labelled `[self-hosted, linux, chatofy]`; the custom label is the isolation mechanism, since bare `self-hosted` matches any runner.
- **Docker** — Docker Desktop, context `desktop-linux`, over a per-user socket. There is no `/var/run/docker.sock` on this host.
- **Docker must survive a reboot unattended**, and that takes _two_ things, not one. Docker Desktop is a systemd _user_ service, so (a) **linger must stay enabled** (`loginctl enable-linger quanganh208`) or the user manager never starts at boot, and (b) `~/.config/systemd/user/docker-desktop.service` must stay in place. That file is a local replacement for the packaged unit, which requires `graphical-session.target` and is enabled only into `graphical-session.target.wants/`. Under lightdm + Cinnamon that target is never activated — measured, while logged into the desktop — so the packaged unit starts neither at boot nor at login, and Docker only ever came up when someone launched the app by hand. The replacement depends on `basic.target` and is wanted by `default.target`. Neither half is optional: the runner is a _system_ service and is always online after a reboot, so a missing daemon means a deploy that fails at the first `docker` call, and `restart: unless-stopped` cannot help either — it is honoured by a daemon that is not running. Re-check the unit after a Docker Desktop upgrade; it no longer tracks the packaged one.
- **Model weights** — `~/chatofy/models/{stt,tts}`, mounted read-only into the sidecars. Because that mount is read-only, a sidecar can never fetch a model it does not already have; the deploy's `Seed speech model weights` step is what puts weights on the host, running each sidecar's own `scripts/download_models.py` through the `seed` profile with the same directory mounted writable. Renaming or replacing a model directory is therefore a normal deploy, but a slow one — the new weights download before anything is rolled out. This gap was invisible until the first rename: the in-container download had only ever run as a cached no-op, and its first real write crash-looped the container on `EROFS`. CI cannot catch it, since CI never mounts these volumes.
- **Tunnel** — the ingress in `/etc/cloudflared/config.yml` is root-owned and also carries the operator's SSH ingress. **CD never touches it.** Adding a hostname is a manual, one-time change: back the file up, `cloudflared tunnel ingress validate`, then restart, keeping the catch-all rule last.

## Known gaps

- **No WebSocket keepalive.** Cloudflare drops idle sockets after roughly 100 seconds, and a user pausing mid-conversation is ordinary. Localhost development never exercises this. The minimal fix is server-side (`ws.ping()` in the gateway); client reconnect is a larger follow-up.
- **The runner is root-equivalent** through the Docker daemon. Bounded by a private repository, the custom label, and the absent `pull_request` trigger. If this repository is ever made public, that last rule stops being belt-and-braces and becomes the only thing holding.
