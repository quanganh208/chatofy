# Phase 2 Report — Shared Packages

**Date:** 2026-04-24 | **Status:** DONE

## Files Created

### packages/config (11 files)

- `package.json` — name `@chatofy/config`, private, all subpath exports
- `tsconfig/base.json`, `library.json`, `nextjs.json`, `react-native.json`, `nestjs.json`
- `eslint/base.cjs`, `nextjs.cjs`, `react-native.cjs`, `nestjs.cjs`
- `prettier/index.cjs`

### packages/types (14 files)

- `package.json`, `tsconfig.json`
- `src/domain/user.ts` — `User`, `UserProfile`
- `src/domain/session.ts` — `SpeakerRole`, `SessionStatus`, `ConversationSession`
- `src/domain/transcript.ts` — `TranslationDirection`, `TranscriptSegment`
- `src/domain/index.ts`
- `src/api/auth.ts` — `LoginDto`, `RegisterDto`, `AuthTokenDto`, `SessionDto`
- `src/api/sessions.ts` — `CreateSessionDto`, `SessionResponseDto`
- `src/api/index.ts`
- `src/events/audio-frame.ts` — `AudioEncodingSchema`, `AudioFrameSchema` (zod)
- `src/events/ws-events.ts` — `ClientEventSchema`, `ServerEventSchema` (discriminated unions)
- `src/events/index.ts`
- `src/index.ts`

### packages/ai-providers (15 files)

- `package.json`, `tsconfig.json`
- `src/interfaces/provider-types.ts` — `LanguageCode`, `AudioFormat`, `StreamHandle`, `ProviderConfig`
- `src/interfaces/realtime-provider.ts` — `RealtimeProvider`
- `src/interfaces/stt-provider.ts` — `SttProvider`
- `src/interfaces/translation-provider.ts` — `TranslationProvider`
- `src/interfaces/tts-provider.ts` — `TtsProvider`
- `src/interfaces/index.ts`
- `src/errors/provider-errors.ts` — `ProviderNotImplementedError`, `ProviderConfigError`, `ProviderConnectionError`
- `src/errors/index.ts`
- `src/registry/provider-registry.ts` — `ProviderRegistry` class
- `src/registry/provider-factory.ts` — `readAiProviderEnv`
- `src/registry/index.ts`
- `src/providers/.gitkeep`
- `src/index.ts`

### packages/ui (4 files)

- `package.json`, `tsconfig.json`, `src/index.ts`, `README.md`

## Interfaces Exported (ai-providers)

`RealtimeProvider`, `SttProvider`, `TranslationProvider`, `TtsProvider` — contracts only, zero concrete impls.

## Typecheck Results

- `packages/types`: PASS (clean)
- `packages/ai-providers`: PASS (clean)
- `packages/ui`: PASS (clean)

## Deviations from Spec

1. **`library.json` preset** — removed `rootDir`/`outDir` from shared preset (they're relative to the preset file, not the consumer). Each package's own `tsconfig.json` now declares `rootDir: src`, `outDir: dist`. Functionally identical, architecturally correct.
2. **`@chatofy/config` devDependency** — added `workspace:*` devDep to `types`, `ai-providers`, `ui` so pnpm hoists the package and `extends` resolution works. Not in spec but required.
3. **`nestjs.json` preset** — kept `outDir`/`rootDir` in this preset since NestJS apps will always use `src`/`dist`. Risk: same resolution issue if a consumer has different dirs; NestJS app tsconfig should override if needed.

## Unresolved Questions

- None. All packages typecheck cleanly.
