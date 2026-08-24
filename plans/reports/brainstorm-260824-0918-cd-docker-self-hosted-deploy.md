# Brainstorm — CD: Dockerized prod deploy on this machine

Date: 2026-08-24 · Branch: main · Status: accepted, ready for `/ak:plan`

## Outcome

Push to `main` → CI green → this machine builds prod images and runs a Docker
stack **separate from the dev stack**, published at `chatofy.quanganh208.dev`
(web) and `chatofy-api.quanganh208.dev` (api) through the cloudflared tunnel
already running here. Dev stack keeps working untouched, side by side.

## Constraints (verified from source, not assumed)

| #   | Constraint                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| C1  | `NODE_ENV` enum = development\|production\|test. No `staging`.                                                                                                                                                                                                                                                                                                                            | `apps/api/src/config/env.schema.ts:20`                         |
| C2  | ~~`NODE_ENV=production` throws at boot unless all 4 `SMTP_*` set~~ **WRONG — corrected by measurement 2026-08-24.** The gate fires on ABSENCE only. Keys absent ⇒ API refuses to boot. Keys present but EMPTY ⇒ API boots clean, no warning, real SMTP sender with blank credentials, every mail fails at Gmail. Empty is the more dangerous state. `WEB_BASE_URL` ≠ default still holds. | `apps/api/src/main.ts:38-58`, `mail.module.ts:21-43`, measured |
| C3  | `NEXT_PUBLIC_API_BASE_URL` inlined at BUILD time and generates CSP `connect-src` incl. the `wss://` origin. Wrong at build ⇒ browser blocks all.                                                                                                                                                                                                                                          | `apps/web/next.config.ts`, `turbo.json` web#build              |
| C4  | API has NO `setGlobalPrefix`. Routes bare: `/health`, `/auth/*`, `/translate`, WS `/ws/translate`.                                                                                                                                                                                                                                                                                        | `apps/api/src/main.ts`, `translate.gateway.ts:81`              |
| C5  | `TRUST_PROXY_HOPS` wrong ⇒ per-IP auth rate limit becomes one shared bucket.                                                                                                                                                                                                                                                                                                              | `main.ts:61-62` + `apps/api/.env.example`                      |
| C6  | `apps/api/Dockerfile` is dead scaffold and does not build: node:20 vs `engines.node>=22` + `engine-strict=true`; copies 4 of 10 manifests.                                                                                                                                                                                                                                                | file + `git log d56d998`                                       |
| C7  | `apps/web` has no Dockerfile, no `output: 'standalone'`.                                                                                                                                                                                                                                                                                                                                  | `apps/web/next.config.ts`                                      |
| C8  | `services/local-*/models/` gitignored, 0 tracked files (1.3GB + 354MB on disk). Runner checkout ⇒ EMPTY dirs.                                                                                                                                                                                                                                                                             | `git check-ignore`, `git ls-files`                             |
| C9  | cloudflared runs as ROOT systemd; its config carries the user's ONLY SSH ingress (`ssh.quanganh208.dev`).                                                                                                                                                                                                                                                                                 | `/etc/cloudflared/config.yml`                                  |
| C10 | Cloudflare Universal SSL covers apex + ONE label. `api.chatofy.quanganh208.dev` = 2 labels ⇒ no cert on free plan.                                                                                                                                                                                                                                                                        | CF Universal SSL scope                                         |
| C11 | NO ws ping/pong/keepalive anywhere. CF drops idle WS ~100s.                                                                                                                                                                                                                                                                                                                               | grep realtime-client + gateway                                 |
| C12 | `.gitignore` has `.env.*` with only `!.env.example` negated.                                                                                                                                                                                                                                                                                                                              | `.gitignore:42-45`                                             |
| C13 | Repo is PRIVATE; 0 self-hosted runners registered.                                                                                                                                                                                                                                                                                                                                        | `gh repo view`, `gh api .../runners`                           |
| C14 | Host: 16 cores, 31GB (16 used, ~14 avail), 180GB free. Ports 4000/4001/5433/8012/8013 free. Dev on 5432/8002/8003.                                                                                                                                                                                                                                                                        | `nproc`, `free`, `ss`                                          |

