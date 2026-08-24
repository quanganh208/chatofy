# syntax=docker/dockerfile:1.7
#
# Production image for the NestJS API.
#
# Node 24, not 20: the root package.json declares `engines.node >=22` and
# `.npmrc` sets `engine-strict=true`, so an older base makes `pnpm install`
# refuse outright.
#
# The `builder` stage below also backs the `migrate` service in
# docker-compose.prod.yml. That is not an optimisation — `prisma` is a
# devDependency, so it does not survive into the runtime tree and
# `migrate deploy` can only run from a stage that still has the dev deps.

# ── Stage 1: builder ──────────────────────────────────────────────────────────
# Source is copied BEFORE install, not after, and that ordering is forced rather
# than chosen. Three workspace projects run `prepare` on install — root (husky),
# packages/types (tsup) and packages/ui (tsup) — and the two tsup ones build from
# source. A manifests-only layer, the usual trick for caching installs against
# the lockfile, therefore fails outright: tsup finds no input files and the whole
# install exits non-zero.
#
# `--ignore-scripts` would be the wrong escape hatch here: pnpm-workspace.yaml's
# allowBuilds list deliberately permits argon2, @prisma/engines, prisma and
# esbuild to build, and those are exactly the native pieces this musl image needs.
#
# The pnpm store cache mount is what keeps this fast — package downloads survive
# across builds even though this layer re-runs on any source change.
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable

COPY . .

RUN --mount=type=cache,id=chatofy-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

# Through turbo so the workspace packages are built first: the API resolves
# @chatofy/* from their `dist`, which is not committed. `--filter=api...` is api
# plus its dependencies (CI's `api^...` is dependencies only, deliberately
# excluding api itself — a different job, a different filter).
RUN pnpm --filter api prisma:generate && \
    pnpm turbo run build --filter=api...

# A self-contained tree with the workspace @chatofy/* packages copied in rather
# than symlinked, so the runner stage needs no part of the monorepo layout.
#
# Two things deploy leaves behind, and each kills the container on startup while
# the build itself stays green:
#
#   1. `dist`. Deploy follows npm-pack semantics and `dist` is gitignored, so the
#      one directory the runtime actually executes is the one it omits.
#   2. The GENERATED Prisma client. `prisma generate` writes into the virtual
#      store at .pnpm/@prisma+client@<hash>/node_modules/.prisma, and deploy
#      re-links every package from the global store — which has no generated
#      output. Without it @prisma/client throws MODULE_NOT_FOUND at first import.
#      The <hash> directory name is identical in both trees, so the path is
#      derived rather than hardcoded.
RUN pnpm --filter api deploy --prod --legacy /prod/api && \
    cp -r apps/api/dist /prod/api/dist && \
    PRISMA_GEN="$(find node_modules/.pnpm -maxdepth 4 -type d -name .prisma | head -1)" && \
    test -n "$PRISMA_GEN" && \
    cp -r "$PRISMA_GEN" "/prod/api/$(dirname "$PRISMA_GEN")/"

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nestjs

COPY --from=builder --chown=nestjs:nodejs /prod/api ./

# Schema and migration history, for an operator running prisma against this
# image. The RUNTIME never reads them: Prisma 7 here goes through a driver
# adapter (PrismaPg over node-postgres) and the datasource declares no url, so no
# query-engine binary is involved at all.
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/prisma ./prisma

USER nestjs

EXPOSE 3000

# busybox wget, not curl — node:alpine has no curl, and a HEALTHCHECK whose own
# command is missing marks the container unhealthy forever.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/main"]
