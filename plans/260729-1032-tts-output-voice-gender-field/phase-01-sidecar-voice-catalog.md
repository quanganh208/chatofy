---
phase: 1
title: 'Sidecar voice catalog'
status: todo
priority: P1
effort: '2h'
dependencies: []
---

# Phase 1: Sidecar voice catalog

## Overview

Each TTS engine gains a two-entry gender→token catalog and accepts `gender`
instead of `voice` at the HTTP boundary. Kokoro speaker ids and VieNeu preset
names stop being addressable from outside the service.

## Requirements

- Functional: `POST /synthesize` takes `gender: 'female' | 'male'`; each engine
  resolves it to its own token; an unknown or absent value falls back to female
  rather than erroring (a public API must survive strange input).
- Non-functional: no new dependency; both engines keep loading eagerly at
  startup; the lock-per-engine concurrency model is unchanged.

## Architecture

`TtsEngine` (base) declares `VOICES: dict[str, object]` and owns the resolution
plus fallback, so neither subclass repeats the lookup. `_infer` takes the
already-resolved engine token, which keeps each subclass responsible only for
the thing it alone knows: how to turn its own token into audio.

```
POST /synthesize {text, language, gender}
  → EngineRegistry.get(language)
  → TtsEngine.synthesize(text, gender, speed)
      resolve gender → VOICES[gender]  (fallback: VOICES['female'])
      → _infer(text, token, speed)
```

## Related Code Files

- Modify: `services/local-tts/engines/base.py` — `VOICES`, resolution, fallback, `_infer` signature
- Modify: `services/local-tts/engines/kokoro_en.py` — `VOICES = {'female': 3, 'male': 5}`; drop `_resolve_sid`, `DEFAULT_SID`, `LOCAL_TTS_VOICE_EN`
- Modify: `services/local-tts/engines/vieneu_vi.py` — `VOICES = {'female': 'Mai Anh', 'male': 'Thanh Bình'}`; drop `_resolve_voice`, `DEFAULT_VOICE`, `preset_voices`, `LOCAL_TTS_VOICE_VI`
- Modify: `services/local-tts/engines/registry.py` — drop `voices()`
- Modify: `services/local-tts/app.py` — `SynthesizeRequest.gender`; drop `GET /voices`
- Modify: `services/local-tts/test_app.py` — replace the 4 voice tests with gender tests
- Modify: `services/local-tts/README.md` — API table, model table

## Implementation Steps

1. Add `VOICES` + resolution to `TtsEngine`; change `synthesize(text, gender, speed)`
   and the abstract `_infer(text, token, speed)`.
2. Give each engine its two constants; delete the per-engine resolver, the module
   default and its env var.
3. Drop `preset_voices` and `EngineRegistry.voices()`.
4. Rename the request field in `app.py`; delete the `/voices` route.
5. Rewrite the affected tests: male vs female both return WAV, unknown gender
   falls back, cross-language values are no longer expressible.
6. Update the service README.

## Todo

- [x] `TtsEngine.VOICES` + resolution + fallback in the base
- [x] Kokoro and VieNeu catalogs, resolvers and env vars removed
- [x] `/voices` route, `preset_voices`, `EngineRegistry.voices()` deleted
- [x] `SynthesizeRequest.gender` replaces `voice`
- [x] pytest rewritten and green
- [x] service README updated

## Success Criteria

- [x] `{"text":"…","language":"vi","gender":"male"}` returns WAV
- [x] `{"gender":"nonsense"}` returns 200 WAV, not 4xx
- [x] No `LOCAL_TTS_VOICE_*` env read remains
- [x] `uv run --directory services/local-tts pytest` green

## Risk Assessment

- Sidecar and API deploy separately; between Phase 1 and Phase 2 the API sends
  `voice` and the sidecar reads `gender`, so every turn falls back to female.
  Mitigation: land both phases in one commit — they are one contract.
- Audition covered 1 sentence per voice. Prosody on long clauses is unverified
  for `am_adam` / `Thanh Bình`; the Phase 3 manual check covers it.
