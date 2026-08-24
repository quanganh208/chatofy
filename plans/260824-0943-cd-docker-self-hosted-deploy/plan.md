---
title: 'CD Docker self hosted deploy'
description: 'Continuous deployment to a Docker prod stack on this machine, separate from dev, published through the existing cloudflared tunnel'
status: pending
priority: P1
effort: '1-2d'
tags: [cd, docker, infra, deployment, security]
created: 2026-08-24
---

# CD Docker self hosted deploy

## Overview

Push to `main` → CI green → **this machine** builds prod images and runs a Docker
stack **separate from the dev stack**, served at `chatofy.quanganh208.dev` (web)
and `chatofy-api.quanganh208.dev` (api) through the cloudflared tunnel already
running here. The dev stack (5432/8002/8003) keeps working untouched, side by side.

Accepted contract:
[`plans/reports/brainstorm-260824-0918-cd-docker-self-hosted-deploy.md`](../reports/brainstorm-260824-0918-cd-docker-self-hosted-deploy.md)

Related, already completed: [`260823-2053-auth-register-verify-reset-smtp`](../260823-2053-auth-register-verify-reset-smtp/plan.md)
introduced the `SMTP_*` config this plan's production boot gate depends on (C2).

## Decisions this plan implements

| Decision                                                                    | Rationale                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Two sibling hostnames**, `chatofy` + `chatofy-api`, NOT `api.chatofy.*`   | Cloudflare Universal SSL covers apex + **one** label. A two-label name has no cert on the free plan. Single-hostname routing was rejected separately: the API has no `setGlobalPrefix`, so it would mean a public-contract change rippling into web, mobile, extension and `@chatofy/api-client`. |
| **Secrets host-local** at `~/.config/chatofy/prod.env`, never in GitHub     | The deploy target _is_ this machine. Routing secrets through GitHub adds exposure (workflow logs, GitHub itself) and buys nothing.                                                                                                                                                                |
| **`workflow_run` gating**, not `on: push`                                   | `on: push` runs the deploy _in parallel with_ CI, not after it — that is not a gate.                                                                                                                                                                                                              |
| **Migrate as an explicit step**, not a one-shot inside `up`                 | The project rule mandates a DB backup before any schema change; the backup must land between "image built" and "migrate runs", which is impossible inside the `up` dependency graph. Bonus: migrate failure aborts before touching running containers, so the old stack keeps serving.            |
| **Absolute host paths for model dirs**                                      | `services/local-*/models/` is gitignored (0 tracked files). Relative bind mounts resolve to **empty dirs** inside the runner's checkout.                                                                                                                                                          |
| **Prod sidecars: own containers, shared models RO, 4 threads, `mem_limit`** | Dev already runs 2 sidecars at 8 threads on a 16-core box. Model load costs minutes, so containers are never force-recreated.                                                                                                                                                                     |

## Verified constraints

Every row was read from source. Full evidence table in the brainstorm report.

