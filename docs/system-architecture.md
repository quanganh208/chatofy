# System Architecture

## Type Contract Standard

**Single source of truth** for types across API, web, and mobile. Zod schemas define shape + validation; TypeScript types are `z.infer` of the schema. This eliminates duplication, enforces runtime contracts, and powers Swagger auto-generation.

### Package Layout

**`@chatofy/types`** (`packages/types`)
Dual-build (CommonJS + ESM via tsup) to support both NestJS (CJS) and frontend frameworks (ESM).

- `src/domain/*` — Entity schemas (userSchema, conversationSessionSchema, transcriptSegmentSchema, enum unions)
- `src/http/*` — Wire contracts for HTTP endpoints:
  - `response.ts` — Response envelope: errorCodeSchema, apiMetaSchema, apiErrorSchema; factory functions `apiSuccessSchema(dataSchema)` and `apiResponseSchema(dataSchema)` for wrapping data; type helpers `ApiResponse<T>` and `ApiSuccess<T>`
  - `auth.ts` — Auth endpoints: loginRequestSchema, registerRequestSchema, authTokenSchema, authSessionSchema, authProviderSchema, authProvidersResponseSchema
  - `sessions.ts` — Session endpoints (follows same Request/Response naming)
- `src/events/*` — WebSocket zod schemas (imports canonical domain schemas, e.g., transcriptSegmentSchema)

Naming convention: wire contracts use `Request`/`Response` suffix (NOT `Dto`).

**Build:** `tsconfig.json` stays `composite: true` (for TypeScript project references like `@chatofy/ai-providers`). Build via `tsconfig.build.json` (non-composite) with tsup (generates `.cjs`, `.js`, dual `.d.ts`/`.d.cts`).

**Why dual-build:** API is CommonJS (NestJS with `require()`) and cannot consume ESM-only packages. Dual export ensures both CJS `require()` and ESM `import` work.

**`@chatofy/api-client`** (`packages/api-client`)
Framework-agnostic client for runtime contract validation.

- `createApiClient({ baseUrl, timeoutMs, getHeaders })` — factory returns client instance
- `.apiFetch(path, dataSchema, init?)` — **SINGLE response-parse boundary**
  - `safeParse` against response envelope (validates entire structure)
  - Returns typed data on success or throws:
    - `ApiClientError` — API returned error envelope (e.g., 400 with code=VALIDATION_FAILED)
    - `ContractError` — response shape drifted from schema (e.g., missing field, wrong type)
    - `NetworkError` — transport failure (network, DNS, timeout, abort); carries `timedOut` flag + `cause`
  - Handles 204 No Content (returns empty data object)
  - Status-first error branching: non-JSON 5xx → `ApiClientError` with real HTTP status (not `ContractError`)
  - AbortController timeout (30s default); timeout timer covers body read
- Memoizes envelope schema per data schema for performance

Also dual-built via tsup for frontend+Node compatibility.

### Recipe: Per-Endpoint Contract

1. **Define request + response schemas** in `@chatofy/types/src/http/{domain}.ts`:

   ```typescript
   import { z } from 'zod';

   export const updateUserRequestSchema = z.object({
     name: z.string().min(1),
     email: z.string().email(),
   });
   export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

   export const userResponseSchema = z.object({
     id: z.string().uuid(),
     name: z.string(),
     email: z.string().email(),
     createdAt: z.date(),
   });
   export type UserResponse = z.infer<typeof userResponseSchema>;
   ```

2. **API (NestJS):** Import from root `@chatofy/types` barrel (moduleResolution:node ignores exports subpaths):

   ```typescript
   import { updateUserRequestSchema, userResponseSchema } from '@chatofy/types';

   export class UpdateUserDto extends createZodDto(updateUserRequestSchema) {}
   export class UserResponseDto extends createZodDto(userResponseSchema) {}

   @Patch('/users/:id')
   @ApiEnvelopeResponse(UserResponseDto)
   async updateUser(
     @Param('id') id: string,
     @Body() dto: UpdateUserDto
   ): Promise<UserResponse> {
     // dto validated by pipe; return data (TransformInterceptor wraps in envelope)
   }
   ```

