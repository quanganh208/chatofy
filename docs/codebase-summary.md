# Codebase Summary

Monorepo for **Chatofy** — realtime Vietnamese ↔ English voice translator.

## Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Mobile:** Expo SDK 52 (React Native) + expo-router
- **API:** NestJS 11 + Fastify + Prisma + WebSocket
- **Web:** Next.js 15 App Router (landing placeholder)
- **DB:** Postgres 16 (via Prisma); Redis planned for multi-instance session state (no client dependency yet)
- **Language:** TypeScript strict + zod runtime validation

## Layout

```
chatofy/
├── apps/
│   ├── api/       # NestJS gateway (:3000, /ws/translate — turn + live modes)
│   ├── mobile/    # Expo RN (MVP surface)
│   ├── web/       # Next.js app (:3001) — marketing landing, hub, translator, settings
│   └── extension/ # Chrome MV3 meeting translator (WXT; load unpacked)
├── packages/
│   ├── config/    # tsconfig/eslint/prettier presets (@chatofy/config)
│   ├── types/     # SINGLE source: zod schemas (domain + HTTP contracts) (@chatofy/types)
│   ├── api-client/    # framework-agnostic API client w/ runtime contract validation (@chatofy/api-client)
│   ├── ai-providers/  # STT/MT/TTS/Realtime interfaces + registry (@chatofy/ai-providers)
│   ├── realtime-client/ # audio capture, turn policy, ordering, /ws/translate client (@chatofy/realtime-client)
│   ├── i18n/      # every user-facing string, en + vi, parity enforced by tsc (@chatofy/i18n)
│   └── ui/        # shadcn primitives + this product's compositions, tokens (@chatofy/ui)
├── docker-compose.yml  # postgres + redis local dev
├── .github/workflows/  # CI (lint / typecheck / build)
└── docs/               # this directory
```

## Interface-First Design Points

All external integrations are hidden behind interfaces so impls can swap without code churn:

| Interface                             | Location                                                              | Default/Concrete impl                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `RealtimeProvider`                    | `packages/ai-providers/src/interfaces/realtime-provider.ts`           | `GeminiLiveTranslateProvider` (`gemini-3.5-live-translate-preview`) — speech to speech in one stream, for comparison against the trio below |
| `SttProvider`                         | `packages/ai-providers/src/interfaces/stt-provider.ts`                | `LocalSpeechSttProvider` (vi+en), `ElevenLabsSttProvider` (scribe_v2)                                                                       |
| `TranslationProvider`                 | `packages/ai-providers/src/interfaces/translation-provider.ts`        | `GeminiTranslationProvider` (3.5-flash-lite → 3.1-flash-lite)                                                                               |
| `TtsProvider`                         | `packages/ai-providers/src/interfaces/tts-provider.ts`                | `LocalSpeechTtsProvider` (vi+en), `ElevenLabsTtsProvider` (flash_v2_5/turbo)                                                                |
| `SummarizationProvider`               | `packages/ai-providers/src/interfaces/summarization-provider.ts`      | `GeminiSummarizationProvider` (3.5-flash → 3.5-flash-lite) — one JSON pass for meeting minutes over a finished conversation                 |
| `MinutesStore` (`MINUTES_STORE`)      | `apps/api/src/modules/minutes/interfaces/minutes-store.interface.ts`  | `MemoryMinutesStore` (Prisma impl deferred)                                                                                                 |
| `AuthAdapter` (`AUTH_ADAPTER` symbol) | `apps/api/src/modules/auth/interfaces/auth-adapter.interface.ts`      | `JwtAuthAdapter` — the API signs and verifies its own access tokens                                                                         |
| `UserRepository` (`USER_REPOSITORY`)  | `apps/api/src/modules/users/interfaces/user-repository.interface.ts`  | `PrismaUserRepository`                                                                                                                      |
| `SessionStore` (`SESSION_STORE`)      | `apps/api/src/modules/sessions/interfaces/session-store.interface.ts` | `MemorySessionStore`                                                                                                                        |
| `StreamSocket`                        | `apps/api/src/modules/translate/session/stream-socket.ts`             | any `ws` connection (structural — the state machine only pushes events); the session service re-exports it for existing importers           |
| `IAudioRecorder` / `IAudioPlayer`     | `apps/mobile/src/audio/*.interface.ts`                                | (impl deferred)                                                                                                                             |

**Error Hierarchy:** `@chatofy/ai-providers` exports typed error classes: abstract `ProviderError` base; `ProviderResponseError` (non-2xx/malformed response with `status`), `ProviderConnectionError` (transport failure with `cause`), `ProviderConfigError`, `ProviderNotImplementedError`. All providers throw these; consume via `instanceof` checks.

