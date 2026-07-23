---
title: 'Local Speech Provider Integration'
description: 'Wire the benchmarked sherpa-onnx models (Zipformer-vi + Moonshine-en STT, Kokoro-en TTS) into the translate pipeline as two local sidecars, and make local the default.'
status: pending
priority: P1
effort: '11.5h'
tags: [speech, stt, tts, sidecar, providers]
created: 2026-07-23
---

# Local Speech Provider Integration

## Overview

STT and TTS models were benchmarked on CPU and won on both accuracy and latency
(see evidence below). This plan puts them into the running app: two new Python
sidecars behind the existing `SttProvider`/`TtsProvider` contracts, selected by
env, with `local` becoming the default for both.

Accepted contract (outcome, constraints, non-goals, acceptance) lives in
`plans/reports/brainstorm-260723-2237-local-speech-provider-integration.md`.
All 12 design decisions there are settled; this plan executes them.

**After this plan the system is still not fully offline** — machine translation
remains cloud Gemini. Only STT and TTS become local.

## Evidence

| Source                                                                | Fact used                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `plans/reports/stt-cpu-benchmark-260718-results-report.md`            | Zipformer-30M vi: WER 5.38%, RTF 0.017, p95 0.09s, 223MB. Moonshine-base en: WER 3.86%, RTF 0.040, p95 0.34s, 418MB |
| `plans/reports/tts-en-cpu-benchmark-260718-results-report.md`         | Kokoro-82M en: p95 1.18s, RTF 0.323, 619MB, Apache-2.0, chosen by user A/B listening                                |
| `benchmarks/stt/stt_bench/engines/*.py`                               | Working sherpa-onnx load/decode code to port                                                                        |
| `benchmarks/*/scripts/download_models.py`                             | Working model fetch code to port                                                                                    |
| `services/vieneu-tts/app.py`                                          | Sidecar shape to copy: lifespan eager load, `threading.Lock`, `/healthz` 200/503, thread env before engine import   |
| `apps/api/src/modules/translate/providers/ai-providers.factory.ts:57` | TTS already routed by target language — no routing change needed                                                    |
| `packages/types/src/domain/transcript.ts:8`                           | `languageCodeSchema = z.enum(['vi','en'])` — language set is closed                                                 |

## Goals

| #   | Goal                                                                             | Priority |
| --- | -------------------------------------------------------------------------------- | -------- |
| 1   | `POST /translate` runs vi→en and en→vi with `ELEVENLABS_API_KEY` empty           | P1       |
| 2   | Local STT/TTS reachable behind the unchanged provider contracts, selected by env | P1       |
| 3   | `local` is the default for `AI_STT_PROVIDER` and `AI_TTS_PROVIDER`               | P1       |
| 4   | One command (`pnpm dev:all`) brings up the whole local stack                     | P1       |
| 5   | Measured end-to-end latency recorded; license obligations documented             | P2       |

## Phases

| #   | Phase                                                                                                   | Status  |
| --- | ------------------------------------------------------------------------------------------------------- | ------- |
| 1   | [Phase 1: Local STT sidecar](./phase-01-local-stt-sidecar.md)                                           | Pending |
| 2   | [Phase 2: Local TTS sidecar](./phase-02-local-tts-sidecar.md)                                           | Pending |
| 3   | [Phase 3: TypeScript provider classes](./phase-03-typescript-provider-classes.md)                       | Pending |
| 4   | [Phase 4: API wiring and env defaults](./phase-04-api-wiring-and-env-defaults.md)                       | Pending |
| 5   | [Phase 5: Dev orchestration, docs, verification](./phase-05-dev-orchestration-docs-and-verification.md) | Pending |

Dependency chain is linear: 1 → 2 → 3 → 4 → 5. Phase 3 depends on 1 and 2
because the HTTP contracts must be proven working before the TS clients are
written against them.

## Target architecture

```
apps/api  ──HTTP──> services/local-stt  :8002   Zipformer-vi + Moonshine-en   (sherpa-onnx)
          ──HTTP──> services/local-tts  :8003   Kokoro-en                     (sherpa-onnx)
          ──HTTP──> services/vieneu-tts :8001   VieNeu-vi                     (vieneu)  [unchanged]
          ──HTTPS─> Gemini                      translation                   [unchanged, cloud]
```

Process boundary = functional boundary (STT vs TTS), per the accepted decision.
Runtime boundary (`sherpa-onnx` vs `vieneu`) is why VieNeu stays separate.

