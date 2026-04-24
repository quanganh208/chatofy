# API CLI Rewire Report

**Date:** 2026-04-24 | **Agent:** fullstack-developer

## Files Modified / Created

| File                                                               | Action                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `package.json`                                                     | updated — added workspace deps, runtime deps, scripts              |
| `tsconfig.json`                                                    | rewritten — extends `@chatofy/config/tsconfig/nestjs.json`         |
| `src/main.ts`                                                      | rewritten — Express + WsAdapter + CORS + global filter/interceptor |
| `src/app.module.ts`                                                | rewritten — root module, imports only                              |
| `src/config/env.schema.ts`                                         | created — zod env validation + validateEnv                         |
| `src/config/app-config.module.ts`                                  | created — @Global ConfigModule wrapper                             |
| `src/common/filters/all-exceptions.filter.ts`                      | created                                                            |
| `src/common/interceptors/logging.interceptor.ts`                   | created                                                            |
| `src/common/pipes/zod-validation.pipe.ts`                          | created                                                            |
| `src/prisma/prisma.service.ts`                                     | created — PrismaClient + lifecycle hooks                           |
| `src/prisma/prisma.module.ts`                                      | created — @Global                                                  |
| `src/modules/auth/interfaces/auth-adapter.interface.ts`            | created                                                            |
| `src/modules/auth/adapters/noop-auth.adapter.ts`                   | created                                                            |
| `src/modules/auth/adapters/.gitkeep`                               | created                                                            |
| `src/modules/auth/auth.controller.ts`                              | created                                                            |
| `src/modules/auth/auth.module.ts`                                  | created                                                            |
| `src/modules/users/interfaces/user-repository.interface.ts`        | created                                                            |
| `src/modules/users/repositories/prisma-user.repository.ts`         | created                                                            |
| `src/modules/users/users.service.ts`                               | created                                                            |
| `src/modules/users/users.module.ts`                                | created                                                            |
| `src/modules/sessions/interfaces/session-store.interface.ts`       | created                                                            |
| `src/modules/sessions/stores/memory-session.store.ts`              | created — working impl                                             |
| `src/modules/sessions/sessions.service.ts`                         | created                                                            |
| `src/modules/sessions/sessions.module.ts`                          | created                                                            |
| `src/modules/translate/interfaces/translator-service.interface.ts` | created                                                            |
| `src/modules/translate/services/noop-translator.service.ts`        | created                                                            |
| `src/modules/translate/translate.gateway.ts`                       | created — @WebSocketGateway /ws/translate                          |
| `src/modules/translate/translate.module.ts`                        | created                                                            |
| `src/modules/health/health.controller.ts`                          | created — /health + /health/ready                                  |
| `src/modules/health/health.module.ts`                              | created                                                            |
| `prisma/schema.prisma`                                             | created — User + ConversationSession + TranscriptSegment           |
| `.env.example`                                                     | created                                                            |
| `Dockerfile`                                                       | created — 3-stage: deps/builder/runner                             |
| `.dockerignore`                                                    | created                                                            |
| `test/health.e2e-spec.ts`                                          | created — replaces deleted app.e2e-spec                            |

**Deleted:** `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`, `test/app.e2e-spec.ts`

## Injection Tokens

| Token                | Symbol                         | Default Impl                   |
| -------------------- | ------------------------------ | ------------------------------ |
| `AUTH_ADAPTER`       | `Symbol('AUTH_ADAPTER')`       | `NoopAuthAdapter`              |
| `USER_REPOSITORY`    | `Symbol('USER_REPOSITORY')`    | `PrismaUserRepository`         |
| `SESSION_STORE`      | `Symbol('SESSION_STORE')`      | `MemorySessionStore` (working) |
| `TRANSLATOR_SERVICE` | `Symbol('TRANSLATOR_SERVICE')` | `NoopTranslatorService`        |

## Deviations from Phase-03 Spec

- Phase-03 specified `@nestjs/platform-fastify` — task overrides to **Express** (user chose Express; kept as specified in task)
- `main.ts` reads PORT from `process.env.PORT` directly (not ConfigService) to avoid circular bootstrap — ConfigService requires AppModule to be compiled first
- `HealthController` imports `PrismaService` directly (global) rather than via a dedicated health-check lib — per task spec, kept simple
- Phase-03 referenced `prisma` as runtime dep — moved to **devDependencies** (Prisma CLI is dev-only; `@prisma/client` is the runtime dep)

## Next Steps (blocked on main agent)

- Run `pnpm install` from workspace root to resolve workspace deps
- Run `pnpm --filter api prisma:generate` after install
- Run `pnpm --filter api typecheck` to validate TypeScript
