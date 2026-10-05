# Codebase Summary

Monorepo for **Chatofy** — realtime multilingual voice translator. The supported
languages live in one registry (`packages/types/src/domain/languages.ts`); today
they are Vietnamese and English.

## Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Mobile:** Expo SDK 55 (React Native) + expo-router — still a scaffold
- **API:** NestJS 12 + Express + Prisma + WebSocket (`ws`)
- **Web:** Next.js 16 App Router + Auth.js
- **Extension:** WXT, Chrome MV3
- **DB:** Postgres 16 (via Prisma); Redis (node-redis v5) for rotating refresh-token families
- **Speech:** two Python sidecars in `services/` (local STT, local TTS), run in Docker
- **Language:** TypeScript strict + zod runtime validation

## Layout

```
chatofy/
├── apps/
│   ├── api/       # NestJS gateway (:3000, /ws/translate — turn + live modes)
│   ├── mobile/    # Expo RN (MVP surface)
│   ├── web/       # Next.js app (:3001) — marketing landing, translator, history, settings
│   └── extension/ # Chrome MV3 meeting translator (WXT; load unpacked)
├── packages/
│   ├── config/    # tsconfig/eslint/prettier presets (@chatofy/config)
│   ├── types/     # SINGLE source: zod schemas (domain + HTTP contracts) (@chatofy/types)
│   ├── api-client/    # framework-agnostic API client w/ runtime contract validation (@chatofy/api-client)
│   ├── ai-providers/  # STT/MT/TTS/Realtime interfaces + registry (@chatofy/ai-providers)
│   ├── realtime-client/ # audio capture, turn policy, ordering, /ws/translate client (@chatofy/realtime-client)
│   ├── i18n/      # every user-facing string, en + vi, parity enforced by tsc (@chatofy/i18n)
│   └── ui/        # shadcn primitives + this product's compositions, tokens (@chatofy/ui)
├── services/
│   ├── local-stt/ # speech-to-text sidecar (vi + en) — :8002
│   └── local-tts/ # speech synthesis sidecar (vi + en) — :8003
├── benchmarks/    # measurement harnesses, one directory per question
├── docker-compose.yml  # postgres + redis + both speech sidecars, local dev
├── .github/workflows/  # CI, deploy, main-failure alert
└── docs/               # this directory
```

## Interface-First Design Points

All external integrations are hidden behind interfaces so impls can swap without code churn:

