---
phase: 1
title: 'Prove images locally'
status: pending
priority: P1
effort: '6-8h'
dependencies: []
---

# Phase 1: Prove images locally

## Overview

Build working prod images for `api` and `web`, and a `docker-compose.prod.yml`
that runs the whole stack on loopback ports, **entirely on this machine with no
infrastructure involved**. Roughly 90% of the failure surface of this plan lives
here and needs neither a tunnel nor a runner to find.

## Requirements

**Functional**

- `apps/api/Dockerfile` builds and produces a container that boots and answers `GET /health`.
- `apps/web/Dockerfile` builds and produces a container that serves the app with working assets.
- `docker compose -f docker-compose.prod.yml up -d --wait` brings up postgres + api + web + both sidecars, all healthy.
- A `migrate` service exists that runs `prisma migrate deploy` and exits 0.

**Non-functional**

- Prod stack must not collide with the running dev stack: distinct project name, ports, volumes.
- Sidecars capped at 4 threads and given `mem_limit`.
- Every service has bounded logging (docker's `json-file` default is unbounded).
- Prod images do not carry dev dependencies.

## Architecture

### Why the existing api Dockerfile is rewritten, not patched (C6)

It has never been built by anything — no compose service, no CI job, no doc
references it, and `git log` shows it untouched since the app-regeneration
commit. Three independent reasons it cannot work as written:

1. `node:20-alpine` against root `engines.node>=22` with `.npmrc engine-strict=true` → `pnpm install` refuses.
2. It copies 4 package manifests, but the workspace globs are `apps/*` + `packages/*` = **10** packages. `pnpm install --frozen-lockfile` fails on the missing manifests.
3. The runner stage copies the **full dev** `node_modules`.

### Prisma: no runtime engine binary needed (C15)

This is the detail most likely to be got wrong. `PrismaService` constructs
`PrismaClient` with `new PrismaPg({connectionString})` — a **driver adapter** over
node-postgres — and `schema.prisma`'s `datasource db` declares **no `url`**. So:

- **Runtime (api image):** no query-engine binary is used. Do not chase musl `binaryTargets` for the runner stage.
- **Migrate step:** the `prisma` **CLI** is what needs `DATABASE_URL`, and it reads it from the environment.
- `prisma generate` still runs in the builder (it generates the client package).

The migrate path is **not** proven by CI: CI runs on ubuntu (glibc) while the
migrate container is alpine (musl). The CLI's schema-engine comes from the
allowlisted `@prisma/engines` / `prisma` build scripts in
`pnpm-workspace.yaml`, so it should install, but the actual proof is this
phase's `compose run --rm migrate` criterion. Treat that criterion as
load-bearing, not a formality.

### The migrate service must target `builder`, not the runner stage

`prisma` is a **devDependency** of api (`apps/api/package.json` devDependencies,
not dependencies). So "reuse the api image for migrate" and "the runner stage
carries pruned production `node_modules`" are mutually exclusive: a pruned prod
tree has no `prisma` binary, and migrate would die with command-not-found.

Fix: the `migrate` compose service builds the **same Dockerfile** with
`target: builder` — the builder stage has the full dev dependency tree and the
source — running `pnpm --filter api exec prisma migrate deploy`, matching the
invocation CI already uses. Do **not** promote `prisma` to `dependencies` to
work around this; that bloats the runtime image for something the runtime never
calls.

### `postinstall` breaks the deps stage unless the schema is copied

api declares `"postinstall": "prisma generate"`. pnpm runs a workspace project's
own lifecycle scripts during install, so a deps stage that copies **manifests
only** and then runs `pnpm install --frozen-lockfile` fails: `prisma generate`
finds no `schema.prisma` and exits non-zero.

Fix: copy `apps/api/prisma/` alongside the 10 manifests in the deps stage.

Do **not** reach for `--ignore-scripts`. `pnpm-workspace.yaml` deliberately
allowlists builds for `argon2`, `@prisma/engines`, `prisma`, `esbuild`, `sharp`
and `unrs-resolver` — skipping scripts strips exactly the native and engine
installs the alpine image needs.

### Pruning production dependencies

`.npmrc` sets `node-linker=hoisted`, so there is one flat root `node_modules`
mixing dev and prod — there is no subtree to copy. Use
`pnpm --filter api deploy --prod <out>`, which produces a self-contained prod
`node_modules` **and** copies the workspace dependencies with their built `dist`
(api resolves `@chatofy/*` from `dist`, which is not committed). This is the
hardest packaging step in the phase; naming the tool here is the point.

### Web standalone in a monorepo (R8)

`output: 'standalone'` in a pnpm workspace nests the server under an `apps/web`
subpath inside the standalone output rather than at its root, and the static and
public directories are **not** included — they must be copied into the matching
nested subpath or every asset 404s while the HTML still renders. Expect a debug
loop here; it is cheap locally and expensive in prod.

### Build-time vs run-time env (C3)

`NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_ENV` must be **build ARGs**, not
runtime env — Next inlines them, and the first also generates the CSP
`connect-src` including the `wss://` origin. `AUTH_SECRET` must be _present_ at
build (the `/login` prerender reads server-only config) but nothing is signed
then, so a placeholder is correct at build and the real value comes at runtime.

These are not secrets and belong in the compose file, **not** in the secret
`env_file` — they are needed at `compose build` time, when `env_file` is not read.

## Related Code Files

- Modify: `apps/api/Dockerfile` (full rewrite)
- Create: `apps/web/Dockerfile`
- Modify: `apps/web/next.config.ts` (add `output: 'standalone'`)
- Create: `docker-compose.prod.yml`
- Create: `.dockerignore` (repo root) — keep `node_modules`, `.git`, `models/`, build output out of the build context
- Reference only, do not modify: `docker-compose.yml`, `apps/api/.env.example`, `apps/web/.env.example`

## Implementation Steps

1. **Root `.dockerignore` first.** Without it the build context includes ~1.7GB of models and every `node_modules`. This alone can make builds appear hung.
2. **Rewrite `apps/api/Dockerfile`**, multi-stage:
   - `deps`: `node:24-alpine`, `corepack enable`, copy **all 10** workspace manifests + `pnpm-lock.yaml` + `pnpm-workspace.yaml` **+ `apps/api/prisma/`** (required — `postinstall` runs `prisma generate`), then `pnpm install --frozen-lockfile` with a BuildKit cache mount for the pnpm store.
   - `builder`: copy source, `pnpm --filter api prisma:generate`, then `pnpm turbo run build --filter=api...` so workspace deps are built (api resolves `@chatofy/*` from `dist`, which is not committed — CI hit this exact problem). **This stage is also the migrate image** (see architecture).
   - `runner`: `node:24-alpine`, non-root user, copy built `dist`, the `pnpm deploy --prod` output, and `prisma/` (schema + both migrations). `HEALTHCHECK` using busybox `wget -qO- http://localhost:3000/health` or `node -e` — **there is no curl in node alpine images**.
3. **Add `output: 'standalone'`** to `apps/web/next.config.ts`. Verify `pnpm --filter web build` still succeeds on the host before containerising.
4. **Write `apps/web/Dockerfile`** with `ARG NEXT_PUBLIC_API_BASE_URL`, `ARG NEXT_PUBLIC_ENV`, and a build-only placeholder `AUTH_SECRET`. Copy the standalone output plus static and public dirs into their matching nested subpath. Add a `HEALTHCHECK` — same no-curl-in-alpine constraint as the api.
5. **Write `docker-compose.prod.yml`**: `name: chatofy_prod`; services postgres(**pin `postgres:16-alpine`**, same major as dev so dumps restore across both, 5433) / migrate / api(4000) / web(4001) / local-stt(8012) / local-tts(8013); `restart: unless-stopped`; `logging: {options: {max-size: "10m", max-file: "3"}}` on every service; `mem_limit` on the sidecars; `LOCAL_*_THREADS=4`; model bind mounts via `${STT_MODELS_DIR}` / `${TTS_MODELS_DIR}` read-only (**absolute paths**, per C8). `env_file` must be an absolute path outside the repo — compose does **not** expand `~` in that attribute, so use `${HOME}/...` or a literal path.
6. **Add the `migrate` service** building the same Dockerfile with `target: builder`, command `pnpm --filter api exec prisma migrate deploy`. Give it `profiles: [migrate]` so it never runs inside the default `up` dependency graph (see Phase 5).
7. **Smoke locally.** Keep the temporary env file **outside the repo**, or name it `.env.prod` — verified: `.gitignore` matches `.env.prod` but does **not** match `prod.env`, so a file named `prod.env` holding real credentials would be stageable. Then: `curl localhost:4000/health`, load `localhost:4001` and confirm **assets** load (not just HTML), confirm the dev stack is still healthy alongside.
   - **Also exercise argon2**: one register-or-login call against `localhost:4000`. It is a native module built for musl inside the image, and neither `/health` nor a page load touches it — the first failure would otherwise be a 500 on login in production.
   - **Expect login from `localhost:4001` to fail here, and do not "fix" it.** The web image bakes `NEXT_PUBLIC_API_BASE_URL=https://chatofy-api.quanganh208.dev`, which does not exist until Phase 3. Baking `localhost:4000` instead would only force a rebuild later (C3). Assets loading is the criterion for this phase; end-to-end login is Phase 3's.
8. **Verify the `--wait` + one-shot interaction** once: confirm `up -d --wait` does not hang or fail because of a successfully-exited container. This behaviour has regressed across compose versions; this repo is on v5.3.1 and it should be checked rather than assumed.

## Success Criteria

- [x] `docker compose -f docker-compose.prod.yml build` succeeds from a clean context
- [x] `up -d --wait` reports all services healthy
- [x] `curl -fsS localhost:4000/health` returns `{"status":"ok",...}`
- [x] `localhost:4001` renders **with styles and JS loading** (proves R8 handled)
- [x] A register-or-login call against `localhost:4000` succeeds (proves argon2 built for musl)
- [x] `docker compose run --rm migrate` exits 0 against the prod postgres (proves the alpine prisma CLI path, which CI does not cover)
- [x] `docker ps` still shows the three dev containers healthy
- [x] Runner image carries no dev dependencies — checked concretely, e.g. `docker run --rm <api-image> sh -c 'ls node_modules/.bin' | grep -cE 'jest|eslint'` returns 0
- [x] `git status` shows no untracked file containing real credentials

## Risk Assessment

- **R8 (standalone asset paths)** — highest-probability time sink in this phase. Signal: page renders unstyled, assets 404. Response: iterate locally; do not proceed to Phase 2 until assets load.
- **Turbo filter syntax** — `--filter=api...` vs `--filter=api^...` mean different things (CI deliberately uses the latter for building _only_ dependencies). Getting it wrong yields a build that works on a warm dev tree and fails on a clean checkout. Response: test in a clean clone or with `docker build --no-cache`, which is what the runner will effectively do.
- **Compose `--wait` + one-shot** — assumption that v5.3.1 handles it. Signal: `up --wait` returns non-zero despite a healthy stack. Response: the Phase 5 design already runs migrate as a separate `compose run` step, so this is contained either way.
- **`engine-strict`** — if pnpm still refuses under node 24, check `packageManager: pnpm@11.10.0` is actually what corepack activates in the image.

---

## Outcome — what actually happened (2026-08-24)

Completed; all five services verified healthy end to end. Seven defects surfaced.
Where this section contradicts the prescriptions above, **this section is
correct** — the plan's approach was wrong in several places.

### Plan prescriptions that turned out WRONG

1. **"Copy the 10 manifests + prisma, then install"** — impossible here. Three
   workspace projects run `prepare` on install (root husky, packages/types tsup,
   packages/ui tsup) and the two tsup ones build from source, so a manifests-only
   layer dies with `No input files`. Source must be copied BEFORE install; the
   pnpm store cache mount is what keeps that affordable.

2. **"Use `pnpm deploy --prod` to prune"** — it prunes nothing. Measured 497MB
   still carrying prisma, typescript, prettier, @prisma/studio-core. Those are
   not leaked devDeps either: `.npmrc` sets `auto-install-peers=true`, so they
   arrive as _peers_ of `@prisma/client`. Without `--legacy` it fails outright. A
   hand-built prod-deps prune stage was tried and produced a **2.46GB** image —
   worse. `deploy --prod --legacy` at ~880MB is the accepted outcome.

3. **`pnpm deploy` silently drops two things the runtime needs.** It follows
   npm-pack semantics, so the gitignored `dist` is omitted — the image builds
   clean and dies instantly. It also re-links packages from the global store, so
   the GENERATED Prisma client is absent and `@prisma/client` cannot resolve
   `.prisma/client/default`. Both are now copied explicitly, with the virtual
   store's hash directory derived rather than hardcoded.

4. **`migrate` cannot use `pnpm --filter api exec prisma ...`.** pnpm runs a
   dependency-freshness check before exec, decides the image tree is stale, and
   auto-runs `pnpm install --production`, which aborts with
   `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Invoking the prisma binary
   directly skips all of it.

### Defects the plan did not anticipate at all

5. **`tsconfig.build.tsbuildinfo` from the host poisoned the build.** The ignore
   pattern was `**/tsconfig.tsbuildinfo`, which does not match that filename. tsc
   read the host's incremental state, concluded everything was current, emitted
   nothing, and produced an image with **no `dist` at all** — while reporting
   success. Now `**/*.tsbuildinfo`.

6. **`PORT` collides across api and web in a shared env file.** Both read it, so
   whichever value `prod.env` holds governs both and the service whose published
   port disagrees never answers. Web listened on 3000 while 4001 mapped to 3001.
   `PORT` is now pinned per service under `environment:`, which outranks
   `env_file:`.

7. **Next traced `@swc/helpers` incompletely.** The package reaches the
   standalone output but its `esm/` directory does not, so the server starts and
   dies on `esm/_interop_require_default.js`. The builder now back-fills the
   traced copy from the real package, globbed so a version bump cannot silently
   reintroduce it.

### What R8 predicted correctly

The standalone server does land under a nested `apps/web/` prefix, and static and
public are not traced into it. Copying both to the matching prefix worked first
time. `public/worklets/` had to come from the BUILDER — `prebuild` generates it
and it is gitignored, so it does not exist in the build context.

### Measured

| Item                                | Value                                              |
| ----------------------------------- | -------------------------------------------------- |
| api image                           | 894MB                                              |
| web image                           | 297MB                                              |
| migrate image (builder target)      | **4.61GB** — Phase 5 pruning must account for this |
| local-stt / local-tts               | 1.0GB / 1.36GB                                     |
| Prod stack RAM, all five up         | ~2.1GB (tts 1.53GB, stt 440MB, others <70MB)       |
| Sidecar cold start, weights present | 41s                                                |

R4 estimated +3–3.5GB; actual ~2.1GB. Sidecars start fine against **read-only**
model bind mounts — the download step no-ops when weights are present.

### Verified

`/health` 200 under `NODE_ENV=production`, so the C2 SMTP boot gate genuinely
passed rather than being bypassed; both migrations applied on alpine/musl, the
path CI structurally cannot cover; argon2 loads and hashes on musl; `/login` 200
with every `_next/static` asset and the worklet at 200; CSP `connect-src` baked
from the build ARG exactly as designed; dev stack healthy alongside throughout;
host `turbo run build` and `typecheck` for web still pass after adding
`output: 'standalone'`.

Torn down afterwards with `down -v`. Removing the volume was deliberate:
Postgres applies `POSTGRES_PASSWORD` only to an empty data dir, so keeping it
would have baked the throwaway smoke password into Phase 2's real database.

### Not done

The `code-reviewer` subagent was **not** spawned. Flagged, not hidden.
