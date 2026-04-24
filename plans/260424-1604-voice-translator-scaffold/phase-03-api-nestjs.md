# Phase 3 — apps/api (NestJS)

**Priority:** P1 | **Status:** pending | **Depends:** Phase 2

## Overview

NestJS skeleton with module boundaries defined by interfaces. No business logic — just DI wiring, config, Prisma init, WS gateway stub.

## Structure

```
apps/api/
├── src/
│   ├── main.ts                        # Fastify bootstrap
│   ├── app.module.ts                  # root module
│   ├── config/
│   │   ├── env.schema.ts              # zod env validation
│   │   └── app-config.module.ts       # global ConfigModule
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts     # empty routes stub
│   │   │   ├── interfaces/auth-adapter.interface.ts   # provider-agnostic
│   │   │   └── adapters/.gitkeep       # supabase/betterauth/custom impl later
│   │   ├── users/
│   │   │   ├── users.module.ts
│   │   │   ├── users.service.ts       # method stubs
│   │   │   └── interfaces/user-repository.interface.ts
│   │   ├── sessions/
│   │   │   ├── sessions.module.ts
│   │   │   ├── sessions.service.ts    # conversation session state stub
│   │   │   └── interfaces/session-store.interface.ts
│   │   ├── translate/
│   │   │   ├── translate.module.ts
│   │   │   ├── translate.gateway.ts   # @WebSocketGateway stub
│   │   │   └── interfaces/translator-service.interface.ts
│   │   └── health/
│   │       ├── health.module.ts
│   │       └── health.controller.ts   # GET /health
│   ├── common/
│   │   ├── filters/all-exceptions.filter.ts
│   │   ├── interceptors/logging.interceptor.ts
│   │   └── pipes/zod-validation.pipe.ts
│   └── prisma/
│       ├── prisma.module.ts
│       └── prisma.service.ts
├── prisma/
│   └── schema.prisma                  # placeholder User/Session/Transcript stubs
├── test/.gitkeep
├── .env.example
├── Dockerfile
├── .dockerignore
├── nest-cli.json
├── tsconfig.json                      # extends @chatofy/config/tsconfig/nestjs
├── tsconfig.build.json
├── eslint.config.mjs                  # extends @chatofy/config/eslint/nestjs
└── package.json
```

## Key Interfaces (skeleton only)

`auth/interfaces/auth-adapter.interface.ts`:

- `verifyToken(token: string): Promise<AuthClaims>`
- `getUser(userId: string): Promise<UserIdentity>`
- `issueToken?(userId: string): Promise<string>` (optional for non-external providers)

`users/interfaces/user-repository.interface.ts`:

- CRUD signatures (findById, findByEmail, create, update)

`sessions/interfaces/session-store.interface.ts`:

- `createSession`, `getSession`, `updateSession`, `endSession`
- Backend-agnostic (swap memory ↔ Redis ↔ Postgres)

`translate/interfaces/translator-service.interface.ts`:

- `startStream(clientId, config): Promise<StreamHandle>`
- `handleAudioFrame(streamId, frame): Promise<void>`
- `endStream(streamId): Promise<void>`
- Delegates to `@chatofy/ai-providers` registry internally

## Dependencies

- Runtime: `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-fastify`, `@nestjs/websockets`, `@nestjs/platform-ws`, `@nestjs/config`, `@prisma/client`, `prisma`, `zod`, `pino`
- Workspace: `@chatofy/types`, `@chatofy/ai-providers`, `@chatofy/config`
- Dev: `@nestjs/cli`, `@nestjs/testing`, `ts-node`, `tsconfig-paths`

## Env (.env.example)

- `NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`
- `AUTH_PROVIDER=none` (placeholder)
- `AI_REALTIME_PROVIDER=none`
- `CORS_ORIGIN`

## Success Criteria

- `pnpm --filter api run build` succeeds
- `pnpm --filter api run start:dev` starts (health check route returns 200)
- Prisma schema validates (`prisma validate`)
- No NotImplementedError thrown at boot — only when stubs invoked