## Non-goals

- Blue/green or zero-downtime. Brief recreate downtime accepted.
- Kubernetes, external registry, multi-host.
- Deploying mobile or extension (not server artifacts).
- CD touching cloudflared config (C9 — manual, one-time, sudo).
- WS client reconnect logic (separate follow-up).
- Readiness probe beyond the existing `/health` liveness.

## Acceptance criteria

1. `git push origin main` → CI green → deploy workflow runs on this machine, no human step.
2. `https://chatofy.quanganh208.dev` serves the app over valid TLS; login works.
3. `https://chatofy-api.quanganh208.dev/health` → 200 `{status:"ok"}`; CORS preflight from the web origin passes; translate WS connects over `wss://`.
4. Dev stack (5432/8002/8003) still up and unaffected; prod uses separate volumes + ports.
5. Prod DB dumped to disk BEFORE every `prisma migrate deploy`; migrate failure aborts the deploy with the OLD stack still serving.
6. `docker compose -f docker-compose.prod.yml ps` all healthy after a reboot (`restart: unless-stopped` + runner installed as systemd).
7. `TRUST_PROXY_HOPS` verified EMPIRICALLY through the tunnel (`req.ip` vs `CF-Connecting-IP`), not guessed.
8. No secret (AUTH_JWT_SECRET, AUTH_SECRET, SMTP_PASS, GEMINI_API_KEY) stored in GitHub or committed.

## Chosen direction

**Hostnames — two, sibling not nested.** `chatofy.quanganh208.dev` → web:4001,
`chatofy-api.quanganh208.dev` → api:4000. Sibling naming is forced by C10: the
name originally floated (`api.chatofy...`) has no free-plan certificate.
Rejected single-hostname + `setGlobalPrefix('api')` (C4: public-contract change
rippling into web/mobile/extension/api-client) and Next-rewrites proxying (would
funnel 12MB audio bodies and the WebSocket through the standalone server).

**Secrets — host-local, never GitHub.** `~/.config/chatofy/prod.env` chmod 600,
absolute `env_file:` path, with a committed `prod.env.example` for auditability.
The deploy target is this machine, so a GitHub round-trip is pure added
exposure. NEXT*PUBLIC*\* build ARGs are not secrets and live in the compose file
(they are needed at `build` time, not run time).

**Deploy gating — `workflow_run`, not `push`.** `on: push` races CI rather than
following it. Use `workflow_run: {workflows:[CI], types:[completed], branches:[main]}`
plus `if: conclusion == 'success'`, and `workflow_dispatch` for manual/rollback.
`concurrency: {group: deploy, cancel-in-progress: false}` to serialize deploys.
Never `pull_request` on a self-hosted runner. Custom label `[self-hosted, chatofy]`.

**Migrate — explicit step, not in the `up` graph.** Order: build → `pg_dump -Fc`
into `~/chatofy-backups/` → `compose run --rm migrate` → `up -d --wait` → smoke.
This satisfies the backup-before-schema-change rule (impossible if migrate is a
one-shot inside `up`), and a migrate failure aborts before touching running
containers — the old stack keeps serving. That is most of the rollback story.

**Model dirs — absolute host paths.** Per C8, relative `./services/local-*/models`
resolves to empty dirs inside the runner workspace. Mount via `${STT_MODELS_DIR}`
and `${TTS_MODELS_DIR}` read from prod.env, pointing at real host paths, read-only.

**Sidecars — own containers, shared models, 4 threads each** (8012/8013), with
their own HF cache volume (sharing dev's would need `external: true` and couple
the two stacks). `mem_limit` set so a leak cannot freeze the desktop. Never pass
`--force-recreate`: model load costs minutes, and compose already leaves
unchanged services running.

## Phases (for /ak:plan)