| Interface                                               | Location                                                                                      | Default/Concrete impl                                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `RealtimeProvider`                                      | `packages/ai-providers/src/interfaces/realtime-provider.ts`                                   | `GeminiLiveTranslateProvider` (`gemini-3.5-live-translate-preview`) — speech to speech in one stream, for comparison against the trio below |
| `SttProvider`                                           | `packages/ai-providers/src/interfaces/stt-provider.ts`                                        | `LocalSpeechSttProvider` (vi+en), `ElevenLabsSttProvider` (scribe_v2)                                                                       |
| `TranslationProvider`                                   | `packages/ai-providers/src/interfaces/translation-provider.ts`                                | `GeminiTranslationProvider` (3.5-flash-lite → 3.1-flash-lite); `OpenAiCompatibleTranslationProvider` per host row (`deepseek`, `openai`)    |
| `SpeakerEmbeddingProvider`                              | `packages/ai-providers/src/interfaces/speaker-embedding-provider.ts`                          | `LocalSpeechEmbeddingProvider` — voice vectors from the local-stt sidecar for per-turn speaker attribution                                  |
| `DisplayRestorer`                                       | `packages/ai-providers/src/interfaces/display-restorer.ts`                                    | `LocalSpeechDisplayRestorer` — punctuation and case for the Vietnamese display, from the local-stt sidecar                                  |
| `TtsProvider`                                           | `packages/ai-providers/src/interfaces/tts-provider.ts`                                        | `LocalSpeechTtsProvider` (vi+en), `ElevenLabsTtsProvider` (flash_v2_5/turbo)                                                                |
| `SummarizationProvider`                                 | `packages/ai-providers/src/interfaces/summarization-provider.ts`                              | `GeminiSummarizationProvider` (3.5-flash → 3.5-flash-lite) — one JSON pass for meeting minutes over a finished conversation                 |
| `MinutesStore` (`MINUTES_STORE`)                        | `apps/api/src/modules/minutes/interfaces/minutes-store.interface.ts`                          | `PrismaMinutesStore`, bound unconditionally — the env switch that used to default this to an in-memory store is gone                        |
| `ConversationStore` (`CONVERSATION_STORE`)              | `apps/api/src/modules/conversations/interfaces/conversation-store.interface.ts`               | `PrismaConversationStore` — the stored transcript; exported so the minutes module can generate from it                                      |
| `TranslationContextStore` (`TRANSLATION_CONTEXT_STORE`) | `apps/api/src/modules/translation-contexts/interfaces/translation-context-store.interface.ts` | `PrismaTranslationContextStore` — the saved AI Context library; NOT exported, because the client resolves a context into hints itself       |
| `AuthAdapter` (`AUTH_ADAPTER` symbol)                   | `apps/api/src/modules/auth/interfaces/auth-adapter.interface.ts`                              | `JwtAuthAdapter` — the API signs and verifies its own access tokens                                                                         |
| `RedisClient` (`REDIS_CLIENT` symbol)                   | `apps/api/src/modules/redis/redis-client.provider.ts`                                         | node-redis v5, non-blocking connect and `disableOfflineQueue` so the API boots without Redis; imported by `AuthModule` alone                |
| `UserRepository` (`USER_REPOSITORY`)                    | `apps/api/src/modules/users/interfaces/user-repository.interface.ts`                          | `PrismaUserRepository`                                                                                                                      |
| `AvatarStorage` / `ConversationAudioStorage`            | `apps/api/src/modules/storage/interfaces/*.interface.ts`                                      | R2 implementations when all `R2_*` keys are set, disabled ones otherwise                                                                    |
| `StreamSocket`                                          | `apps/api/src/modules/translate/session/stream-socket.ts`                                     | any `ws` connection (structural — the state machine only pushes events); the session service re-exports it for existing importers           |
| `IAudioRecorder` / `IAudioPlayer`                       | `apps/mobile/src/audio/*.interface.ts`                                                        | (impl deferred)                                                                                                                             |

**Error Hierarchy:** `@chatofy/ai-providers` exports typed error classes from `packages/ai-providers/src/errors/provider-errors.ts`, under an abstract `ProviderError` base. All providers throw these; consume via `instanceof` checks.

**Registry & Factory:** `ProviderRegistry` (typed via `ProviderKindMap` mapped type) holds provider implementations by kind (the keys of `ProviderKindMap`) and name. `AiProvidersFactory` resolves from registry by name; no provider-name construction conditionals. Default providers wired at composition root (`apps/api/src/modules/translate/providers/register-default-providers.ts`).

**TtsProvider Output Format:** Each `TtsProvider` declares readonly `outputMimeType` (ElevenLabs → `audio/mpeg`, local → `audio/wav`). Pipeline reads it; per-language MIME maps deleted.

**Retired:** Per-app `IApiClient` / `FetchApiClient` (mobile, web) replaced by unified `@chatofy/api-client` package.

**V1 Translation Pipeline:**

- **STT:** `LocalSpeechSttProvider` by default (`AI_STT_PROVIDER=local`) — one backend for both languages; the `services/local-stt` sidecar picks Zipformer-30M for vi and Parakeet-TDT-0.6b-v2 for en. `ElevenLabsSttProvider` (scribe_v2) stays registered for cloud comparison.
- **Translation:** `GeminiTranslationProvider` by default (`AI_TRANSLATION_PROVIDER=gemini`), via `@google/genai` SDK; walks an ordered model list (`gemini-3.5-flash-lite` → `gemini-3.1-flash-lite`), advancing only on a quota rejection since the free tier meters requests per model. No thinking config is sent — the 3.x models reject it. Returns the model that answered so the pipeline logs it. Any other `AI_TRANSLATION_PROVIDER` value picks a row of the OpenAI-compatible host table (`deepseek`, `openai`), served by `OpenAiCompatibleTranslationProvider`. **The only cloud call left in a turn.**
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

