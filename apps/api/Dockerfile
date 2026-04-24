# ─── Stage 1: deps ───────────────────────────────────────────────────────────
# Fetch all workspace deps using pnpm's offline-capable fetch command.
FROM node:20-alpine AS deps
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy workspace manifests (needed for pnpm fetch)
COPY pnpm-lock.yaml ./
RUN pnpm fetch --prod

# ─── Stage 2: builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy all source (monorepo root + packages + apps/api)
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Install all deps (including dev) for build
RUN pnpm install --frozen-lockfile

# Generate Prisma client before building
RUN pnpm --filter api run prisma:generate

# Compile TypeScript → dist/
RUN pnpm --filter api run build

# ─── Stage 3: runner ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Non-root user for least-privilege execution
RUN addgroup -S chatofy && adduser -S api -G chatofy

# Copy only what the runtime needs
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

USER api

EXPOSE 3000

CMD ["node", "dist/main.js"]
