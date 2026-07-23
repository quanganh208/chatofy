---
phase: 4
title: 'Phase 4: API wiring and env defaults'
status: todo
priority: P1
effort: '1.5h'
dependencies: [3]
---

# Phase 4: API wiring and env defaults

## Overview

Register the two new providers at the NestJS composition root, add their env
vars, and flip `AI_STT_PROVIDER` / `AI_TTS_PROVIDER` defaults to `local`.

This is the smallest phase by code volume and the largest by behavioural
consequence: it is where the app stops calling ElevenLabs by default.

## Requirements

- Functional: `AI_STT_PROVIDER=local` resolves `LocalSpeechSttProvider`;
  `AI_TTS_PROVIDER=local` resolves `LocalSpeechTtsProvider` for English output.
- Functional: en→vi keeps routing to VieNeu, unchanged.
- Functional: the app still boots with no API keys and no sidecars running;
  failures surface only when `/translate` is actually called.
- Non-functional: no change to `PipelineTranslatorService`, the registry, the
  provider interfaces, the DTOs, or the REST contract.

## Architecture

`AiProvidersFactory.makeProviders` already computes:

```ts
const ttsBackend = targetLang === 'vi' ? 'vieneu' : ttsName;
```

so registering a TTS provider under the name `local` is sufficient: with
`AI_TTS_PROVIDER=local`, English output resolves `local` (Kokoro) and
Vietnamese output still resolves `vieneu`. **No routing code changes.**

The trio cache key already includes the provider names and `targetLang`, so
switching backends via env cannot serve a stale trio.

Key enforcement stays lazy — providers throw from their constructors, the
factory does not pre-validate. That is why the app boots keyless today and must
keep doing so.

**Failure-mode change.** Today, a misconfigured default fails with
`ProviderConfigError` ("missing key") → 503 "Translation provider is not
configured". After this phase, the common failure is a sidecar that is not
running → `ProviderConnectionError` → 503 "Translation provider request failed".
Both are already mapped in `handlePipelineError`; the new path gets a spec.

## Related Code Files

- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/modules/translate/providers/register-default-providers.ts`
- Modify: `apps/api/src/modules/translate/providers/ai-providers.factory.ts`
- Modify: `apps/api/.env.example`
- Create: `apps/api/src/modules/translate/providers/local-speech-providers.spec.ts`
- Modify: `apps/api/src/modules/translate/providers/ai-providers.factory.spec.ts` (add local-resolution cases)
- Reference (read-only): `apps/api/src/modules/translate/providers/vieneu-tts-provider.spec.ts` (spec pattern to copy)

## Implementation Steps

1. **`env.schema.ts`** — add to the turn-based pipeline block:

   ```ts
   AI_STT_PROVIDER: z.string().default('local'),   // was 'elevenlabs'
   AI_TTS_PROVIDER: z.string().default('local'),   // was 'elevenlabs'
   LOCAL_STT_URL: z.string().url().default('http://localhost:8002'),
   LOCAL_TTS_URL: z.string().url().default('http://localhost:8003'),
   LOCAL_TTS_VOICE_ID: z.string().default('0'),
   ```

   Keep `LOCAL_TTS_VOICE_ID` a string: the `TtsProvider` contract carries
   `voice` as a string and the sidecar owns parsing plus the bounds check.
   Update the block comment — it currently says "vi→en" and "STT/TTS via
   ElevenLabs", both now wrong.

2. **`register-default-providers.ts`** — add three fields to
   `AiProviderResolveConfig` (`localSttUrl`, `localTtsUrl`, `localTtsVoiceId`)
   and two `register()` calls following the existing shape:

   ```ts
   registry.register('stt', {
     name: 'local',
     create: (cfg) =>
       new LocalSpeechSttProvider({ baseUrl: (cfg as AiProviderResolveConfig).localSttUrl }),
   });
   registry.register('tts', {
     name: 'local',
     create: (cfg) =>
       new LocalSpeechTtsProvider({
         baseUrl: (cfg as AiProviderResolveConfig).localTtsUrl,
         voice: (cfg as AiProviderResolveConfig).localTtsVoiceId,
       }),
   });
   ```

3. **`ai-providers.factory.ts`** — add the three new env reads into
   `resolveConfig`. Nothing else in this file changes.

4. **`.env.example`** — add the three new vars with comments, flip the two
   provider defaults, and reword the section header (it says "vi→en" but the
   pipeline is bidirectional). Note that `ELEVENLABS_API_KEY` is now optional
   and only needed to switch back to cloud for comparison.

5. **`local-speech-providers.spec.ts`** — copy the structure of
   `vieneu-tts-provider.spec.ts` (mock `global.fetch`, restore in `afterEach`).
   Cases:
   - both providers throw `ProviderConfigError` without `baseUrl`
   - STT posts to `${baseUrl}/transcribe` with a `FormData` body carrying the
     language, and returns the parsed `{ text, language }`
   - STT trims a trailing slash on `baseUrl`
   - TTS posts JSON to `${baseUrl}/synthesize` including `language`, and
     returns the wav bytes
   - TTS `outputMimeType === 'audio/wav'`
   - non-ok response → `ProviderResponseError` (also `instanceof ProviderError`)
   - fetch rejection → `ProviderConnectionError` with `cause` preserved

6. **`ai-providers.factory.spec.ts`** — add cases resolving the trio with
   `AI_STT_PROVIDER: 'local'` / `AI_TTS_PROVIDER: 'local'`, asserting
   `trio.stt.name === 'local'`, `trio.tts.name === 'local'` for `targetLang: 'en'`,
   and `trio.tts.name === 'vieneu'` for `targetLang: 'vi'` (the routing guarantee
   this whole plan leans on). The existing cases pass env explicitly at
   lines 24–25, so the default flip does not break them — confirm that still holds.

7. **Run** `pnpm --filter @chatofy/api test` and `pnpm typecheck && pnpm lint && pnpm knip`.

## Success Criteria

- [x] API boots with an empty `.env` beyond `DATABASE_URL` — no keys, no sidecars
- [x] With both sidecars up and `ELEVENLABS_API_KEY` unset, `POST /translate` (vi→en) returns transcript + translation + audio
- [x] en→vi still produces VieNeu audio (`audioMimeType: 'audio/wav'`, Vietnamese voice)
- [x] With sidecars down, `/translate` returns 503 "Translation provider request failed" — not a 500
- [x] Setting `AI_STT_PROVIDER=elevenlabs` + a key restores the cloud path (comparison route intact)
- [x] New and existing translate specs pass
- [x] `pnpm typecheck && pnpm lint && pnpm knip` clean, including the Phase 3 exports

## Findings during implementation

**An existing `apps/api/.env` silently keeps the old cloud path.** The default
flip only affects _unset_ variables, so the first end-to-end run still went
through ElevenLabs — visible only because the response carried `audio/mpeg`
instead of `audio/wav` and the Vietnamese transcript had punctuation the local
engine never produces. Verifying the local path required overriding the two
provider variables on the process. This is correct behaviour, but it means the
flip is invisible to anyone with an existing `.env`; the README calls it out.

**The STT log line misattributed the provider.** `PipelineTranslatorService`
logged `stt(${profile.sttModel})`, and `profile.sttModel` is hard-coded to
`scribe_v2` for every tier — so a local transcription was logged as
`stt(scribe_v2)`. The TTS log already had a guard for exactly this; STT did not.
Fixed by mirroring the `ttsLabel` pattern, otherwise every latency number
gathered in Phase 5 would be attributed to the wrong provider.

## Risk Assessment

- **Default flip silently breaks someone's working cloud setup (Medium).**
  Anyone with an existing `.env` keeps their explicit values; only unset vars
  change. Call the flip out in the Phase 5 README update so it is discoverable.
- **e2e tests that assume the ElevenLabs default (Low).** Existing specs pass
  env explicitly (`ai-providers.factory.spec.ts:24-25`), so none are expected to
  break — verify rather than assume, and check `apps/api/test/` too.
- **knip flags `LOCAL_TTS_VOICE_ID` as unused if the wiring is incomplete (Low).**
  Treat it as a real signal that Step 2/3 missed a field, not as noise to ignore.
- **Known jest fragility in `apps/api` (Low).** The hoisted-linker dual-jest
  issue can make the suite fail for reasons unrelated to this change. Report it
  as pre-existing; do not chase it here.