| Route                                                                             | Group         | Session  |
| --------------------------------------------------------------------------------- | ------------- | -------- |
| `/`                                                                               | `(marketing)` | public   |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`     | `(auth)`      | public   |
| `/locale`                                                                         | route handler | public   |
| `/api/auth/*` (Auth.js)                                                           | route handler | public   |
| `/translate`, `/history`, `/history/[conversationId]`, `/preferences`, `/account` | `(app)`       | required |

Every route the app serves is in a group; there is no unlisted one. Two used to be —
`/translate/live`, the continuous-mode experiment, and `/translate/baseline`, the
single-shot REST page — reachable by URL and linked from nothing. Both are deleted, along
with the plain frame that existed only to give them a way back. What they measured
survives where it is actually measured: `POST /translate` in the API, and
`benchmarks/realtime` for the continuous path. Which routes are public is decided in one
place, `apps/web/proxy.ts`; everything else redirects to `/login` carrying where it was
turned away from.

Every route is server-rendered on demand, including `/`. That is the locale cookie read in
the root layout, and it is the accepted price of one URL serving two languages — see
`apps/web/src/i18n/server.ts`.

**API Endpoints:** the full route set is the `*.controller.ts` files under `apps/api/src/modules/`; Swagger at `/docs` lists them in dev. Not described below: `GET /` (service descriptor), `GET /translate/voices`, the rest of `/auth/*` (register, verify, password reset, login, Google, avatar), `/conversations/*` (history and recordings) and `/conversations/:conversationId/minutes`.

- `POST /translate` — Turn-based audio translation between registered languages (request: `{ audioBase64, audioMimeType, direction?, voiceGender?, speed? }`, response: `{ sourceText, targetText, audioBase64, audioMimeType }`)
- `WS /ws/translate` — One path, two modes, chosen by the first message the client sends and fixed for that connection:
  - `client.session.start` → turn-based cascade (STT → translate → TTS), contract `clientEventSchema` / `serverEventSchema`
  - `client.live.start` → continuous speech-to-speech, contract `liveClientEventSchema` / `liveServerEventSchema`
  - The two contracts are separate unions and are not merged. A start from the other family on a claimed connection is refused with a `mode_conflict` error in that family's own vocabulary; open a second connection instead.
- `POST /auth/refresh` — trades a rotating refresh token for a fresh pair. Public by
  necessity, like login: the access token it renews may already be expired. One-time-use —
  the response carries the successor, and replaying a spent one outside the rotation grace
  window revokes the whole family and closes that user's live sockets. Answers **503, never
  401**, when the token store is unreachable, because every client reads a 401 as proof the
  session is dead
- `POST /auth/revoke` — ends this browser's refresh family on sign-out. Public, `204`
  **whether or not the token matched**, so it is not an oracle for "is this token live" and
  a person leaving is never blocked. Closes no sockets: that is the difference between a
  voluntary sign-out and detected theft
- `GET /auth/me` — the caller's own profile (`userSchema` in `packages/types/src/domain/user.ts`). Guarded
- `PATCH /auth/me` — changes the language this account's MAIL is written in. Guarded, and it names
  no user id: which row changes is decided by the verified token. Strict about the value,
  unlike `POST /auth/register` and `POST /auth/forgot-password`, which coerce an
  unsupported `locale` — those two answer identically for every address, and a schema
  error on one request and a 202 on another is a difference an attacker can read
- `GET /translation-contexts` — the caller's saved AI Context library, newest first. Guarded, throttled, and **unpaged**: bounded at `CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER`, so a cursor would be machinery for a page that can never exist. Read by both the web editor and the extension popup
- `PUT /translation-contexts/:contextId` — create or replace one context. Guarded, throttled, idempotent, and a FULL replacement including the glossary, so a shorter re-save cannot leave a stale tail of pairs. `409` when the account is already at the ceiling and this id is not one it holds; a replace of an existing context is always allowed, or a full library would be uneditable. The owner is the verified token subject and the body carries no user id
- `DELETE /translation-contexts/:contextId` — `204` whether a row went or not, so an id that never existed and one belonging to another account are indistinguishable. The glossary goes with it through the relation cascade
- `GET /docs` — OpenAPI/Swagger (non-production only)
- `GET /health` — Liveness probe (raw, no envelope). Liveness only: it answers from process state and touches no dependency, so it never reports on the database.

## Env Files

Each app has `.env.example`. Copy it to `.env` — except web, which reads `.env.local`. Root `.env.example` documents Docker Compose overrides.

Every template uses two line forms. `KEY=` means unset, which each schema reads as absent. `# KEY=value` is a default that already lives somewhere else — the zod schema for an app, `${KEY:-value}` in `docker-compose.yml` for the root file — shown for reference, so uncomment it only to override. A copied default is a second place to keep in step, and the api schema and its template did drift apart once. Two specs now hold them together: `apps/api/src/config/env.schema.spec.ts` covers `apps/api/.env.example` and `prod.env.example`, `apps/web/src/config/env-example.spec.ts` covers the web template. Each fails if a key goes undocumented, if a template names a key no schema reads, or if a live line restates a default.

**Web env (apps/web/.env.example):** `AUTH_SECRET` is required — it signs the session cookie, and `next build` needs it too because `/login` is prerendered. `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are optional and enable the Google button only when both are set. All three are server-only and live in `src/config/server-env.ts` behind `import 'server-only'`, never in `src/config/env.ts` — that module parses at import time and is imported by `'use client'` hooks, so a required key there throws in the browser.

**API env (apps/api/.env.example):**

- `AUTH_JWT_SECRET` (**required**, min 32 chars) — signs and verifies every access token the API issues, and derives the keys for verification and reset links. There is no "auth off" mode, so the app refuses to boot without it. Rotating it signs every user out at once — still the only blanket revocation, though a password reset now invalidates one user's earlier tokens and closes their open sockets
- `WEB_BASE_URL` (default `http://localhost:3001`) — the origin every mailed link is built from. **Never taken from the `Host` header**, which is attacker-controlled and would make a reset link point wherever the attacker chose. Production refuses to boot while this is still the default
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` — Gmail SMTP, using an **app password** (which needs 2FA on the account). Read only outside development and test, which always print the link to the console whatever is set. Elsewhere all four or none: with any missing, mail is dropped and logged, and production refuses to boot
- `MAIL_FROM` — display name on outbound mail. The address itself must be `SMTP_USER` or Gmail rewrites it
- `GOOGLE_CLIENT_IDS` — comma-separated OAuth client ids whose id_tokens `POST /auth/google` will accept (lazy validation; unset disables that route with a clear error rather than blocking the boot). Web's `AUTH_GOOGLE_ID` must appear in this list
- `REDIS_URL` (default `redis://localhost:6379`) — where rotating refresh-token families
  live. **Defaulted, not required**, and the API boots without a reachable Redis: a
  required value would break every e2e suite at once, and a hard-fail boot would make an
  outage worse than the 503 it already answers with. `pnpm --filter api test:e2e` DOES need
  one running, because six of those suites log in for real and login mints a family
- `AI_STT_PROVIDER` (default: `local`) — STT implementation selector
- `AI_TRANSLATION_PROVIDER` (default: `gemini`) — Translation implementation selector. Production runs `deepseek` since 2026-09-22; any name other than `gemini` selects a row of the OpenAI-compatible host table in `register-default-providers.ts`
- `AI_TTS_PROVIDER` (default: `local`) — TTS implementation selector
- `ELEVENLABS_API_KEY` — ElevenLabs API key (lazy validation; only needed when a provider above is set to `elevenlabs`)
- `GEMINI_API_KEY` — Google Gemini API key, or several comma-separated to rotate across (lazy validation). Required to call `/translate` only while `AI_TRANSLATION_PROVIDER` is `gemini`; it authenticates the realtime and summarization providers regardless, so it stays required in production even though translation moved off it. Several keys only raise the quota ceiling when they come from different Google Cloud projects
- `OPENAI_COMPATIBLE_API_KEY` — the credential for whichever OpenAI-compatible host `AI_TRANSLATION_PROVIDER` names (lazy validation). One variable for the whole family: the endpoint, model and per-host flags live beside the host name in the table, not in env, because a model id only means anything against the endpoint serving it
- `LOCAL_STT_URL` / `LOCAL_TTS_URL` — local speech sidecars (`services/local-stt` :8002, `services/local-tts` :8003)
- `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_BASE_URL` — Cloudflare R2 for avatars and conversation recordings. Optional and read as one unit: with any missing the avatar routes answer 409 and the API still boots

The continuous speech-to-speech backend has **no** env selector. `gemini-live` is named once, at the provider composition root (`apps/api/src/modules/translate/providers/register-default-providers.ts`), and the live session path imports that name. There is one implementation, so a selector would be a knob with one position; adding a second means adding a `register()` call and a way to choose between them. It uses `GEMINI_API_KEY`, first key only — a live session connects once and holds, so it has no point at which to rotate.

### Choosing cascade or live

A **client** choice, and there is nothing to configure on the server to match it: both backends are served on `/ws/translate` and are told apart by which start message goes out first (`client.session.start` vs `client.live.start`). The mode union is `TranslateMode` in `@chatofy/types`. No shipped client offers live today:

| Client    | Where the choice lives                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| web       | No choice: `cascade-panel.tsx` is the only path, and the live route that used to sit beside it is deleted                                     |
| extension | No choice either: the popup no longer offers one, and `loadSettings` (`apps/extension/src/settings.ts`) reads any stored mode back as cascade |

The extension keeps the live path in code. Both directions of one meeting always run the same mode. `createDirectionSession` routes on `CaptureSettings.mode` and returns either a `ConversationSession` or a `LiveDirectionSession` — `MeetingCapture` drives whichever it is handed through the `DirectionRunner` interface and does not know which it holds. Three things differ on the live path: capture runs ungated through `MicrophoneGraph`, ducking follows audible audio rather than open turns (there are none to count), and transcript text appends to one line per direction instead of a turn per sentence. `voiceGender` is inert in live mode — the model has its own voice, and the popup disables the control rather than leaving it doing nothing.

## CI

GitHub Actions — the jobs are defined in `.github/workflows/ci.yml` (PR + push to `main`); deploy and the main-failure alert sit beside it. See [modules, extension and CI](./architecture/modules-extension-ci.md).

**Dead-code gate (manual):** `pnpm knip` (config: root `knip.json`) reports unused files/exports/dependencies across all workspaces. A clean run exits 0 with no findings.

The script pins `KNIP_DISABLE_RAW_TRANSFER=1` (via `cross-env`, since Windows `cmd` rejects POSIX env prefixes). Without it, knip parses through oxc-parser's raw-transfer fast path, which reserves a single 6 GiB `ArrayBuffer`. That reservation is free on Linux but charges against the Windows commit limit, so on a machine with less than ~6 GiB of commit headroom knip aborts with `RangeError: Array buffer allocation failed` before reporting anything — and `--max-old-space-size` cannot help, because the buffer lives outside the V8 heap. oxc-parser's own `rawTransferSupported()` probe only checks CPU architecture and Node version, never whether the allocation can actually succeed, so the fast path has to be switched off explicitly. Parsing is slower without it; for a manual gate that runs occasionally, running everywhere beats running fast.

Intentional exclusions are `ignore`/`ignoreDependencies` entries in `knip.json`, plus `@public` JSDoc tags on scaffold exports. `knip.json` carries most rationales as comments beside the entry; the ones it does not:

| Exclusion                                                           | Why knip can't see the usage                                                                                                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swagger-ui-express` (api)                                          | `@nestjs/swagger` requires it dynamically at runtime on the Express platform                                                                               |
| `@chatofy/config` (api, web)                                        | the tsconfig extends the preset by relative path (package-specifier extends breaks knip's symlink resolution); the dep stays to express the workspace edge |
| `next`, `eslint-config-*` (packages/config)                         | preset files are data, not source — nothing imports them inside the workspace                                                                              |
| `expo-updates` (mobile)                                             | Expo plugin quirk; `app.json` declares no updates config                                                                                                   |
| `audio-player.interface.ts`, `audio-recorder.interface.ts` (mobile) | scaffold interfaces awaiting native implementations                                                                                                        |

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
    "code": "VALIDATION_FAILED|UNAUTHORIZED|...  (errorCodeSchema)",
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
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';

@Get('/users/:id')
@ApiEnvelopeResponse(UserResponseDto)
getUser(@Param('id') id: string): Promise<UserResponse> { ... }
```

This documents the response as the standard success envelope with the given data type.

## Status

- **Shipped:** web (translator, history, minutes, AI Contexts, preferences, account, in English and Vietnamese) and the browser extension, over `POST /translate` and the streaming `/ws/translate`; email + Google auth with rotating refresh tokens; Postgres persistence; local STT/TTS sidecars, with cloud translation the only remote call in a turn
- **Scaffold only:** mobile — screens, auth client and audio interfaces are stubs
- **Infrastructure:** response envelope, validation and tracing; Swagger at `/docs` (non-prod); all contracts in `@chatofy/types`