**Registry & Factory:** `ProviderRegistry` (typed via `ProviderKindMap` mapped type) holds provider implementations by kind (stt/translation/tts/realtime/speakerEmbedding/summarization) and name. `AiProvidersFactory` resolves from registry by name; no provider-name construction conditionals. Default providers wired at composition root (`apps/api/src/modules/translate/providers/register-default-providers.ts`).

**TtsProvider Output Format:** Each `TtsProvider` declares readonly `outputMimeType` (ElevenLabs → `audio/mpeg`, local → `audio/wav`). Pipeline reads it; per-language MIME maps deleted.

**Retired:** Per-app `IApiClient` / `FetchApiClient` (mobile, web) replaced by unified `@chatofy/api-client` package.

**V1 Translation Pipeline:**

- **STT:** `LocalSpeechSttProvider` by default (`AI_STT_PROVIDER=local`) — one backend for both languages; the `services/local-stt` sidecar picks Zipformer-30M for vi and Moonshine base for en. `ElevenLabsSttProvider` (scribe_v2) stays registered for cloud comparison.
- **Translation:** `GeminiTranslationProvider` via `@google/genai` SDK; walks an ordered model list (`gemini-3.5-flash-lite` → `gemini-3.1-flash-lite`), advancing only on a quota rejection since the free tier meters requests per model. No thinking config is sent — the 3.x models reject it. Returns the model that answered so the pipeline logs it. **The only cloud call left in a turn.**
- **TTS:** `LocalSpeechTtsProvider` by default (`AI_TTS_PROVIDER=local`) — one backend for both languages; the `services/local-tts` sidecar picks VieNeu for vi and Kokoro-82M for en, and resolves the requested `voiceGender` against that engine's own female/male pair. `ElevenLabsTtsProvider` stays registered for cloud comparison and always speaks in its configured voice.
- **Model selection:** owned by each provider, with no selection layer above them — Gemini holds the quota-ordered list, the ElevenLabs providers default to `scribe_v2` / `eleven_flash_v2_5`, and the local sidecars take no model argument at all
- **Provider reuse:** `AiProvidersFactory` memoizes the provider trio per backend selection so clients/connections persist across requests

## Entry Points

| App    | Dev command                  | URL / Entry                                                      |
| ------ | ---------------------------- | ---------------------------------------------------------------- |
| api    | `pnpm --filter api dev`      | http://localhost:3000 (REST: POST /translate, WS: /ws/translate) |
| web    | `pnpm --filter web dev`      | http://localhost:3001 — see the route table below                |
| mobile | `pnpm --filter mobile start` | Expo dev client / simulator                                      |

**Web routes.** Three route groups, absent from the URLs and each carrying its own chrome
(`apps/web/app/`):

| Route                                                                         | Group         | Session  |
| ----------------------------------------------------------------------------- | ------------- | -------- |
| `/`                                                                           | `(marketing)` | public   |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email` | `(auth)`      | public   |
| `/locale`                                                                     | route handler | public   |
| `/dashboard`, `/translate`, `/preferences`, `/account`                        | `(app)`       | required |
| `/translate/live`, `/translate/baseline`                                      | own layout    | required |

`/translate/live` is the continuous-mode experiment and `/translate/baseline` the latency
comparison. Both are reachable by URL and linked from nothing — deliberately, and
`app-chrome.spec.tsx` fails if either appears in the nav. Which routes are public is
decided in one place, `apps/web/proxy.ts`; everything else redirects to `/login` carrying
where it was turned away from.

Every route is server-rendered on demand, including `/`. That is the locale cookie read in
the root layout, and it is the accepted price of one URL serving two languages — see
`apps/web/src/i18n/server.ts`.

**API Endpoints (V1):**

- `POST /translate` — Turn-based vi↔en audio translation (request: `{ audioBase64, audioMimeType, direction?, voiceGender? }`, response: `{ sourceText, targetText, audioBase64, audioMimeType }`)
- `WS /ws/translate` — One path, two modes, chosen by the first message the client sends and fixed for that connection:
  - `client.session.start` → turn-based cascade (STT → translate → TTS), contract `clientEventSchema` / `serverEventSchema`
  - `client.live.start` → continuous speech-to-speech, contract `liveClientEventSchema` / `liveServerEventSchema`
  - The two contracts are separate unions and are not merged. A start from the other family on a claimed connection is refused with a `mode_conflict` error in that family's own vocabulary; open a second connection instead.
- `GET /auth/me` — the caller's own profile: id, email, name, `locale`, `createdAt`. Guarded
- `PATCH /auth/me` — changes the language this account's MAIL is written in. Guarded, and it names
  no user id: which row changes is decided by the verified token. Strict about the value,
  unlike `POST /auth/register` and `POST /auth/forgot-password`, which coerce an
  unsupported `locale` — those two answer identically for every address, and a schema
  error on one request and a 202 on another is a difference an attacker can read
- `GET /docs` — OpenAPI/Swagger (non-production only)
- `GET /health` — Liveness probe (raw, no envelope). Liveness only: it answers from process state and touches no dependency, so it never reports on the database.

## Env Files

Each app has `.env.example`. Copy to `.env` per app. Root `.env.example` documents Docker Compose overrides.

**Web env (apps/web/.env.example):** `AUTH_SECRET` is required — it signs the session cookie, and `next build` needs it too because `/login` is prerendered. `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are optional and enable the Google button only when both are set. All three are server-only and live in `src/config/server-env.ts` behind `import 'server-only'`, never in `src/config/env.ts` — that module parses at import time and is imported by `'use client'` hooks, so a required key there throws in the browser.

