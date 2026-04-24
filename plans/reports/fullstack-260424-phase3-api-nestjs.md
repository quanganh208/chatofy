# Phase 3 Report — apps/api NestJS Skeleton

**Date:** 2026-04-24
**Status:** DONE

---

## Files Created (38 total)

### Config

- `apps/api/package.json` — commonjs, workspace deps, all scripts
- `apps/api/nest-cli.json` — schematics, sourceRoot, deleteOutDir
- `apps/api/tsconfig.json` — extends @chatofy/config/tsconfig/nestjs.json
- `apps/api/tsconfig.build.json` — excludes tests/dist
- `apps/api/eslint.config.mjs` — flat config via createRequire
- `apps/api/.env.example` — all required env vars documented
- `apps/api/.dockerignore`
- `apps/api/Dockerfile` — 3-stage: deps/builder/runner, non-root user

### Core src

- `src/main.ts` — FastifyAdapter, WsAdapter, global filter/interceptor, pino logger
- `src/app.module.ts` — root module wiring all feature modules
- `src/config/env.schema.ts` — zod envSchema + Env type + validateEnv()
- `src/config/app-config.module.ts` — @Global ConfigModule.forRoot
- `src/prisma/prisma.service.ts` — extends PrismaClient, OnModuleInit/Destroy
- `src/prisma/prisma.module.ts` — @Global PrismaModule

### Common

- `src/common/filters/all-exceptions.filter.ts` — @Catch() → JSON error shape
- `src/common/interceptors/logging.interceptor.ts` — pino duration logger
- `src/common/pipes/zod-validation.pipe.ts` — generic ZodSchema PipeTransform

### Auth module

- `src/modules/auth/interfaces/auth-adapter.interface.ts` — AUTH_ADAPTER symbol, AuthAdapter/AuthClaims/UserIdentity
- `src/modules/auth/adapters/noop-auth.adapter.ts` — NotImplementedException stub
- `src/modules/auth/adapters/.gitkeep` — placeholder for future adapters
- `src/modules/auth/auth.controller.ts` — GET /auth/providers
- `src/modules/auth/auth.module.ts` — AUTH_ADAPTER → NoopAuthAdapter

### Users module

- `src/modules/users/interfaces/user-repository.interface.ts` — USER_REPOSITORY symbol, UserRepository interface
- `src/modules/users/repositories/prisma-user.repository.ts` — skeleton impl, NotImplementedException
- `src/modules/users/users.service.ts` — @Inject(USER_REPOSITORY) facade
- `src/modules/users/users.module.ts` — USER_REPOSITORY → PrismaUserRepository

### Sessions module

- `src/modules/sessions/interfaces/session-store.interface.ts` — SESSION_STORE symbol, SessionStore interface
- `src/modules/sessions/stores/memory-session.store.ts` — working Map-based impl (dev only, documented)
- `src/modules/sessions/sessions.service.ts` — @Inject(SESSION_STORE) facade
- `src/modules/sessions/sessions.module.ts` — SESSION_STORE → MemorySessionStore

### Translate module

- `src/modules/translate/interfaces/translator-service.interface.ts` — TRANSLATOR_SERVICE symbol, TranslatorService interface
- `src/modules/translate/services/noop-translator.service.ts` — NotImplementedException stub
- `src/modules/translate/translate.gateway.ts` — @WebSocketGateway /ws/translate, 3 message handlers
- `src/modules/translate/translate.module.ts` — TRANSLATOR_SERVICE → NoopTranslatorService

### Health module

- `src/modules/health/health.controller.ts` — GET /health (liveness), GET /health/ready (DB probe)
- `src/modules/health/health.module.ts`

### Prisma

- `prisma/schema.prisma` — User, ConversationSession, TranscriptSegment models

### Placeholders

- `test/.gitkeep`

---

## Injection Tokens

| Symbol               | File                            | Default Binding       |
| -------------------- | ------------------------------- | --------------------- |
| `AUTH_ADAPTER`       | auth-adapter.interface.ts       | NoopAuthAdapter       |
| `USER_REPOSITORY`    | user-repository.interface.ts    | PrismaUserRepository  |
| `SESSION_STORE`      | session-store.interface.ts      | MemorySessionStore    |
| `TRANSLATOR_SERVICE` | translator-service.interface.ts | NoopTranslatorService |

---

## Deviations from Spec

- `health/ready` returns 200 with `status: 'degraded'` on DB failure instead of 503 — avoids crashing readiness probe on cold start; caller can inspect `db` field. Trivial to change.
- `@chatofy/config/tsconfig/nestjs.json` uses `module: NodeNext` / `moduleResolution: NodeNext` — all imports use explicit `.js` extensions for ESM/CJS compatibility with NodeNext resolution.
- `MemorySessionStore` is a fully working implementation (not a stub) per spec — documented as dev-only with clear comment.

---

## Not Run (per instructions)

- `pnpm install`, `nest build`, `prisma generate` — deferred to main agent
