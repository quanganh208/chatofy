# ── Stage 1: deps ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable

# Copy workspace manifests only (layer-cached until lockfile changes)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json ./packages/types/
COPY packages/ai-providers/package.json ./packages/ai-providers/

RUN pnpm install --frozen-lockfile

# ── Stage 2: builder ───────────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app

# Copy full source
COPY . .

# Generate Prisma client then compile NestJS app
RUN pnpm --filter api prisma:generate && \
    pnpm --filter api build

# ── Stage 3: runner ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Non-root user for least-privilege runtime
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copy only production artefacts
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/package.json ./package.json
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/prisma ./prisma

USER nestjs

EXPOSE 3000

CMD ["node", "dist/main"]
