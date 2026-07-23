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

| Area                          | Change                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/local-stt` (:8002)  | New. FastAPI + sherpa-onnx. Zipformer-30M (vi), Moonshine base (en). PyAV decode of any container → mono float32 @ 16 kHz                                                             |
| `services/local-tts` (:8003)  | New. FastAPI. Kokoro-82M via sherpa-onnx (en) + VieNeu v3 Turbo (vi) — two runtimes, one process                                                                                      |
| `services/vieneu-tts` (:8001) | **Deleted** — absorbed into `local-tts`                                                                                                                                               |
| `@chatofy/ai-providers`       | `LocalSpeechSttProvider`, `LocalSpeechTtsProvider` (both named `local`); deleted `VieNeuTtsProvider` + two empty scaffold dirs                                                        |
| `apps/api`                    | 2 registry entries, 2 env vars, defaults → `local`; removed the per-language TTS routing exception; fixed a misattributing STT log line; log the wrapped cause on connection failures |
| Root                          | `dev:all` runs 3 processes; `knip.json` `ignoreBinaries` updated in the same change                                                                                                   |
| Docs                          | README local-speech section + licences; `docs/system-architecture.md` routing table; `docs/codebase-summary.md` pipeline entry                                                        |

`ProviderRegistry`, the provider interfaces, `resolveQualityProfile` and the
REST contract are untouched.

**Service boundaries follow function, not library.** One sidecar per speech
stage, each serving both languages and resolving its engine from the language it
is given. That removed the only per-language exception in provider resolution —
the factory previously hardcoded Vietnamese output to VieNeu regardless of
`AI_TTS_PROVIDER`. With it gone, the trio no longer depends on translation
direction and `makeProviders` dropped its language parameter.

Two consequences worth stating plainly:

- With `AI_TTS_PROVIDER=elevenlabs`, Vietnamese output now goes to ElevenLabs
  instead of silently falling back to VieNeu. The setting means what it says.
- Default voices moved into the sidecar. A voice is a speaker id for Kokoro and
  a preset name for VieNeu, so only the engine can sensibly default it.

Dependency resolution (`vieneu 3.1.0` + `sherpa-onnx 1.13.4` + `onnxruntime
1.27.0`, 63 packages, no torch) and runtime coexistence of both engines in one
process were verified before the move — the conflict risk flagged at brainstorm
time did not materialize.

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

### Cloud vs local, per speech stage

Measured through the real provider classes, 3 runs each, same audio and same
sentence on both sides. Deliberately **not** routed through `POST /translate`:
machine translation is unchanged by this work and its free tier caps at 20
requests/day, so including it would measure the wrong thing and die on quota.

| Stage  | Local p50  | Cloud p50  | Verdict                |
| ------ | ---------- | ---------- | ---------------------- |
| STT vi | **84 ms**  | 1117 ms    | local **13.3× faster** |
| STT en | **178 ms** | 1285 ms    | local **7.2× faster**  |
| TTS vi | 1235 ms    | **348 ms** | cloud **3.5× faster**  |
| TTS en | 1126 ms    | **255 ms** | cloud **4.4× faster**  |

Transcript accuracy on identical audio — same words both sides, cloud adds
punctuation:

```
vi/local  "Xin chào hôm nay trời rất đẹp"
vi/cloud  "Xin chào, hôm nay trời rất đẹp"
en/local  "The weather is beautiful today and I would like to walk in the park."
en/cloud  "The weather is beautiful today, and I would like to walk in the park"
```

**This overturns an earlier reading in this report.** A first draft compared a
single cloud turn (5216 ms vi→en) against the local p50 and concluded local was
~3× faster end to end. That n=1 sample carried the cloud client's cold-start
cost and was misleading. The honest picture is a trade, not a win:

- Local STT is dramatically faster than ElevenLabs Scribe at equal word accuracy.
- **Local TTS is dramatically slower than ElevenLabs.** Synthesis is now the
  most expensive speech stage in a turn.
- End to end the two stacks are roughly comparable. The case for local is cost,
  privacy, and offline capability for the speech stages — not raw speed.

TTS latency scales with output length, so the fixed 13-word sentence used here
runs longer than the short translations in the end-to-end table above.

## Verification

- `services/local-stt`: 14 tests pass (decode, post-processing, endpoints)
- `services/local-tts`: 10 tests pass (both languages, cross-language voice fallback)
- `apps/api`: 82 tests pass across 12 suites, including 16 new provider cases
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

**5. The "intermittent" Gemini failures were the free-tier daily quota.**
Turns kept failing with `ProviderConnectionError` → HTTP 503 in a pattern that
looked random, and swapping in a fresh API key only bought another handful of
turns. The provider wraps the SDK error but never logged its `cause`, so the
real reason was invisible. Adding that one log line produced the answer
immediately:

```
ApiError: {"error":{"code":429, ... "status":"RESOURCE_EXHAUSTED",
  "quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier",
  "quotaValue":"20", "model":"gemini-2.5-flash"}}
```

**20 requests per day per project per model** on the free tier. Every failure in
this session was that limit, not a bug and not a network fault. Speech keeps
working past the cap; only `/translate` fails.

Two things follow. The cause is now logged, so this class of failure is
diagnosable. And the classification is arguably wrong: a 429 quota rejection is
a _response_ failure, not a transport one, yet `GeminiTranslationProvider` wraps
every SDK throw into `ProviderConnectionError`. Left alone — it is pre-existing
behaviour outside this change's scope — but it is worth fixing.

## Deviations from the plan

| Plan said                                                  | Actual                                                       | Why                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Modify root `.gitignore`                                   | Created `services/local-*/.gitignore`                        | The repo ignores Python artifacts per service (`services/vieneu-tts`, `benchmarks/*`), not at the root |
| `engines/{__init__,registry,zipformer_vi,moonshine_en}.py` | Added `engines/base.py`                                      | Shared lock/transcribe/preload contract; mirrors `benchmarks/stt/stt_bench/engines/base.py`            |
| `test_app.py` only                                         | Added `conftest.py`, `test_decode.py`, `test_postprocess.py` | Decode and post-processing tests need no model weights, so they run anywhere                           |

## Follow-ups (not done, not blocking)

- **Local TTS is the slow stage now** (1.1–1.2s vs ElevenLabs' 0.25–0.35s). If
  turn latency matters more than independence, Piper is the measured
  latency-first fallback for English (p95 0.57s, MIT) at a quality cost the user
  rejected on listening. Nothing equivalent was benchmarked for Vietnamese.
- **Vietnamese casing/punctuation restoration** — would fix proper nouns; needs
  a model or a Gemini contract change (rejected as scope creep during planning).
- **`GeminiTranslationProvider` classifies a 429 as a transport error** —
  finding 5. Should be a `ProviderResponseError` carrying the status.
- **Gemini free tier is 20 requests/day** — any sustained testing of the full
  turn needs billing enabled, independent of this change.
- **No request timeouts on any provider** — pre-existing across all of them; a
  hung sidecar would hang the turn. Belongs as one consistent change, not a
  partial fix here.

## Unresolved questions

None blocking. The two decisions worth revisiting later are the Vietnamese
casing trade-off (finding 2) and whether the thesis needs the full cloud A/B.
