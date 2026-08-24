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

| Key                                 | Constraint                                                                                                                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                          | Must be `production`. The schema is a strict enum with no `staging`, and any other value also flips the web CSP onto its `unsafe-eval` dev branch.                                                                                  |
| `WEB_BASE_URL`                      | The API refuses to boot in production while this is the default. Every mailed link is built from it.                                                                                                                                |
| `AUTH_URL`                          | Required despite `trustHost: true`. Without it Auth.js builds OAuth callbacks from the container's bind address (`0.0.0.0:3001`), which Google rejects as a policy violation — the Cloud Console looks correct while sign-in fails. |
| `NEXT_PUBLIC_API_BASE_URL`          | Read at **build** time. It is inlined into the bundle _and_ generates the CSP `connect-src`, including the `wss://` origin. Changing it is a rebuild, never a restart.                                                              |
| `CORS_ORIGIN`                       | The exact origin, never `*` — credentials mode is enabled only when it is not the wildcard.                                                                                                                                         |
| `SMTP_*`                            | All four, or all four absent. Absent refuses to boot (loud); a blank value is treated as absent for the same reason.                                                                                                                |
| `TRUST_PROXY_HOPS`                  | `1`, measured at the origin. Wrong values fail silently by collapsing the per-IP auth rate limit into one shared bucket.                                                                                                            |
| `STT_MODELS_DIR` / `TTS_MODELS_DIR` | Absolute paths. `services/local-*/models` is gitignored with zero tracked files, so a relative path resolves to an empty directory inside the runner's checkout.                                                                    |

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

## Rollback

Two different failures with two different answers:

- **Bad code** — `workflow_dispatch` with an earlier ref. The layer cache makes the rebuild fast.
- **Bad migration** — `pg_restore` from the dump taken immediately before it. `prisma migrate deploy` is forward-only, so re-deploying older code rolls back _code_ and never _schema_; when a migration is destructive this is the only path.

Backups live in `~/chatofy-backups` (14 retained).

## Host prerequisites

- **Runner** — `actions.runner.quanganh208-chatofy.chatofy-local.service`, a systemd _system_ service. Labelled `[self-hosted, linux, chatofy]`; the custom label is the isolation mechanism, since bare `self-hosted` matches any runner.
- **Docker** — Docker Desktop, context `desktop-linux`, over a per-user socket. There is no `/var/run/docker.sock` on this host.
- **Docker must survive a reboot unattended**, and that takes _two_ things, not one. Docker Desktop is a systemd _user_ service, so (a) **linger must stay enabled** (`loginctl enable-linger quanganh208`) or the user manager never starts at boot, and (b) `~/.config/systemd/user/docker-desktop.service` must stay in place. That file is a local replacement for the packaged unit, which requires `graphical-session.target` and is enabled only into `graphical-session.target.wants/`. Under lightdm + Cinnamon that target is never activated — measured, while logged into the desktop — so the packaged unit starts neither at boot nor at login, and Docker only ever came up when someone launched the app by hand. The replacement depends on `basic.target` and is wanted by `default.target`. Neither half is optional: the runner is a _system_ service and is always online after a reboot, so a missing daemon means a deploy that fails at the first `docker` call, and `restart: unless-stopped` cannot help either — it is honoured by a daemon that is not running. Re-check the unit after a Docker Desktop upgrade; it no longer tracks the packaged one.
- **Model weights** — `~/chatofy/models/{stt,tts}`, mounted read-only into the sidecars. Because that mount is read-only, a sidecar can never fetch a model it does not already have; the deploy's `Seed speech model weights` step is what puts weights on the host, running each sidecar's own `scripts/download_models.py` through the `seed` profile with the same directory mounted writable. Renaming or replacing a model directory is therefore a normal deploy, but a slow one — the new weights download before anything is rolled out. This gap was invisible until the first rename: the in-container download had only ever run as a cached no-op, and its first real write crash-looped the container on `EROFS`. CI cannot catch it, since CI never mounts these volumes.
- **Tunnel** — the ingress in `/etc/cloudflared/config.yml` is root-owned and also carries the operator's SSH ingress. **CD never touches it.** Adding a hostname is a manual, one-time change: back the file up, `cloudflared tunnel ingress validate`, then restart, keeping the catch-all rule last.

## Known gaps

- **No WebSocket keepalive.** Cloudflare drops idle sockets after roughly 100 seconds, and a user pausing mid-conversation is ordinary. Localhost development never exercises this. The minimal fix is server-side (`ws.ping()` in the gateway); client reconnect is a larger follow-up.
- **The runner is root-equivalent** through the Docker daemon. Bounded by a private repository, the custom label, and the absent `pull_request` trigger. If this repository is ever made public, that last rule stops being belt-and-braces and becomes the only thing holding.