**API env (apps/api/.env.example):**

- `AUTH_JWT_SECRET` (**required**, min 32 chars) — signs and verifies every access token the API issues, and derives the keys for verification and reset links. There is no "auth off" mode, so the app refuses to boot without it. Rotating it signs every user out at once — still the only blanket revocation, though a password reset now invalidates one user's earlier tokens and closes their open sockets
- `WEB_BASE_URL` (default `http://localhost:3001`) — the origin every mailed link is built from. **Never taken from the `Host` header**, which is attacker-controlled and would make a reset link point wherever the attacker chose. Production refuses to boot while this is still the default
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` — Gmail SMTP, using an **app password** (which needs 2FA on the account). All four or none: with any missing, development and test print the link to the console instead, and production refuses to boot
- `MAIL_FROM` — display name on outbound mail. The address itself must be `SMTP_USER` or Gmail rewrites it
- `GOOGLE_CLIENT_IDS` — comma-separated OAuth client ids whose id_tokens `POST /auth/google` will accept (lazy validation; unset disables that route with a clear error rather than blocking the boot). Web's `AUTH_GOOGLE_ID` must appear in this list
- `AI_STT_PROVIDER` (default: `local`) — STT implementation selector
- `AI_TRANSLATION_PROVIDER` (default: `gemini`) — Translation implementation selector
- `AI_TTS_PROVIDER` (default: `local`) — TTS implementation selector
- `ELEVENLABS_API_KEY` — ElevenLabs API key (lazy validation; only needed when a provider above is set to `elevenlabs`)
- `GEMINI_API_KEY` — Google Gemini API key, or several comma-separated to rotate across (lazy validation; required to call `/translate`). Several keys only raise the quota ceiling when they come from different Google Cloud projects
- `ELEVENLABS_TTS_VOICE_ID` — Voice ID for ElevenLabs TTS synthesis; unset takes the provider's own default (`Rachel`)
- `LOCAL_STT_URL` / `LOCAL_TTS_URL` — local speech sidecars (`services/local-stt` :8002, `services/local-tts` :8003)

The continuous speech-to-speech backend has **no** env selector. `gemini-live` is named once, at the provider composition root (`apps/api/src/modules/translate/providers/register-default-providers.ts`), and the live session path imports that name. There is one implementation, so a selector would be a knob with one position; adding a second means adding a `register()` call and a way to choose between them. It uses `GEMINI_API_KEY`, first key only — a live session connects once and holds, so it has no point at which to rotate.

### Choosing cascade or live

Purely a **client** choice, and there is nothing to configure on the server to match it: both backends are served on `/ws/translate` and are told apart by which start message goes out first (`client.session.start` vs `client.live.start`). The mode union is `TranslateMode` in `@chatofy/types`.

| Client    | Where the choice lives                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------- |
| web       | Toggle on `/translate`; one panel mounted at a time (`cascade-panel.tsx` / `live-panel.tsx`), held while a session runs |
| extension | `Mode` in the popup, stored as `CaptureSettings.mode`; changing it mid-call has the worker reopen the capture           |

In the extension both directions of one meeting always run the same mode. `createDirectionSession` routes on the setting and returns either a `ConversationSession` or a `LiveDirectionSession` — `MeetingCapture` drives whichever it is handed through the `DirectionRunner` interface and does not know which it holds. Three things differ on the live path: capture runs ungated through `MicrophoneGraph`, ducking follows audible audio rather than open turns (there are none to count), and transcript text appends to one line per direction instead of a turn per sentence. `voiceGender` is inert in live mode — the model has its own voice, and the popup disables the control rather than leaving it doing nothing.

## CI

GitHub Actions (`.github/workflows/ci.yml`) — lint, typecheck, build jobs on PR + push to `main`.

**Dead-code gate (manual):** `pnpm knip` (config: root `knip.json`) reports unused files/exports/dependencies across all workspaces. A clean run exits 0 with no findings.

The script pins `KNIP_DISABLE_RAW_TRANSFER=1` (via `cross-env`, since Windows `cmd` rejects POSIX env prefixes). Without it, knip parses through oxc-parser's raw-transfer fast path, which reserves a single 6 GiB `ArrayBuffer`. That reservation is free on Linux but charges against the Windows commit limit, so on a machine with less than ~6 GiB of commit headroom knip aborts with `RangeError: Array buffer allocation failed` before reporting anything — and `--max-old-space-size` cannot help, because the buffer lives outside the V8 heap. oxc-parser's own `rawTransferSupported()` probe only checks CPU architecture and Node version, never whether the allocation can actually succeed, so the fast path has to be switched off explicitly. Parsing is slower without it; for a manual gate that runs occasionally, running everywhere beats running fast.

Intentional interface-first stubs are excluded via `ignore`/`ignoreDependencies` entries plus `@public` JSDoc tags on scaffold exports. `knip.json` is plain JSON and cannot carry comments, so each exclusion's rationale lives here:

| Exclusion                                                                        | Why knip can't see the usage                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swagger-ui-express` (api)                                                       | `@nestjs/swagger` requires it dynamically at runtime on the Express platform                                                                                                                                                                                                                                                 |
| `tailwindcss` (web)                                                              | pulled in by `@import 'tailwindcss'` in `globals.css`; knip does not parse CSS                                                                                                                                                                                                                                               |
| `@chatofy/config` (api, api-client)                                              | both tsconfigs extend the preset by relative path (package-specifier extends breaks knip's symlink resolution); the dep stays to express the workspace edge                                                                                                                                                                  |
| `next`, `eslint-config-*` (packages/config)                                      | preset files are data, not source — nothing imports them inside the workspace                                                                                                                                                                                                                                                |
| `expo-updates` (mobile)                                                          | Expo plugin quirk; `app.json` declares no updates config                                                                                                                                                                                                                                                                     |
| `to-user.mapper.ts` (api)                                                        | part of the users-persistence stub cluster, kept by the interface-first decision                                                                                                                                                                                                                                             |
| `audio-player.interface.ts`, `audio-recorder.interface.ts` (mobile)              | scaffold interfaces awaiting native implementations                                                                                                                                                                                                                                                                          |
| `useAuth`, `useTheme`, `spacing`, `radii`, `typography` (mobile)                 | auth/theme scaffold consumer surface; the providers are mounted                                                                                                                                                                                                                                                              |
| `buttonVariants`, `CardFooter` (web)                                             | shadcn vendored-component convention surface                                                                                                                                                                                                                                                                                 |
| `Tabs*`, `Toggle`, `toggleVariants`, unused `sidebar.tsx` variants (packages/ui) | shipped without a consumer on purpose. `Tabs` is the shape for a surface that switches between panels, and nothing does today — the three translate routes are routes. `sidebar.tsx` is generated whole and left whole, because editing a generated primitive forks it from the upstream the next `shadcn add` would rewrite |
| `TranslateTurnOptions` (web)                                                     | appears in the exported `runTranslate` hook signature                                                                                                                                                                                                                                                                        |
| `ignoreBinaries: ["blue,magenta"]`                                               | knip misreads `concurrently -c blue,magenta` in the root `dev:all` script as a binary name                                                                                                                                                                                                                                   |

Husky hooks must stay LF-terminated (`.gitattributes` enforces it) — CRLF made knip read the binary as `lint-staged\r` and report the root devDependency as unused.

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

Request: `{ "audioBase64": "...", "audioMimeType": "audio/webm" }`

Success (201 — Nest's default for POST):

```json
{
  "success": true,
  "data": {
    "sourceText": "Xin chào",
    "targetText": "Hello",
    "audioBase64": "//NExAAqQA0gAACAA==",
    "audioMimeType": "audio/mpeg"
  },
  "meta": { "requestId": "req_abc123", "timestamp": "2026-06-06T10:00:00Z" }
}
```

### Implementation

- **Envelope type**: `ApiResponse<T>` (packages/types/src/http/response.ts)
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
  - `POST /translate` endpoint: vi↔en turn-based audio translation
  - STT + TTS run on the local sidecars by default; Gemini translation is the only cloud call
  - Web is a full surface: marketing landing, post-login hub, the translator, preferences
    and account, in English and Vietnamese
  - All contracts in `@chatofy/types` + dual-build packages
- **Scaffold & Infrastructure:**
  - API response contract infrastructure (envelope, validation, tracing)
  - Swagger/OpenAPI at `/docs` (non-prod)
  - `@chatofy/types`, `@chatofy/api-client`, `@chatofy/ai-providers` packages
- **Out of Scope (V1):** Auth, DB persistence, WS streaming, multi-turn context, language pairs beyond vi→en
