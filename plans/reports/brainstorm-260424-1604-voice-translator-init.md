# Brainstorm — Voice Translator Monorepo Init

**Date:** 2026-04-24 16:04 | **Mode:** Bootstrap scaffold

## Problem Statement

Build realtime VI↔EN voice interpreter app. Multi-platform (mobile, web, browser extension, API) as long-term scope. MVP: React Native mobile only.

## Locked Decisions

| Area         | Decision                                                   | Rationale                                   |
| ------------ | ---------------------------------------------------------- | ------------------------------------------- |
| Use case     | Realtime 2-way VI↔EN (Google Interpreter-style)            | True conversational interpreter             |
| MVP platform | React Native (Expo) mobile                                 | Voice UX best on mobile, fastest validation |
| AI strategy  | Hybrid managed APIs w/ abstraction layer                   | Ship fast, swap to self-host at scale       |
| Backend      | NestJS + Fastify                                           | WebSocket-friendly, TS-native               |
| DB           | Postgres (Supabase candidate)                              | TBD — decided at impl time                  |
| Auth         | Interface-first, provider TBD (Supabase/BetterAuth/custom) | Defer concrete choice                       |
| Monorepo     | Turborepo + pnpm workspaces                                | Simplest + caching, startup-fit             |
| TTS          | Generic preset voices (no cloning in MVP)                  | Latency + cost control                      |
| Team         | 2-4 devs, 6-8 week MVP target                              | Small startup team                          |

## Descoped from MVP (YAGNI)

- Browser extension (future phase)
- Voice cloning
- Multi-language (only VI↔EN)
- Payment/subscription tier
- Analytics/metering
- Offline mode

## Monorepo Structure

```
chatofy/
├── apps/
│   ├── api/          # NestJS gateway (WS + REST)
│   ├── mobile/       # Expo RN (MVP)
│   └── web/          # Next.js (minimal landing, expand later)
├── packages/
│   ├── config/       # tsconfig, eslint, prettier presets
│   ├── types/        # shared DTO + WS event schemas
│   ├── ai-providers/ # STT/MT/TTS/Realtime interfaces
│   └── ui/           # future shared components (stub)
```

## Interface-First Architecture (Swap Anytime)

**packages/ai-providers/** — abstract AI pipeline:

- `RealtimeProvider` — speech-to-speech streaming (OpenAI Realtime / Azure / Google)
- `SttProvider` — audio→text (Whisper / Deepgram / Google STT)
- `TranslationProvider` — text→text (GPT / DeepL / NLLB)
- `TtsProvider` — text→audio (OpenAI TTS / ElevenLabs / Azure)
- `ProviderRegistry` — factory + env-based selection

**apps/api/** — abstract external integrations:

- `AuthAdapter` interface (Supabase/BetterAuth swap point)
- `AudioSessionService` interface (session state)
- Repository pattern via Prisma

**apps/mobile/** — abstract platform services:

- `IApiClient`, `IAudioRecorder`, `IAuthClient`, `IWSClient` interfaces

## Risks (Carry to Impl)

1. OpenAI Realtime API Vietnamese quality unverified → spike needed before locking
2. AI cost at scale (~$0.30/min Realtime) → needs hard rate limits in MVP
3. Mobile audio quirks (iOS echo, Android perms) → test early on real devices

## Deferred Decisions

- OpenAI Realtime API vs classic pipeline (Whisper+GPT+TTS)
- Supabase managed vs self-built Auth
- Landing page in MVP web app or separate repo

## Next Steps

- Scaffold monorepo per structure (this session)
- Design spikes: Realtime API VI quality, mobile audio PoC (future session)
- Feature implementation (post-scaffold)

## Unresolved Questions

- Ship web landing page in MVP? (Scaffolded minimal for now, no content)
- Which auth provider to adopt first? (Interface scaffolded, impl deferred)
