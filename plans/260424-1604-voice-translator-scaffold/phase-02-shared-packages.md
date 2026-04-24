# Phase 2 — Shared Packages

**Priority:** P0 (blocks apps) | **Status:** pending | **Depends:** Phase 1

## Overview

Create 4 internal packages. Interface-first: `ai-providers` defines contracts only, no impl. `types` holds shared DTOs. `config` exports reusable tool presets. `ui` is a stub.

## Packages

### packages/config

Reusable tool presets consumed by apps + other packages.

- `package.json` — name `@chatofy/config`, private, exports subpaths
- `tsconfig/base.json` — strict base TS config
- `tsconfig/nextjs.json` — Next.js extends
- `tsconfig/react-native.json` — RN/Expo extends
- `tsconfig/nestjs.json` — NestJS extends (decorators, emit)
- `tsconfig/library.json` — library/package extends
- `eslint/base.cjs` — base ESLint (TS + unused imports)
- `eslint/nextjs.cjs` — extends + Next plugins
- `eslint/react-native.cjs` — extends + RN plugin
- `eslint/nestjs.cjs` — extends + Nest patterns
- `prettier/index.cjs` — shared Prettier config

### packages/types

Pure TS types + zod schemas (runtime-optional but useful for WS validation).

- `package.json` — name `@chatofy/types`, exports `.`, `./events`, `./domain`, `./api`
- `tsconfig.json` — extends `@chatofy/config/tsconfig/library.json`
- `src/index.ts` — barrel
- `src/domain/user.ts` — User, UserProfile types (shape only)
- `src/domain/session.ts` — ConversationSession, SpeakerRole
- `src/domain/transcript.ts` — TranscriptSegment, Direction (VI_TO_EN / EN_TO_VI)
- `src/api/auth.ts` — LoginDto, RegisterDto, SessionDto (interfaces)
- `src/api/sessions.ts` — CreateSessionDto, SessionResponseDto
- `src/events/ws-events.ts` — typed WS event map (client↔server) using zod schemas
- `src/events/audio-frame.ts` — AudioFrame envelope type
- Deps: `zod`

### packages/ai-providers

**Interface-first.** No concrete impl in scaffold — just contracts + registry + stub errors.

- `package.json` — name `@chatofy/ai-providers`
- `tsconfig.json` — extends library
- `src/index.ts` — barrel
- `src/interfaces/realtime-provider.ts` — `RealtimeProvider` contract (speech-to-speech)
- `src/interfaces/stt-provider.ts` — `SttProvider` contract (stream-in → text-stream-out)
- `src/interfaces/translation-provider.ts` — `TranslationProvider` contract (text → text)
- `src/interfaces/tts-provider.ts` — `TtsProvider` contract (text → audio-stream)
- `src/interfaces/provider-types.ts` — shared types (AudioFormat, LanguageCode, StreamHandle)
- `src/registry/provider-registry.ts` — `ProviderRegistry` class (register/resolve by key)
- `src/registry/provider-factory.ts` — env-driven factory (reads `AI_PROVIDER` env)
- `src/errors/provider-errors.ts` — `ProviderNotImplementedError`, `ProviderConfigError`
- `src/providers/.gitkeep` — concrete impls go here later (openai-realtime, whisper, deepgram, etc.)
- Deps: `@chatofy/types`

### packages/ui

Stub for future shared components (Phase 2+ of product).

- `package.json` — name `@chatofy/ui`, `"main": "./src/index.ts"`
- `tsconfig.json` — extends library
- `src/index.ts` — empty export barrel
- `README.md` — "Reserved for shared UI primitives. Do not add yet — apps keep their own UI until patterns emerge."

## Success Criteria

- `pnpm -r run typecheck` passes across packages
- Interfaces compile cleanly, no dangling types
- `packages/ai-providers` exports have zero concrete impl (YAGNI)
- Apps can import `@chatofy/types`, `@chatofy/config`, `@chatofy/ai-providers`
