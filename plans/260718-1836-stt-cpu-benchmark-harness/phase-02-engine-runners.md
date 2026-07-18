---
phase: 2
title: Engine Runners
status: completed
effort: 1-1.5 days
priority: P2
dependencies:
  - 1
---

# Phase 2: Engine Runners

## Overview

Implement the 5 engine runners behind one `SttEngine` interface: Stack A
(sherpa-onnx: Zipformer-30M vi, Moonshine base en), Stack B (faster-whisper
INT8: PhoWhisper-small vi, whisper small.en), and ElevenLabs Scribe v2 cloud
baseline. Each engine runs in its own subprocess so peak RAM is isolated.

## Requirements

- Functional: `transcribe(wav_path) -> text` per engine; model load timed
  separately from inference; 1 warmup utterance excluded from timing
- Non-functional: CPU-only, threads configurable (`STT_BENCH_THREADS`,
  default 8 — mirrors `VIENEU_THREADS` convention); Windows-verified

## Architecture

```
benchmarks/stt/stt_bench/
├── engines/
│   ├── __init__.py            # ENGINE_REGISTRY: id -> factory + lang
│   ├── base.py                # SttEngine protocol: name, lang, load(), transcribe()
│   ├── sherpa_zipformer_vi.py # hynt/Zipformer-30M-RNNT-6000h via sherpa-onnx
│   ├── sherpa_moonshine_en.py # Moonshine base ONNX via sherpa-onnx
│   ├── fw_phowhisper_vi.py    # PhoWhisper-small CT2 INT8 via faster-whisper
│   ├── fw_whisper_small_en.py # whisper small.en INT8 via faster-whisper
│   └── elevenlabs_cloud.py    # Scribe v2 REST (mirrors app provider request shape)
├── run_engine.py              # CLI: --engine X --manifest Y --out results/X.jsonl
└── scripts/download_models.py # fetch + cache all local models to models/
```

Engine ids: `sherpa-zipformer-vi`, `sherpa-moonshine-en`, `fw-phowhisper-vi`,
`fw-whisper-small-en`, `elevenlabs-vi`, `elevenlabs-en` (cloud engine is
language-parameterized, same code).

Per-utterance result JSONL: `{engine, utt_id, lang, hyp_text, proc_s,
audio_s, rtf}` + one header record `{engine, load_s, peak_rss_mb, threads,
model_version}`.

Cloud runner: measures wall latency (network incl.) — comparable for UX, NOT
labeled RTF in report; WER fully comparable. Reads `ELEVENLABS_API_KEY` from
env (never committed).

Deps added: `sherpa-onnx`, `faster-whisper`, `huggingface_hub`, `requests`.

## Related Code Files

- Create: files per tree above; extend `benchmarks/stt/pyproject.toml`
- Modify: none outside `benchmarks/stt/`
- Delete: none

## Implementation Steps

1. `base.py` protocol + `ENGINE_REGISTRY`
2. `download_models.py`: HF hub fetch → `models/` (gitignored):
   Zipformer-30M (hynt), Moonshine base ONNX (sherpa-onnx release assets),
   PhoWhisper-small CT2 INT8 (try HF conversions `kiendt/`/`quocphu/` first;
   fallback: `ct2-transformers-converter --model vinai/PhoWhisper-small
--quantization int8`), whisper `small.en` (faster-whisper auto-download)
3. Implement sherpa runners (offline recognizer API, num_threads from env);
   smoke-test on 1 manifest utterance each — **this validates the two research
   unknowns: Moonshine-in-sherpa-onnx on Windows + Zipformer RTF claim**
4. Implement faster-whisper runners (`compute_type="int8"`, `beam_size=1`
   greedy — record decode params in header for thesis reproducibility)
5. Implement `elevenlabs_cloud.py` (multipart POST, model_id scribe_v2,
   language_code param — same contract as app's provider)
6. `run_engine.py`: load engine → warmup → iterate manifest → write JSONL;
   wraps run in `PeakRssSampler`; parent orchestrator (Phase 3) invokes it as
   subprocess per engine
7. Smoke-test each engine on 3 utterances; fix Windows-specific issues here

## Success Criteria

- [ ] All 4 local engines transcribe a manifest utterance on this machine, CPU-only
- [ ] Cloud engine works with API key (or documented-skipped)
- [ ] `run_engine.py --engine <id>` emits valid JSONL incl. load_s + peak_rss_mb
- [ ] Decode/thread params captured in output header

## Risk Assessment

- Moonshine via sherpa-onnx fails on Windows → fallback `useful-moonshine-onnx`
  package as separate engine impl (same interface; registry swap)
- PhoWhisper HF CT2 conversion missing/broken → local ct2 conversion step
  (documented in download script)
- PhoWhisper RTF worse than estimate → that IS a benchmark finding, not a
  blocker; report records it
- HF download sizes (~1–2 GB total) → cached in user HF cache + models/