| #   | Constraint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Evidence                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| C1  | `NODE_ENV` enum = `development\|production\|test`. No `staging`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `apps/api/src/config/env.schema.ts:20`                                    |
| C2  | **CORRECTED 2026-08-24 by measurement — the original wording was wrong.** The gate fires on ABSENCE, not on emptiness. Keys entirely absent ⇒ the API refuses to boot (verified: container `Restarting (1)`). Keys present but EMPTY ⇒ the API boots **cleanly, with no warning**, and binds a real SMTP sender holding blank credentials, so every mail fails at Gmail. Empty was the more dangerous state. **FIXED 2026-08-24** in `mail.module.ts` (`configured`/`configuredPort`): blank now collapses onto missing, so both refuse to boot. Regression tests added; verified in a container (blank ⇒ `Restarting (1)`). `WEB_BASE_URL` ≠ default still holds. | `apps/api/src/main.ts:38-58`, `mail.module.ts:21-43`, measured            |
| C3  | `NEXT_PUBLIC_API_BASE_URL` is inlined at **build** time and generates the CSP `connect-src`, including the `wss://` origin. Wrong at build ⇒ browser blocks every request and socket.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `apps/web/next.config.ts`, `turbo.json` `web#build`                       |
| C4  | API has **no** `setGlobalPrefix`. Routes are bare: `/health`, `/auth/*`, `/translate`, WS `/ws/translate`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `apps/api/src/main.ts`, `translate.gateway.ts:81`                         |
| C5  | `TRUST_PROXY_HOPS` wrong ⇒ per-IP auth rate limit silently becomes one shared bucket.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `main.ts:61-62`, `apps/api/.env.example`                                  |
| C6  | `apps/api/Dockerfile` is dead scaffold that **does not build**: `node:20-alpine` vs `engines.node>=22` + `.npmrc engine-strict=true`; copies 4 of 10 workspace manifests before `--frozen-lockfile`.                                                                                                                                                                                                                                                                                                                                                                                                                                                               | file, `git log d56d998`                                                   |
| C7  | `apps/web` has no Dockerfile and no `output: 'standalone'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `apps/web/next.config.ts`                                                 |
| C8  | `services/local-*/models/` gitignored, **0 tracked files** (1.3GB + 354MB on disk).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `git check-ignore`, `git ls-files`                                        |
| C9  | cloudflared runs as **root systemd**; its config carries the user's **only** SSH ingress.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `/etc/cloudflared/config.yml`                                             |
| C10 | Cloudflare Universal SSL = apex + one label only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | CF Universal SSL scope                                                    |
| C11 | **No** ws ping/pong/keepalive anywhere; CF drops idle WS ~100s.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | grep `realtime-client` + gateway                                          |
| C12 | `.gitignore` has `.env.*` with only `!.env.example` negated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `.gitignore:42-45`                                                        |
| C13 | Repo is **private**; 0 self-hosted runners registered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `gh repo view`, `gh api .../runners`                                      |
| C14 | Host: 16 cores, 31GB (~14 avail), 180GB free. Ports 4000/4001/5433/8012/8013 free.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `nproc`, `free`, `ss`                                                     |
| C15 | **Prisma 7 uses a driver adapter** (`PrismaPg` over node-postgres); `datasource db` declares **no `url`**. Runtime needs **no query-engine binary**. The `prisma` CLI still needs `DATABASE_URL` from env for `migrate deploy`. CI runs that invocation on ubuntu/glibc, so it does **not** prove the alpine/musl migrate path — Phase 1's `compose run --rm migrate` is the actual proof.                                                                                                                                                                                                                                                                         | `apps/api/src/prisma/prisma.service.ts`, `prisma/schema.prisma`, `ci.yml` |
| C16 | `prisma` is a **devDependency** of api, and api's `postinstall` is `prisma generate`. Both constrain the Dockerfile: migrate cannot run from a prod-pruned image, and a manifests-only deps stage fails to install.                                                                                                                                                                                                                                                                                                                                                                                                                                                | `apps/api/package.json`                                                   |
| C17 | `.gitignore`'s `.env.*` matches `.env.prod` but **not** `prod.env` or `prod.env.example`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `git check-ignore -v`                                                     |
| C18 | `trustHost: true` is already set, so Auth.js behind the tunnel needs no `AUTH_URL` / `AUTH_TRUST_HOST`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `apps/web/auth.ts:88`                                                     |

## Goals

| #   | Goal                                                                       | Priority |
| --- | -------------------------------------------------------------------------- | -------- |
| 1   | Prod images that actually build, proven locally before any infra exists    | P1       |
| 2   | Prod stack isolated from dev: own project name, ports, volumes             | P1       |
| 3   | Public TLS access via the existing tunnel, without breaking SSH ingress    | P1       |
| 4   | Hands-off deploy gated on CI green, serialized, with backup-before-migrate | P1       |
| 5   | A rollback path that works for both a bad image and a bad migration        | P2       |

## Non-goals

- Blue/green or zero-downtime. Brief recreate downtime is accepted.
- Kubernetes, external registry, multi-host.
- Deploying mobile or extension (not server artifacts).
- CD touching cloudflared config (C9 — manual, one-time, sudo).
- WS client reconnect logic (see R1 — separate follow-up).
- A readiness probe beyond the existing `/health` liveness.

## Phases

| #   | Phase                                                                                     | Status  |
| --- | ----------------------------------------------------------------------------------------- | ------- |
| 1   | [Phase 1: Prove images locally](./phase-01-prove-images-locally.md)                       | Pending |
| 2   | [Phase 2: Host prep and prod env](./phase-02-host-prep-and-prod-env.md)                   | Pending |
| 3   | [Phase 3: Tunnel hostnames and proxy hops](./phase-03-tunnel-hostnames-and-proxy-hops.md) | Pending |
| 4   | [Phase 4: Register self hosted runner](./phase-04-register-self-hosted-runner.md)         | Pending |
| 5   | [Phase 5: Deploy workflow](./phase-05-deploy-workflow.md)                                 | Pending |

**Dependency chain is strictly linear.** The trap: `deploy.yml` must merge
**last**. With `workflow_run` it fires on the very next CI green, so everything
must already work headless by the time it lands on `main`.

## Port and volume map

| Service         | Dev                             | Prod                         |
| --------------- | ------------------------------- | ---------------------------- |
| postgres        | `127.0.0.1:5432`                | `127.0.0.1:5433`             |
| api             | host `:3000`                    | `127.0.0.1:4000`             |
| web             | host `:3001`                    | `127.0.0.1:4001`             |
| local-stt       | `127.0.0.1:8002`                | `127.0.0.1:8012`             |
| local-tts       | `127.0.0.1:8003`                | `127.0.0.1:8013`             |
| compose project | `chatofy`                       | `chatofy_prod`               |
| pg volume       | `chatofy_chatofy_postgres_data` | `chatofy_prod_postgres_data` |
| HF cache        | `chatofy_chatofy_hf_cache`      | `chatofy_prod_hf_cache`      |

All prod ports bind `127.0.0.1` — the tunnel reaches them from loopback, so
nothing needs to listen on `0.0.0.0`.

## Success Criteria

- [ ] `git push origin main` → CI green → deploy runs on this machine with no human step
- [ ] `https://chatofy.quanganh208.dev` serves the app over valid TLS; login works
- [ ] `https://chatofy-api.quanganh208.dev/health` → 200 `{status:"ok"}`
- [ ] CORS preflight from the web origin passes; translate WS connects over `wss://`
- [ ] Dev stack still up and unaffected; prod uses separate volumes and ports
- [ ] Prod DB dumped to disk **before** every `prisma migrate deploy`
- [ ] Migrate failure aborts the deploy with the **old** stack still serving
- [ ] All prod services healthy after a host reboot
- [ ] `TRUST_PROXY_HOPS` verified **empirically** through the tunnel, not guessed
- [ ] No secret in GitHub or committed to the repo
- [ ] `ssh.quanganh208.dev` still reachable after the tunnel edit

