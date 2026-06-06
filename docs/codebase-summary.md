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

| Interface                                  | Location                                                                    | Default/Concrete impl                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `RealtimeProvider`                         | `packages/ai-providers/src/interfaces/realtime-provider.ts`                 | none (impl later)                                                           |
| `SttProvider`                              | `packages/ai-providers/src/interfaces/stt-provider.ts`                      | `ElevenLabsSttProvider` (scribe_v2)                                         |
| `TranslationProvider`                      | `packages/ai-providers/src/interfaces/translation-provider.ts`              | `GeminiTranslationProvider` (gemini-2.5)                                    |
| `TtsProvider`                              | `packages/ai-providers/src/interfaces/tts-provider.ts`                      | `ElevenLabsTtsProvider` (flash_v2_5/turbo)                                  |
| `AuthAdapter` (`AUTH_ADAPTER` symbol)      | `apps/api/src/modules/auth/interfaces/auth-adapter.interface.ts`            | `NoopAuthAdapter`                                                           |
| `UserRepository` (`USER_REPOSITORY`)       | `apps/api/src/modules/users/interfaces/user-repository.interface.ts`        | `PrismaUserRepository` (stub)                                               |
| `SessionStore` (`SESSION_STORE`)           | `apps/api/src/modules/sessions/interfaces/session-store.interface.ts`       | `MemorySessionStore`                                                        |
| `TranslatorService` (`TRANSLATOR_SERVICE`) | `apps/api/src/modules/translate/interfaces/translator-service.interface.ts` | `PipelineTranslatorService` (async), `NoopTranslatorService` (gateway stub) |
| `IAudioRecorder` / `IAudioPlayer`          | `apps/mobile/src/audio/*.interface.ts`                                      | (impl deferred)                                                             |

**Retired:** Per-app `IApiClient` / `FetchApiClient` (mobile, web) replaced by unified `@chatofy/api-client` package.

**V1 Translation Pipeline:**

- **STT:** `ElevenLabsSttProvider` (scribe_v2) via raw fetch; `@chatofy/types` contract `SttProvider.transcribe(audio, mimeType, language)`
- **Translation:** `GeminiTranslationProvider` via `@google/genai` SDK; models: `gemini-2.5-flash-lite` then `gemini-2.5-flash` (top tier reuses `gemini-2.5-flash`); thinking disabled (budget 0) on all tiers — it adds latency without translation gain; language pair vi→en
- **TTS:** `ElevenLabsTtsProvider` via raw fetch; models: `eleven_flash_v2_5`, `turbo_v2_5`, `multilingual_v2`; voice: configurable via `ELEVENLABS_TTS_VOICE_ID` (default Rachel)
- **Quality Profile:** Buckets client slider (0..1) to model tiers: [0–0.34) `flash-lite` + flash voice, [0.34–0.67) `flash` + turbo voice, [0.67–1.0] `flash` + premium `multilingual_v2` voice (top tier signals quality via voice, not a heavier model; `gemini-2.5-pro` retired — quota-gated, no translation benefit)
- **Provider reuse:** `AiProvidersFactory` memoizes the provider trio per tier so the `GoogleGenAI` client + keep-alive connections persist across requests

## Entry Points

| App    | Dev command                  | URL / Entry                                                  |
| ------ | ---------------------------- | ------------------------------------------------------------ |
| api    | `pnpm --filter api dev`      | http://localhost:3000 (REST: POST /translate, /ws/translate) |
| web    | `pnpm --filter web dev`      | http://localhost:3001 (landing + /translate test UI)         |
| mobile | `pnpm --filter mobile start` | Expo dev client / simulator                                  |

**API Endpoints (V1):**

- `POST /translate` — Turn-based vi→en audio translation (request: `{ audioBase64, audioMimeType, quality: 0..1 }`, response: `{ sourceText, targetText, audioBase64, audioMimeType, quality }`)
- `GET /docs` — OpenAPI/Swagger (non-production only)
- `GET /health*` — Health probes (raw, no envelope)

## Env Files

Each app has `.env.example`. Copy to `.env` per app. Root `.env.example` documents Docker Compose overrides.

**API env (apps/api/.env.example):**

- `AI_STT_PROVIDER` (default: `elevenlabs`) — STT implementation selector
- `AI_TRANSLATION_PROVIDER` (default: `gemini`) — Translation implementation selector
- `AI_TTS_PROVIDER` (default: `elevenlabs`) — TTS implementation selector
- `ELEVENLABS_API_KEY` — ElevenLabs API key (lazy validation; required to call `/translate`)
- `GEMINI_API_KEY` — Google Gemini API key (lazy validation; required to call `/translate`)
- `ELEVENLABS_TTS_VOICE_ID` (default: `Rachel`) — Voice ID for TTS synthesis

## CI

GitHub Actions (`.github/workflows/ci.yml`) — lint, typecheck, build jobs on PR + push to `main`.

## HTTP Contract

### Types & Schemas

All types live in `@chatofy/types` (dual CJS+ESM build via tsup):

- `src/http/translate.ts` — `translateRequestSchema`, `TranslateRequest`, `translateResponseSchema`, `TranslateResponse`
- `src/http/response.ts` — `ApiResponse<T>`, `apiSuccessSchema()`, `apiResponseSchema()` factory helpers

### Response Envelope

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

**Example: POST /translate**

Request: `{ "audioBase64": "...", "audioMimeType": "audio/webm", "quality": 0.75 }`

Success (200):

```json
{
  "success": true,
  "data": {
    "sourceText": "Xin chào",
    "targetText": "Hello",
    "audioBase64": "//NExAAqQA0gAACAA==",
    "audioMimeType": "audio/mpeg",
    "quality": 0.75
  },
  "meta": { "requestId": "req_abc123", "timestamp": "2026-06-06T10:00:00Z" }
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

- **V1 Translation Pipeline (V1 COMPLETE):**
  - `POST /translate` endpoint: vi→en turn-based audio translation
  - STT (ElevenLabs Scribe), Translation (Gemini), TTS (ElevenLabs) integrated
  - Quality slider (0..1) → model tier mapping via QualityProfile
  - Web test UI (`/translate`) with record + playback
  - All contracts in `@chatofy/types` + dual-build packages
- **Scaffold & Infrastructure:**
  - API response contract infrastructure (envelope, validation, tracing)
  - Swagger/OpenAPI at `/docs` (non-prod)
  - `@chatofy/types`, `@chatofy/api-client`, `@chatofy/ai-providers` packages
- **Out of Scope (V1):** Auth, DB persistence, WS streaming, multi-turn context, language pairs beyond vi→en