3. **Mobile + Web clients:** Use `@chatofy/api-client`:

   ```typescript
   import { createApiClient } from '@chatofy/api-client';
   import { userResponseSchema } from '@chatofy/types';

   const api = createApiClient({
     baseUrl: env.apiUrl,
     getHeaders: () => ({ Authorization: `Bearer ${token}` }),
   });

   const user = await api.apiFetch('/users/123', userResponseSchema);
   // user: UserResponse (typed + runtime-validated)
   // throws ApiClientError or ContractError on failure
   ```

### Enforcement

- **Compile-time:** `pnpm turbo run typecheck` catches type drift (schema ↔ usage)
- **Runtime:** Client `safeParse` catches shape/data drift at parse boundary
- **Test coverage:** E2E tests verify envelope structure + client error handling

### Caveats

- **Error message sanitization** is enforced by `AllExceptionsFilter` (5xx → generic, 4xx → sanitized), NOT by schema. Document in exception handling, not types.
- **API imports** pull from root barrel only (`@chatofy/types`, NOT subpaths like `@chatofy/types/http`). Ensures consistency; NestJS uses `moduleResolution: "node"` which ignores TypeScript `exports` subpaths.
- **Output schemas stay permissive** (e.g., don't require all fields) so legacy API responses don't break client parsing. Input schemas strict (validate format, required fields).

---

## Response Envelope Architecture

All HTTP responses (except `/health*` probes) follow a standard envelope with metadata and error handling.

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

- **Envelope type:** `ApiResponse<T>` (packages/types/src/http/response.ts)
- **Success wrapping:** `TransformInterceptor` (apps/api/src/common/interceptors/transform.interceptor.ts)
  - Wraps raw controller returns in `{ success: true, data, meta }`
  - Skips WebSocket contexts and `/health*` routes
- **Error handling:** `AllExceptionsFilter` (apps/api/src/common/filters/all-exceptions.filter.ts)
  - Maps HTTP status → stable `ErrorCode` (401→UNAUTHORIZED, 404→NOT_FOUND, etc.)
  - Extracts field-level validation errors from `ZodValidationException`
  - Returns real HTTP status codes (not 200 + success:false) for proper proxy/cache/monitoring behavior
- **Validation:** Global `ZodValidationPipe` (registered in common.module.ts)
  - Request DTOs created via `createZodDto(schema)` from `@chatofy/types`
  - Validation failures → `error.code=VALIDATION_FAILED` with details array
- **Registration:** All via DI providers in `CommonModule` (apps/api/src/common/common.module.ts)
  - APP_INTERCEPTOR, APP_FILTER, APP_PIPE ensure consistent pipeline

### Request Tracing

`requestIdMiddleware` (apps/api/src/common/middleware/request-id.middleware.ts) assigns per-request correlation id:

- Honors inbound `x-request-id` header ONLY if it matches `^[A-Za-z0-9_-]{1,64}$` (prevents injection)
- Generates `req_<uuid>` otherwise
- Echoed in response `x-request-id` header and `meta.requestId`

### Swagger / OpenAPI

API documentation available at `/docs` (non-production only):

- **Setup:** `setupSwagger()` (apps/api/src/common/swagger/setup-swagger.ts)
- **Mounted when:** `NODE_ENV !== 'production'`
- **URL:** http://localhost:3000/docs
- **Schema cleanup:** nestjs-zod `cleanupOpenApiDoc` plugin ensures `createZodDto` schemas render correctly

#### Documenting Endpoints

Use `ApiEnvelopeResponse(DataDto)` helper (apps/api/src/common/swagger/api-envelope-response.helper.ts):

```typescript
import { ApiEnvelopeResponse } from '@common/swagger/api-envelope-response.helper';

@Get('/users/:id')
@ApiEnvelopeResponse(UserResponseDto)
getUser(@Param('id') id: string): Promise<UserResponse> { ... }
```

This documents the response as the standard envelope with the given data type.

---

## AI Provider Abstraction

All AI integrations (STT, Translation, TTS, Realtime) are behind interfaces so implementations can swap without code churn.

**`@chatofy/ai-providers`** (`packages/ai-providers`)

Dual-build (CommonJS + ESM via tsup) for NestJS (CJS require) + frontend (ESM import) compatibility.

- `interfaces/` — Provider contracts: `SttProvider`, `TranslationProvider`, `TtsProvider`, `RealtimeProvider`
  - Each provider declares `readonly name: string` for logging
  - `TtsProvider` additionally declares `readonly outputMimeType` (ElevenLabs → `audio/mpeg`, VieNeu → `audio/wav`)
- `errors/` — Typed error classes: abstract `ProviderError` base + `ProviderResponseError` (non-2xx/malformed, carries `status`), `ProviderConnectionError` (transport, carries `cause`), `ProviderConfigError`, `ProviderNotImplementedError`
- `providers/` — Concrete implementations:
  - `ElevenLabsSttProvider` — STT via ElevenLabs Scribe v2 API (raw fetch)
  - `GeminiTranslationProvider` — Translation via Google Gemini API (@google/genai SDK)
  - `ElevenLabsTtsProvider` — TTS via ElevenLabs TTS API (raw fetch, `audio/mpeg`)
  - `VieNeuTtsProvider` — TTS via local VieNeu sidecar (`services/vieneu-tts`, HTTP, `audio/wav` 48kHz)
  - `LocalSpeechSttProvider` — STT via local sherpa-onnx sidecar (`services/local-stt`, HTTP multipart); one backend serves both languages, the sidecar picks Zipformer-30M for `vi` and Moonshine base for `en`
  - `LocalSpeechTtsProvider` — TTS via local sherpa-onnx sidecar (`services/local-tts`, HTTP, `audio/wav`, Kokoro-82M, English only)
- `profiles/quality-profile.ts` — Quality buckets (0–0.34 budget, 0.34–0.67 standard, 0.67–1.0 premium) mapping client slider to model tiers + Gemini thinking budget
  - Local providers ignore these tiers — each runs a single fixed model, so the slider only affects the translation model
- `registry/` — `ProviderRegistry` (typed via `ProviderKindMap` mapped type) + `AiProvidersFactory`
  - Registry holds implementations by kind (stt/translation/tts/realtime) and name, resolved at runtime
  - Factory builds provider trio from registry (no name-construction conditionals)
  - Default providers registered at composition root (`apps/api/src/modules/translate/providers/register-default-providers.ts`)

Lazy config validation: API boots without keys; missing config only errors when `/translate` is called. With the local defaults the common failure shifts from `ProviderConfigError` (missing key) to `ProviderConnectionError` (sidecar not running) — both map to HTTP 503.

### Speech backend routing

| Stage       | Language | Default backend            | Where it runs               |
| ----------- | -------- | -------------------------- | --------------------------- |
| STT         | vi       | `local` → Zipformer-30M    | `services/local-stt` :8002  |
| STT         | en       | `local` → Moonshine base   | `services/local-stt` :8002  |
| TTS         | en       | `local` → Kokoro-82M       | `services/local-tts` :8003  |
| TTS         | vi       | `vieneu` → VieNeu v3 Turbo | `services/vieneu-tts` :8001 |
| Translation | both     | `gemini`                   | **Google Cloud**            |

`AI_STT_PROVIDER` and `AI_TTS_PROVIDER` default to `local`; setting either to
`elevenlabs` restores the cloud path for comparison. TTS is routed by output
language inside `AiProvidersFactory`, so Vietnamese output always reaches VieNeu
regardless of `AI_TTS_PROVIDER`.

**Machine translation remains a cloud call**, so a translation turn is never
fully offline. Speech is the only part that was localized.

Vietnamese transcripts are sentence-cased inside the STT sidecar: the Zipformer
decoder emits bare uppercase with no punctuation, while Moonshine emits
sentence-cased prose, and `sourceText` is user-visible.

---

## Data Flow

### Translation Pipeline (POST /translate)

1. **Client Request** → `@chatofy/api-client.apiFetch('/translate', schema)` with `{ audioBase64, audioMimeType, quality, direction?, voice? }` (`direction`: `vi_to_en` default | `en_to_vi`; `voice`: VieNeu preset for en→vi)
2. **Request Validation** → `ZodValidationPipe` validates DTO
3. **Controller** (`TranslateController.translate()`) → Decode base64 audio, call service
4. **Pipeline** (`PipelineTranslatorService.translateTurn()`):
   - Derive `{ source, target }` languages from `direction`
   - Resolve quality profile from slider value (0–0.34 / 0.34–0.67 / 0.67–1.0 bucket)
   - Build provider trio via `AiProvidersFactory.makeProviders(profile, target)` — registry resolves each by kind + target language (TTS: target='en' → `AI_TTS_PROVIDER`, target='vi' → always vieneu)
   - **STT:** `provider.transcribe(audio, mimeType, source)` → `sourceText`
   - **Translation:** `provider.translate({ text, sourceLanguage: source, targetLanguage: target })` → `targetText` (thinking budget varies by tier)
   - **TTS:** `provider.synthesize(text, target)` → audio bytes; `audioMimeType` read from `provider.outputMimeType`
   - Return `{ sourceText, targetText, audioBase64, audioMimeType, quality }`
5. **Response Wrapping** → `TransformInterceptor` wraps in envelope + metadata
6. **Client Parse** → `apiFetch` safeParse against schema; returns typed `TranslateResponse` or throws

**Error Handling:**

- `ProviderResponseError` (non-2xx/malformed) → `ServiceUnavailableException` (HTTP 503)
- `ProviderConnectionError` (transport) → `ServiceUnavailableException` (HTTP 503)
- `ProviderConfigError` (missing keys) → `ServiceUnavailableException` (HTTP 503)
- No speech detected → `BadRequestException` (HTTP 400)
- All errors mapped by `AllExceptionsFilter` to error envelope

### Standard Request/Response

1. **Client Request** → `@chatofy/api-client.apiFetch(path, schema)` with optional headers/init
2. **Request Validation** → NestJS `ZodValidationPipe` validates DTO against schema
3. **Controller Logic** → Raw return value (no manual wrapping)
4. **Response Wrapping** → `TransformInterceptor` wraps in envelope + metadata
5. **Client Parse** → `apiFetch` safeParse against schema; returns typed data or throws

**Error Path:**

- Validation/business logic error → `AllExceptionsFilter` maps to error envelope
- Client receives error envelope → `apiFetch` throws `ApiClientError` (with code/message) or `ContractError` (drift)

---

## Module Organization

**API:**

- `common/` — shared interceptors, filters, pipes, middleware, Swagger setup, types
- `modules/` — feature modules:
  - `translate/` — `POST /translate` (V1: vi→en turn-based voice translation, no auth)
    - `translate.controller.ts` — HTTP handler
    - `services/pipeline-translator.service.ts` — Orchestrates STT → translate → TTS
    - `services/noop-translator.service.ts` — Async stub for `/ws/translate` gateway (unimplemented)
    - `providers/ai-providers.factory.ts` — Resolves provider trio from registry by kind + quality profile
    - `providers/register-default-providers.ts` — Composition root: registers concrete providers to registry at module init
    - `interfaces/translator-service.interface.ts` — Contract for async (`PipelineTranslatorService`) and streaming (future)
  - `auth/`, `users/`, `sessions/` — Additional modules (scaffolded, stubs async; `NoopAuthAdapter`, `PrismaUserRepository`, `MemorySessionStore` returns defensive copies)

**Web:**

- `app/translate/page.tsx` — Test UI composition root: direction toggle (vi↔en), VieNeu voice picker (en→vi), record audio, quality slider, result display + playback
  - `src/hooks/use-translate-turn.ts` — Request state machine for one translation turn (loading/result/error + elapsed timer + autoplay)
  - `src/components/translate/` — Presentational pieces: `direction-toggle`, `voice-picker`, `quality-card`, `result-card`, `audio-source-controls`
- VieNeu preset voice list is shared via `VIENEU_VOICES` in `@chatofy/types` (sidecar `GET /voices` stays the runtime source of truth)

**Clients:**

- Web + Mobile consume `@chatofy/api-client` (not per-app implementations)

---

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`):

- Lint (ESLint)
- Typecheck (`pnpm turbo run typecheck` catches schema ↔ usage drift)
- Build (API + Web + Mobile)

Deployed to production with `NODE_ENV=production` (disables Swagger `/docs`).
