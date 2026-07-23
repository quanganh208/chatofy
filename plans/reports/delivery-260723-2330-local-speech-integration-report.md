# Delivery — local STT/TTS providers wired into the translate pipeline

Plan: `plans/260723-2252-local-speech-provider-integration/` (5/5 phases)
Contract: `plans/reports/brainstorm-260723-2237-local-speech-provider-integration.md`
Date: 2026-07-23

## Outcome

`POST /translate` runs both directions with speech entirely on local CPU and no
`ELEVENLABS_API_KEY`. Two new sidecars, two new providers, defaults flipped to
`local`. The REST contract, the provider interfaces, the DTOs, and the client
are unchanged.

**Translation is still cloud Gemini** — the app is not offline. Speech is.

## What shipped

| Area                         | Change                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `services/local-stt` (:8002) | New. FastAPI + sherpa-onnx. Zipformer-30M (vi), Moonshine base (en). PyAV decode of any container → mono float32 @ 16 kHz      |
| `services/local-tts` (:8003) | New. FastAPI + sherpa-onnx. Kokoro-82M, English only                                                                           |
| `@chatofy/ai-providers`      | `LocalSpeechSttProvider`, `LocalSpeechTtsProvider` (both named `local`); removed two empty scaffold dirs                       |
| `apps/api`                   | 2 registry entries, 3 env vars, `AI_STT_PROVIDER`/`AI_TTS_PROVIDER` default → `local`; fixed a misattributing STT log line     |
| Root                         | `dev:all` runs 5 processes; `knip.json` `ignoreBinaries` updated in the same change                                            |
| Docs                         | README local-speech section + licences; `docs/system-architecture.md` routing table; `docs/codebase-summary.md` pipeline entry |

No changes to `PipelineTranslatorService` routing, `ProviderRegistry`, provider
interfaces, or `resolveQualityProfile` — registering a TTS provider named
`local` was sufficient because the factory already routes TTS by output language.

## Measured end-to-end latency

6 turns per direction, 4s apart, local speech + cloud Gemini, on the target
machine (8 physical / 16 logical cores, 32 GB, Windows). 0 failures.

| Direction | p50         | p95     | min     | samples (ms)                            |
| --------- | ----------- | ------- | ------- | --------------------------------------- |
| vi→en     | **1663 ms** | 1976 ms | 1418 ms | 1976 / 1663 / 1510 / 1707 / 1418 / 1727 |
| en→vi     | **2337 ms** | 2662 ms | 2059 ms | 2662 / 2059 / 2337 / 2468 / 2622 / 2212 |

Per-stage (p50 of the same runs):

| Stage                          | vi→en                   | en→vi                    |
| ------------------------------ | ----------------------- | ------------------------ |
| STT (local)                    | 53 ms — Zipformer       | 186 ms — Moonshine       |
| Translation (**cloud** Gemini) | 916 ms                  | 921 ms                   |
| TTS                            | 748 ms — Kokoro (local) | 1402 ms — VieNeu (local) |

**The cloud translation call is now the single largest component of a vi→en
turn** (~55% of it). Further latency work belongs there, not in speech.

### Against the benchmarks

| Component    | Benchmarked (isolated) | Measured (in service)   |
| ------------ | ---------------------- | ----------------------- |
| Zipformer vi | p95 0.09s              | ~53 ms p50              |
| Moonshine en | p95 0.34s              | ~186 ms p50             |
| Kokoro en    | p95 1.18s, RTF 0.323   | ~748 ms p50, RTF ≈ 0.42 |

STT lands inside the benchmarked band. Kokoro's RTF is ~28% worse in service
than in the harness, which is expected: the benchmark timed the engine in a
dedicated subprocess with no HTTP layer. Well inside the ≤2s p95 target.

### Indicative comparison against the cloud path

One turn per direction was run through ElevenLabs before the local path was
forced on (`AI_*_PROVIDER=elevenlabs`, same audio, same machine):

| Direction | Cloud (n=1) | Local (p50) |
| --------- | ----------- | ----------- |
| vi→en     | 5216 ms     | 1663 ms     |
| en→vi     | 3946 ms     | 2337 ms     |

**n=1 per direction — indicative only, not a benchmark.** A proper A/B would
need repeated runs and would consume ElevenLabs credits; not run without asking.

