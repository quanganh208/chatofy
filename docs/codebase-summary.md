# Codebase Summary

Monorepo for **Chatofy** — realtime Vietnamese ↔ English voice translator.

## Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Mobile:** Expo SDK 52 (React Native) + expo-router
- **API:** NestJS 11 + Fastify + Prisma + WebSocket
- **Web:** Next.js 15 App Router (landing placeholder)
- **DB:** Postgres 16 (via Prisma), Redis 7 (via ioredis — future)
- **Language:** TypeScript strict + zod runtime validation

## Layout

```
chatofy/
├── apps/
│   ├── api/       # NestJS gateway (:3000, /ws/translate)
│   ├── mobile/    # Expo RN (MVP surface)
│   └── web/       # Next.js landing (:3001)
├── packages/
│   ├── config/    # tsconfig/eslint/prettier presets (@chatofy/config)
│   ├── types/     # SINGLE source: zod schemas (domain + HTTP contracts) (@chatofy/types)
│   ├── api-client/    # framework-agnostic API client w/ runtime contract validation (@chatofy/api-client)
│   ├── ai-providers/  # STT/MT/TTS/Realtime interfaces + registry (@chatofy/ai-providers)
│   └── ui/        # stub (reserved for shared UI primitives)
├── docker-compose.yml  # postgres + redis local dev
├── .github/workflows/  # CI (lint / typecheck / build)
├── plans/              # implementation plans and reports
└── docs/               # this directory
```

## Interface-First Design Points

All external integrations are hidden behind interfaces so impls can swap without code churn:

| Interface                                  | Location                                                                    | Default impl                  |
| ------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------- |
| `RealtimeProvider`                         | `packages/ai-providers/src/interfaces/realtime-provider.ts`                 | none (impl later)             |
| `SttProvider`                              | `packages/ai-providers/src/interfaces/stt-provider.ts`                      | none                          |
| `TranslationProvider`                      | `packages/ai-providers/src/interfaces/translation-provider.ts`              | none                          |
| `TtsProvider`                              | `packages/ai-providers/src/interfaces/tts-provider.ts`                      | none                          |
| `AuthAdapter` (`AUTH_ADAPTER` symbol)      | `apps/api/src/modules/auth/interfaces/auth-adapter.interface.ts`            | `NoopAuthAdapter`             |
| `UserRepository` (`USER_REPOSITORY`)       | `apps/api/src/modules/users/interfaces/user-repository.interface.ts`        | `PrismaUserRepository` (stub) |
| `SessionStore` (`SESSION_STORE`)           | `apps/api/src/modules/sessions/interfaces/session-store.interface.ts`       | `MemorySessionStore`          |
| `TranslatorService` (`TRANSLATOR_SERVICE`) | `apps/api/src/modules/translate/interfaces/translator-service.interface.ts` | `NoopTranslatorService`       |
| `IAudioRecorder` / `IAudioPlayer`          | `apps/mobile/src/audio/*.interface.ts`                                      | (impl deferred)               |

**Retired:** Per-app `IApiClient` / `FetchApiClient` (mobile, web) replaced by unified `@chatofy/api-client` package.

## Entry Points

| App    | Dev command                  | URL / Entry                                  |
| ------ | ---------------------------- | -------------------------------------------- |
| api    | `pnpm --filter api dev`      | http://localhost:3000 (REST + /ws/translate) |
| web    | `pnpm --filter web dev`      | http://localhost:3001                        |
| mobile | `pnpm --filter mobile start` | Expo dev client / simulator                  |

## Env Files

Each app has `.env.example`. Copy to `.env` per app. Root `.env.example` documents Docker Compose overrides.

## CI

GitHub Actions (`.github/workflows/ci.yml`) — lint, typecheck, build jobs on PR + push to `main`.

## API Response Contract

All HTTP responses (except `/health*` probes) follow a standard envelope:

**Success (2xx)**

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "req_<uuid>|custom",
    "timestamp": "2026-06-05T...",
    "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
  }
}
```

**Error (4xx/5xx)**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|INTERNAL_ERROR",
    "message": "Human-readable message",
    "details": [{ "path": "field.nested", "message": "error reason" }]
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

### Implementation

- **Envelope type**: `ApiResponse<T>` (packages/types/src/api/response.ts)
- **Success wrapping**: `TransformInterceptor` (apps/api/src/common/interceptors/transform.interceptor.ts)
  - Wraps raw controller returns in `{ success: true, data, meta }`
  - Skips WebSocket contexts and `/health*` routes
- **Error handling**: `AllExceptionsFilter` (apps/api/src/common/filters/all-exceptions.filter.ts)
  - Maps HTTP status → stable `ErrorCode` (401→UNAUTHORIZED, 404→NOT_FOUND, etc.)
  - Extracts field-level validation errors from `ZodValidationException`
  - Returns real HTTP status codes (not 200 with success:false)
- **Validation**: Global `ZodValidationPipe` (registered in common.module.ts)
  - Request DTOs created via `createZodDto` from zod schemas
  - Validation failures → `error.code=VALIDATION_FAILED` with details array
- **Registration**: All via DI providers in `CommonModule` (apps/api/src/common/common.module.ts)
  - APP_INTERCEPTOR, APP_FILTER, APP_PIPE ensure consistent pipeline

### Request Tracing

`requestIdMiddleware` (apps/api/src/common/middleware/request-id.middleware.ts) assigns per-request correlation id:

- Honors inbound `x-request-id` header ONLY if it matches `^[A-Za-z0-9_-]{1,64}$` (prevents injection)
- Generates `req_<uuid>` otherwise
- Echoed in response `x-request-id` header and `meta.requestId`

## Swagger / OpenAPI

API documentation available at `/docs` (non-production only):

- **Setup**: `setupSwagger()` (apps/api/src/common/swagger/setup-swagger.ts)
- **Mounted when**: `NODE_ENV !== 'production'` (prod/docker set `NODE_ENV=production` → `/docs` not mounted)
- **URL**: http://localhost:3000/docs
- **Auth docs**: Bearer token example provided in OpenAPI config
- **Schema cleanup**: nestjs-zod `cleanupOpenApiDoc` plugin ensures `createZodDto` schemas render correctly

### Documenting Endpoints

Use the `ApiEnvelopeResponse(DataDto)` decorator helper (apps/api/src/common/swagger/api-envelope-response.helper.ts):

```typescript
import { ApiEnvelopeResponse } from '@common/swagger/api-envelope-response.helper';

@Get('/users/:id')
@ApiEnvelopeResponse(UserResponseDto)
getUser(@Param('id') id: string): Promise<UserResponse> { ... }
```

This documents the response as the standard success envelope with the given data type.

## Status

- Scaffold complete with API response contract infrastructure
- Response envelope, validation, tracing, and Swagger setup deployed
- Feature implementation begins per future plans