## Risks

| ID  | Risk                                                                                                                                                                         | Signal it broke                                                                 | Pre-decided response                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **C11** — no WS keepalive + CF ~100s idle timeout. A user listening or pausing >100s is normal, and localhost dev never exercises it, so prod is the first place it appears. | Live session dies after a speech pause; no client error beyond a closed socket. | **Required fast-follow, not optional.** Minimal server-side fix: `ws.ping()` every ~30s in the gateway (browsers auto-pong, no client change). Out of scope for this plan's PR; prod is not "usable" until it lands. |
| R2  | `TRUST_PROXY_HOPS` guessed wrong ⇒ silent shared-bucket rate limiting (C5).                                                                                                  | `req.ip` ≠ `CF-Connecting-IP` when probed through the tunnel.                   | Phase 3 measures it before any automation exists. Start at 1, verify, adjust.                                                                                                                                        |
| R3  | Editing root-owned cloudflared config severs the user's only SSH ingress (C9).                                                                                               | `ssh.quanganh208.dev` stops resolving/connecting.                               | Back up the config, `cloudflared ingress validate` before restart, keep a local terminal open during the change. Tailscale is an independent fallback path onto the box.                                             |
| R4  | RAM. Measured dev: tts 2.0GiB, stt 0.7GiB, pg 69MiB; ~14GiB available. Prod adds ~3–3.5GiB.                                                                                  | Desktop swaps or OOM-kills.                                                     | Fits, not tight. `mem_limit` on prod sidecars anyway so a leak cannot freeze the desktop.                                                                                                                            |
| R5  | Runner user is in the docker group = root-equivalent on this box.                                                                                                            | —                                                                               | Accepted for a personal machine. Custom runner label + no `pull_request` trigger + private repo (C13) close the realistic paths.                                                                                     |
| R6  | First runner build is slow (cold layer + pnpm store cache).                                                                                                                  | Deploy takes many minutes on run #1.                                            | Expected, not a fault. Subsequent builds hit cache.                                                                                                                                                                  |
| R7  | `prisma migrate deploy` is forward-only.                                                                                                                                     | A migration corrupts data.                                                      | Rollback of a bad **migration** is `pg_restore` from the pre-migrate dump, not a redeploy. Documented in Phase 5.                                                                                                    |
| R8  | Next standalone in a monorepo nests the server under an `apps/web` subpath; static and public dirs must be copied to the matching subpath or every asset 404s.               | Page loads unstyled, all assets 404.                                            | Budget a debug loop in Phase 1. Caught locally, never reaches prod.                                                                                                                                                  |

## Resolved questions

All four questions open at plan-writing time were answered by the user on
2026-08-24. Recorded here rather than deleted, so the decisions stay auditable.

1. **`SMTP_*`** — the user reports holding a Gmail app password, but measurement on 2026-08-24 found **no `SMTP_*` key in any env file** (`apps/api/.env` has 16 keys, none of them SMTP). Dev mail appears to work only because the console sender takes over when `NODE_ENV` is development. The values still have to be written into prod.env, where they are currently commented out.
2. **Prod OAuth client** — REVISED 2026-08-24: **reuse the dev client**, adding the prod redirect URI to it. The earlier "register a new client" answer was taken back once it was clear nothing requires it: one Google client carries several redirect URIs, and `GOOGLE_CLIENT_IDS` is a comma-separated allowlist (`google-token-verifier.ts:43-48`), so splitting later costs only a second id. The one hard requirement is the redirect URI itself — Google matches it exactly, and Auth.js does not override `basePath`, so prod needs `https://chatofy.quanganh208.dev/api/auth/callback/google` registered or sign-in fails with `redirect_uri_mismatch`. Note `googleConfigured` is evaluated at module load in `apps/web/src/config/server-env.ts`, so enabling Google after the image is built likely needs a **rebuild**, not a restart.
3. **Cloudflare plan** — **free**. C10 stands unchanged: Universal SSL covers apex + one label, so the sibling hostname `chatofy-api.quanganh208.dev` is required, not merely preferred.
4. **Backup retention** — **14** dumps.

## Open questions

None.

<!-- slug: cd-docker-self-hosted-deploy -->
