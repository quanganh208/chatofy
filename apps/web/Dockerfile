# syntax=docker/dockerfile:1.7
#
# Production image for the Next.js web app.
#
# The build ARGs below are NOT optional decoration. Next inlines every
# NEXT_PUBLIC_* value at build time, and next.config.ts additionally derives the
# CSP `connect-src` from NEXT_PUBLIC_API_BASE_URL — including the wss:// origin
# it computes by rewriting the scheme. Build with the wrong value and the app
# ships a policy naming an origin it never dials: the page renders, then the
# browser blocks every request and every socket, which reads as an outage rather
# than a misconfiguration. Changing it later is a REBUILD, never a restart.

# ── Stage 1: build ────────────────────────────────────────────────────────────
# Source before install — see apps/api/Dockerfile for the full reasoning. Short
# version: packages/types and packages/ui run tsup from a `prepare` script during
# install, so a manifests-only layer fails with "no input files".
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_ENV=production
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_ENV=${NEXT_PUBLIC_ENV}

# Present at build because `next build` prerenders /login, which reads the
# server-only config and would fail the schema without it. Nothing is signed at
# build time and this value never reaches the output — the real secret arrives as
# runtime env. The schema stays strict precisely so a deployment cannot fall back
# to a default signing secret.
ENV AUTH_SECRET=build-placeholder-never-signs-anything

COPY . .

# No `--config.*` flags on this install. See apps/api/Dockerfile: `fetchTimeout`
# deadlocks the install outright, and the rest, paired with the `--store-dir`
# cache mount, make the next layer's pnpm freshness check purge node_modules and
# abort for want of a TTY.
RUN --mount=type=cache,id=chatofy-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

RUN pnpm turbo run build --filter=web...

# Repair an incomplete trace. Next's file tracing pulls @swc/helpers into the
# standalone output but copies only the files it statically resolved, leaving the
# `esm/` directory out — so the server starts and dies on
# `@swc/helpers/esm/_interop_require_default.js`. The package IS present, just
# partial, which is why nothing looks broken until runtime.
#
# Both paths are globbed rather than pinned so a helpers version bump does not
# silently reintroduce this, and `set -e` semantics make a missing match fail the
# build rather than ship a broken image.
RUN set -eu; \
    SRC="$(ls -d node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers | head -1)"; \
    DEST="$(ls -d apps/web/.next/standalone/node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers | head -1)"; \
    cp -r "$SRC"/. "$DEST"/

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Standalone's server reads both. Without HOSTNAME it binds loopback INSIDE the
# container, where nothing else can reach it, and the published port answers
# connection-refused.
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs nextjs

# Three copies, and the nested prefix matters in all of them — the traced output
# preserves the workspace's directory shape.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# From the BUILDER, not the build context: `public/worklets/` is produced by
# web's `prebuild` step and is gitignored, so it does not exist in the context at
# all. Copying it from the context would silently ship a public/ without the
# audio worklet, and AudioWorklet.addModule would 404 at the first recording.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3001

# busybox wget — there is no curl in node:alpine.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/login || exit 1

CMD ["node", "apps/web/server.js"]
