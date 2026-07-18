---
phase: 1
title: Provider contracts and error hierarchy
status: completed
priority: P2
dependencies: []
---

# Phase 1: Provider contracts and error hierarchy

## Overview

Harden `packages/ai-providers` + `packages/types` contracts: error base class, response-vs-connection error split, `outputMimeType` on `TtsProvider`, typed registry resolve, single-source `LanguageCode`, schema naming consistency, provider-env rename. All additive or internal — no consumer break outside this repo.

## Requirements

- Functional: audit packages findings #1,#2,#3,#5,#6,#7 + api finding #1 (interface half).
- Non-functional: ai-providers stays zod-free at runtime (type-only import); `instanceof` safety preserved (ES2022 native classes).

## Architecture

- `ProviderError` abstract base → `ProviderConfigError | ProviderConnectionError | ProviderNotImplementedError | ProviderResponseError` (new). Connection = transport failure; Response = HTTP non-2xx / malformed body.
- `TtsProvider` gains `readonly outputMimeType: string` (elevenlabs → `audio/mpeg`, vieneu → `audio/wav`) — kills the pipeline's duplicated MIME map (consumed in Phase 2).
- `ProviderRegistry.resolve` typed via `ProviderKindMap` mapped type: `resolve<K extends ProviderKind>(kind: K, name, config): ProviderKindMap[K]`.
- `LanguageCode`: add `languageCodeSchema = z.enum(['vi','en'])` to `@chatofy/types`; ai-providers does `import type { LanguageCode } from '@chatofy/types'` (dep already declared, currently unused — now justified).

## Related Code Files

- Modify: `packages/ai-providers/src/errors/provider-errors.ts` — add `ProviderError` base + `ProviderResponseError`; existing three extend base.
- Modify: `packages/ai-providers/src/errors/index.ts`, `packages/ai-providers/src/index.ts` — export new classes.
- Modify: `packages/ai-providers/src/interfaces/tts-provider.ts` — add `readonly outputMimeType: string`.
- Modify: `packages/ai-providers/src/providers/elevenlabs/elevenlabs-tts-provider.ts`, `packages/ai-providers/src/providers/vieneu/vieneu-tts-provider.ts` — implement `outputMimeType`; throw `ProviderResponseError` for non-2xx/malformed (keep `ProviderConnectionError` for fetch/network throws only).
- Modify: `packages/ai-providers/src/providers/elevenlabs/elevenlabs-stt-provider.ts`, `packages/ai-providers/src/providers/gemini/gemini-translation-provider.ts` — same connection/response split.
- Modify: `packages/ai-providers/src/registry/provider-registry.ts` — `ProviderKindMap` typed resolve.
- Rename: `packages/ai-providers/src/registry/provider-factory.ts` → `provider-env.ts`; fix "returns null" comment (code returns `undefined`), drop no-op `?? undefined`; update `registry/index.ts` re-export.
- Modify: `packages/ai-providers/src/interfaces/provider-types.ts` — replace local `LanguageCode` with type-only import from `@chatofy/types`.
- Modify: `packages/types/src/` — add `languageCodeSchema` (single canonical file, likely `domain/transcript.ts` next to `translationDirectionSchema`); replace inline `z.enum(['vi','en'])` at `domain/user.ts:16`, `http/sessions.ts:7`, hardcoded unions `http/translate.ts:11-12`.
- Rename schemas: `packages/types/src/events/audio-frame.ts` (+ any `events/` PascalCase schema) → camelCase `…Schema`; update all imports (grep `AudioFrameSchema|ClientEventSchema|ServerEventSchema`).

## Implementation Steps (TDD)

1. **Tests first** — in `apps/api` jest (existing provider spec pattern):
   - Extend `vieneu-tts-provider.spec.ts` / `quality-and-elevenlabs.spec.ts`: assert current throw types for non-2xx and network-failure cases (locks behavior pre-split).
   - New assertions: `err instanceof ProviderError` catch-all; `outputMimeType` values per provider; typed `resolve` compile-time check (`@ts-expect-error` on kind/type mismatch).
   - Run: `pnpm --filter @chatofy/api test` — new assertions red, existing green.
2. Add `ProviderError` base + `ProviderResponseError`; migrate provider throw sites (non-2xx/malformed → Response, fetch-catch → Connection with `cause`).
3. Add `outputMimeType` to interface + both TTS impls.
4. Type registry resolve with `ProviderKindMap`.
5. Rename `provider-factory.ts` → `provider-env.ts`, fix comment, drop `?? undefined`.
6. `languageCodeSchema` in types; type-only import in ai-providers; replace duplicated literals; camelCase schema renames + import sweep.
7. Run: `pnpm --filter @chatofy/api test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`.

## Success Criteria

- [x] All existing + new api jest specs green
- [x] `catch (e) { e instanceof ProviderError }` matches all four error classes
- [x] Non-2xx responses throw `ProviderResponseError`, network failures throw `ProviderConnectionError` (cause preserved)
- [x] `resolve<'stt'>` returns `SttProvider` type without caller assertion; kind/type mismatch fails typecheck
- [x] `'vi'|'en'` literal defined exactly once (grep proves)
- [x] `pnpm typecheck && pnpm lint && pnpm build` green

## Risk Assessment

- Error-split changes which class 401-bad-key throws → Phase 2 pipeline `handlePipelineError` must map `ProviderResponseError` (coordinate; until then base-class catch keeps behavior safe).
- Schema renames are mechanical but wide — rely on typecheck sweep, not memory.
- Rollback: all changes additive or rename — revert commit restores prior contract.