1. **Prove images locally.** Rewrite `apps/api/Dockerfile` (node 24-alpine, all 10
   manifests, musl prisma engine generated in-builder, prisma schema + migrations
   in the runner stage, non-root, HEALTHCHECK via `wget`/`node -e` — there is no
   curl in alpine). New `apps/web/Dockerfile` + `output: 'standalone'` (monorepo
   gotcha: the standalone server lands under a nested `apps/web` subpath, and the
   static + public dirs must be copied to the matching subpath or every asset
   404s). BuildKit cache mount for the pnpm store. New `docker-compose.prod.yml`,
   `name: chatofy_prod`, own volumes, logging caps (`max-size 10m`, `max-file 3`),
   `restart: unless-stopped`.
   Gate: `up` with a hand-written prod.env, smoke on localhost 4000/4001.
   ~90% of the failure surface lives here and needs zero infrastructure.
2. **Host prep.** Final `~/.config/chatofy/prod.env` (fresh prod secrets, distinct
   from dev), backups dir, absolute model-path vars, `prod.env.example` committed
   (needs a `.gitignore` negation per C12).
3. **Tunnel + DNS.** Both hostnames, manual sudo edit preserving the SSH ingress
   (C9 — back the config up first, `cloudflared ingress validate` before restart).
   Verify the locally-running prod stack THROUGH the tunnel, and settle
   `TRUST_PROXY_HOPS` empirically here, before any automation exists.
4. **Register runner.** Labeled `[self-hosted, chatofy]`, `./svc.sh install` so it
   survives reboot.
5. **`deploy.yml` LAST.** With `workflow_run` it fires on the very next CI green,
   so everything must already work headless by the time it merges.

## Risks

- **R1 (must fix, fast-follow):** C11 — no WS keepalive plus CF's ~100s idle
  timeout. A listening or pausing user is normal, not an edge case, and localhost
  dev never exercises it, so prod is the first place it appears. Minimal fix is
  server-side only: `ws.ping()` every ~30s in the gateway (browsers auto-pong, no
  client change needed). NOT in the CD PR, but required before prod is usable.
- **R2:** `TRUST_PROXY_HOPS` — start at 1 (CF edge appends the client IP to XFF;
  cloudflared connects from loopback and does not append), then VERIFY. Wrong ⇒
  silent shared-bucket rate limiting (C5).
- **R3:** Editing the root-owned cloudflared config can sever the user's SSH
  ingress. Back up, edit, validate, then restart.
- **R4:** RAM. Measured dev: tts 2.0GiB, stt 0.7GiB, pg 69MiB; ~14GiB available.
  A prod duplicate adds roughly 3–3.5GiB. Fits, not tight. Set `mem_limit` anyway.
- **R5:** The runner user is in the docker group = root-equivalent on this box.
  Acceptable personally; the custom label, the no-`pull_request` rule and the
  private repo (C13) close the realistic paths.
- **R6:** First runner build is slow (cold cache). Expected, not a fault.
- **R7:** `prisma migrate deploy` is forward-only. Rolling back a bad MIGRATION is
  `pg_restore` from the pre-migrate dump, not a redeploy.

## Unresolved questions

1. Gmail app-password values for `SMTP_*` — user must supply at phase 2.
   RESOLVED-ish: no `SMTP_*` key exists in any env file today (measured); the
   user holds an app password but it has not been written anywhere. See revised
   C2 — the four keys are kept COMMENTED OUT until filled, so an unfilled deploy
   fails loudly instead of mailing nothing.
2. `GOOGLE_CLIENT_IDS` / `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` for prod: reuse
   the dev OAuth client, or register a new one with the prod redirect URI? Google
   login stays off until decided (not a boot blocker).
3. Confirm the Cloudflare account is free-plan. If Advanced Certificate Manager is
   owned, `api.chatofy.quanganh208.dev` becomes viable and C10 falls away.
4. Backup retention: 14 dumps assumed. Confirm.