## Verification

- `services/local-stt`: 14 tests pass (decode, post-processing, endpoints)
- `services/local-tts`: 6 tests pass
- `apps/api`: 88 tests pass across 13 suites, including 15 new provider cases
- `pnpm typecheck`, `pnpm lint` (0 errors), `pnpm knip` (exit 0) — all clean
- Provider classes exercised against the live sidecars: 11/11 assertions
- Closed-loop speech checks, both languages:
  - VieNeu synthesized "Xin chào, hôm nay trời rất đẹp" → Zipformer returned
    "Xin chào hôm nay trời rất đẹp"
  - Kokoro synthesized "The weather is beautiful today and I would like to walk
    in the park" → Moonshine returned it back word for word

The English loop is the objective substitute for a subjective listening test:
garbled phonemes from a wrong `espeak-ng-data` would not survive transcription.

## Findings

**1. PyAV works on Windows/Python 3.11 — no ffmpeg needed.** The plan's only
unverified assumption. `av` 18.0.0 installs from a wheel and decodes webm/opus
48 kHz stereo to 16 kHz mono float32 exactly. The ffmpeg-subprocess fallback was
not needed. `resample()` returns a list on PyAV 18, as the plan anticipated.

**2. Vietnamese transcripts were ALL CAPS with no punctuation.** Zipformer emits
`NGỌN LỬA BẠO ĐỘNG…`; Moonshine emits `The rector did not ask…`. The benchmark's
WER normalization lowercases and strips punctuation, so this never showed up in
the numbers. Since `sourceText` is displayed to the user, shipping it would have
been a visible regression against the ElevenLabs default being replaced.
Resolved (user decision) with a `postprocess()` hook on `SttEngine`, overridden
for Vietnamese to sentence-case. **Proper nouns stay lowercased** — "tôi đi hà
nội" — which needs a casing/punctuation restoration model to fix properly.

**3. An existing `apps/api/.env` silently keeps the cloud path.** The default
flip only affects unset variables. The first end-to-end run still went through
ElevenLabs; it was caught only because the response carried `audio/mpeg` instead
of `audio/wav`. Correct behaviour, but invisible — called out in the README.

**4. The STT log line named the wrong provider.** `PipelineTranslatorService`
logged `profile.sttModel`, hard-coded to `scribe_v2` on every tier, so local
transcriptions were logged as `stt(scribe_v2)`. TTS already guarded against
this; STT did not. Fixed — otherwise every number in this report would have
been attributed to the wrong provider.

**5. Gemini failed intermittently during measurement** (3 turns across ~40),
surfacing as `ProviderConnectionError` → HTTP 503. It resolved on its own; the
final 12 measured turns had zero failures. Pre-existing provider behaviour,
untouched by this work. Worth noting: the provider wraps the SDK error but never
logs its `cause`, so the underlying reason is not diagnosable from the logs.

## Deviations from the plan

| Plan said                                                  | Actual                                                       | Why                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Modify root `.gitignore`                                   | Created `services/local-*/.gitignore`                        | The repo ignores Python artifacts per service (`services/vieneu-tts`, `benchmarks/*`), not at the root |
| `engines/{__init__,registry,zipformer_vi,moonshine_en}.py` | Added `engines/base.py`                                      | Shared lock/transcribe/preload contract; mirrors `benchmarks/stt/stt_bench/engines/base.py`            |
| `test_app.py` only                                         | Added `conftest.py`, `test_decode.py`, `test_postprocess.py` | Decode and post-processing tests need no model weights, so they run anywhere                           |

## Follow-ups (not done, not blocking)

- **Vietnamese casing/punctuation restoration** — would fix proper nouns; needs
  a model or a Gemini contract change (rejected as scope creep during planning).
- **Proper cloud-vs-local A/B** for the thesis — repeated runs on both paths,
  consumes ElevenLabs credits, needs a go-ahead.
- **`GeminiTranslationProvider` should log the wrapped `cause`** — finding 5.
- **No request timeouts on any provider** — pre-existing across all of them; a
  hung sidecar would hang the turn. Belongs as one consistent change, not a
  partial fix here.

## Unresolved questions

None blocking. The two decisions worth revisiting later are the Vietnamese
casing trade-off (finding 2) and whether the thesis needs the full cloud A/B.
