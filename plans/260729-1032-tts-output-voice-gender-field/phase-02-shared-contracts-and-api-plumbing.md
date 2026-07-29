---
phase: 2
title: 'Shared contracts and API plumbing'
status: todo
priority: P1
effort: '3h'
dependencies: [1]
---

# Phase 2: Shared contracts and API plumbing

## Overview

Adds `voiceGender` to both wire contracts and carries it from each transport
down to `synthesize()`. This is where the actual defect is fixed: the WS path
currently synthesizes with no voice argument at all.

## Requirements

- Functional: `client.session.start` and the REST body accept `voiceGender`;
  both paths pass it to the TTS provider; omitted → `'female'`.
- Non-functional: parsed contract types are total (no `undefined` gender inside
  the API); no engine-specific token in any TypeScript file.

## Architecture

`SessionOptions { direction, voiceGender }` is the unit that opens a turn — the
two fields travel together through gateway → service → `TurnSession`, so they
move as one object rather than as a widening positional argument list (D8).
`TurnSession` destructures them into flat readonly fields so its own internals
are unchanged.

```
client.session.start {direction, voiceGender}
  → TranslateGateway.handleSessionStart
  → TranslationSessionService.start(socket, options)
  → new TurnSession(options)
  → streamClauses(...)  →  pipeline.synthesize({text, language, voiceGender})
  → LocalSpeechTtsProvider  →  POST /synthesize {text, language, gender}
```

## Related Code Files

- Modify: `packages/types/src/events/ws-events.ts` — `sessionOptionsSchema`, extend into `clientSessionStartSchema`, export `SessionOptions`
- Modify: `packages/types/src/domain/transcript.ts` (or sibling) — `voiceGenderSchema`, `VoiceGender`
- Modify: `packages/types/src/http/translate.ts` — `voiceGender` replaces `voice`; **delete** `VIENEU_VOICES`
- Modify: `packages/ai-providers/src/interfaces/tts-provider.ts` — `voiceGender?: VoiceGender` replaces `voice`
- Modify: `packages/ai-providers/src/providers/local-speech/local-speech-tts-provider.ts` — POST `gender`
- Modify: `packages/ai-providers/src/providers/elevenlabs/elevenlabs-tts-provider.ts` — delete `resolveVoiceId`, keep configured id (D4)
- Modify: `apps/api/src/modules/translate/session/turn-session.ts` — constructor takes `SessionOptions`
- Modify: `apps/api/src/modules/translate/services/translation-session.service.ts` — `start(socket, options)`; `streamClauses` passes `session.voiceGender`
- Modify: `apps/api/src/modules/translate/translate.gateway.ts` — pass the whole event
- Modify: `apps/api/src/modules/translate/services/pipeline-translator.service.ts` — `TranslateTurnInput.voiceGender`, `SynthesizeRequest.voiceGender`
- Modify: `apps/api/src/modules/translate/translate.controller.ts` — forward `body.voiceGender`
- Modify: specs — `turn-session.spec.ts`, `translation-session.service.spec.ts`, `pipeline-translator.service.spec.ts`, `local-speech-providers.spec.ts`, `elevenlabs-providers.spec.ts`, `translate.e2e-spec.ts`, `translate-ws-stream.e2e-spec.ts`, `translate-local-speech-sidecar.e2e-spec.ts`

## Implementation Steps

1. Add `voiceGenderSchema` to the domain layer and export it from the package index.
2. Add `sessionOptionsSchema`; extend it into `clientSessionStartSchema` so the
   event and the domain object cannot drift.
3. Swap `voice` → `voiceGender` in `translateRequestSchema`; delete `VIENEU_VOICES`.
4. Change the `TtsProvider` request field; update both providers.
5. Thread `SessionOptions` through gateway → service → `TurnSession`; pass
   `session.voiceGender` into the `synthesize()` call inside `streamClauses`.
6. Thread `voiceGender` through the REST controller and `translateTurn`.
7. Update every spec that constructs a session or asserts a synthesize payload.

## Todo

- [x] `voiceGenderSchema` + `SessionOptions` in `@chatofy/types`
- [x] `VIENEU_VOICES` deleted
- [x] `TtsProvider.voiceGender`, both providers updated
- [x] WS path carries gender into `synthesize()`
- [x] REST path carries gender into `synthesize()`
- [x] api unit + e2e green

## Success Criteria

- [x] A WS turn started with `voiceGender: 'male'` POSTs `gender: "male"` to the sidecar
- [x] Omitting the field yields `'female'` at the provider, not `undefined`
- [x] `grep -r "VIENEU_VOICES\|resolveVoiceId"` returns nothing
- [x] `pnpm --filter @chatofy/api test` and the e2e suites green

## Risk Assessment

- Widest blast radius in the plan: 8 spec files touch these contracts. Mitigation
  — run the narrowest suite per package before the full sweep.
- `apps/api` jest is install-fragile (hoisted-linker dual-jest, prior sessions).
  Confirm the runner executes at all before reading a green run as signal.
- Deleting `resolveVoiceId` changes ElevenLabs behavior only for callers that
  passed a voice id through `/translate`; nothing in-repo does.