Provider resolution stays exactly as-is. `AiProvidersFactory` computes
`ttsBackend = targetLang === 'vi' ? 'vieneu' : ttsName`, so registering a TTS
provider named `local` is enough for en→Kokoro while vi keeps VieNeu. No
routing logic changes anywhere.

## HTTP contracts (authoritative — phases must not diverge)

**local-stt :8002**

| Route              | Request                                                                       | Response                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`     | —                                                                             | `200 {"status":"ok"}` when both engines loaded, else `503 {"status":"loading"}`                               |
| `POST /transcribe` | `multipart/form-data`: `file` (audio, any container), `language` (`vi`\|`en`) | `200 {"text":"…","language":"vi"}` · `400` empty/undecodable audio or bad language · `503` engines not loaded |

**local-tts :8003**

| Route              | Request                                                       | Response                                                                            |
| ------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /healthz`     | —                                                             | `200 {"status":"ok"}` / `503 {"status":"loading"}`                                  |
| `POST /synthesize` | JSON `{"text":"…","language":"en","voice":"0"?,"speed":1.0?}` | `200 audio/wav` (PCM16) · `400` empty text or `language != "en"` · `503` not loaded |

Multipart on STT (not JSON+base64) so `LocalSpeechSttProvider` mirrors the
existing `ElevenLabsSttProvider` FormData shape. JSON on TTS to mirror VieNeu.

## New environment variables

| Var                  | Default                                 | Owner                |
| -------------------- | --------------------------------------- | -------------------- |
| `AI_STT_PROVIDER`    | `local` (**changed** from `elevenlabs`) | `apps/api`           |
| `AI_TTS_PROVIDER`    | `local` (**changed** from `elevenlabs`) | `apps/api`           |
| `LOCAL_STT_URL`      | `http://localhost:8002`                 | `apps/api`           |
| `LOCAL_TTS_URL`      | `http://localhost:8003`                 | `apps/api`           |
| `LOCAL_TTS_VOICE_ID` | `0`                                     | `apps/api`           |
| `LOCAL_STT_THREADS`  | `8`                                     | `services/local-stt` |
| `LOCAL_TTS_THREADS`  | `8`                                     | `services/local-tts` |

8 threads = physical core count on the target machine; 8 beat 16 (hyperthreads)
in the recorded VieNeu spike. Must be exported to `OMP_NUM_THREADS` /
`MKL_NUM_THREADS` **before** the engine module is imported.

## Success Criteria

- [ ] `POST /translate` returns transcript + translation + audio for vi→en and en→vi with `ELEVENLABS_API_KEY` unset
- [ ] `GET /healthz` on :8002 and :8003 returns 200 once warm
- [ ] `pnpm dev:all` starts web, api, and all three sidecars
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm knip` all clean
- [ ] New provider specs pass alongside the existing translate specs
- [ ] Measured end-to-end latency for both directions recorded in a delivery report
- [ ] README + `docs/system-architecture.md` + `docs/codebase-summary.md` updated, Zipformer CC-BY-NC-ND-4.0 obligation stated

## Risks

| Risk                                                                                                                                       | Severity | Mitigation                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| PyAV wheel unavailable/broken on Windows + Python 3.11 — **the only unverified assumption in this plan**                                   | High     | Phase 1 Step 1 is a standalone spike gate. Fallback: ffmpeg subprocess (adds a system dependency; record the change in the delivery report)     |
| sherpa-onnx aborts the process instead of raising, because the loader picks ORT 1.17.1 from `System32`                                     | High     | `preload_onnxruntime_dll()` ported verbatim from the harness; called once before any engine import                                              |
| Flipping defaults to `local` changes the failure mode from `ProviderConfigError` (missing key) to `ProviderConnectionError` (sidecar down) | Medium   | Already mapped to 503 in `handlePipelineError`; Phase 4 adds a spec for that branch                                                             |
| Model weights (~500MB) accidentally committed                                                                                              | Medium   | Per-service `.gitignore` lands in Phase 1 Step 2, **before** any download runs (the repo ignores Python artifacts per service, not at the root) |
| `knip.json` `ignoreBinaries: ["blue,magenta"]` breaks when the `dev:all` colour list changes                                               | Low      | Phase 5 updates that entry in the same commit as the script                                                                                     |
| Serialized inference makes a second concurrent user wait                                                                                   | Low      | Accepted: +0.35s (STT) / +1.2s (TTS). Single-machine demo scope                                                                                 |
| `apps/api` jest can break from the known dual-jest hoisted-linker issue                                                                    | Low      | Pre-existing and known; report it, do not chase it inside this plan                                                                             |

## Open Questions

None. All design decisions were settled in the brainstorm contract.
