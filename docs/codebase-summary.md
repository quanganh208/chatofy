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
│   ├── types/     # domain types, API DTOs, WS event zod schemas (@chatofy/types)
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
| `IApiClient`                               | `apps/{mobile,web}/src/clients/api-client.interface.ts`                     | `FetchApiClient` (mobile)     |
| `IWSClient`                                | `apps/mobile/src/clients/ws-client.interface.ts`                            | `NativeWSClient`              |
| `IAuthClient`                              | `apps/mobile/src/clients/auth-client.interface.ts`                          | `StubAuthClient`              |
| `IAudioRecorder` / `IAudioPlayer`          | `apps/mobile/src/audio/*.interface.ts`                                      | (impl deferred)               |

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

## Status

- Scaffold complete (no feature code yet)
- Feature implementation begins post-scaffold per future plans
