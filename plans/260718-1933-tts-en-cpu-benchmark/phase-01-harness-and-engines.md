---
phase: 1
title: Harness and Engines
status: completed
effort: 0.5 day
priority: P2
dependencies: []
---

# Phase 1: Harness and Engines

## Overview

Scaffold `benchmarks/tts/` uv project with a sentence set, two sherpa-onnx
TTS engines (Kokoro, Piper), and a per-engine subprocess runner measuring
latency/RTF/RAM and writing WAVs for A/B listening.

## Requirements

- Functional: `synthesize(text) -> wav samples` per engine; load timed
  separately; 1 untimed warmup; WAV outputs saved per engine
- Non-functional: CPU-only, `TTS_BENCH_THREADS` (default 8); Windows-verified;
  reuse the onnxruntime DLL preload fix from the STT harness

## Architecture

```
benchmarks/tts/
├── pyproject.toml            # uv, py >=3.11.4; sherpa-onnx, soundfile, numpy, psutil, huggingface_hub
├── README.md
├── .gitignore                # models/, results/, .venv/
├── data/
│   └── sentences-en.txt      # ~30 translated-style sentences, 5-20 words (COMMITTED — small text)
├── scripts/
│   └── download_models.py    # kokoro + piper packages from k2-fsa release assets
├── tts_bench/
│   ├── __init__.py
│   ├── measure.py            # latency_stats + PeakRssSampler + preload_onnxruntime_dll
│   │                         # (small self-contained copies from stt_bench — projects stay independent)
│   ├── engines/
│   │   ├── __init__.py       # ENGINE_REGISTRY
│   │   ├── base.py           # TtsEngine ABC: load(), synthesize(text) -> (samples, sample_rate)
│   │   ├── sherpa_kokoro_en.py
│   │   └── sherpa_piper_en.py
│   └── run_engine.py         # CLI: --engine X --sentences data/sentences-en.txt --out results/<tag>/
└── run_benchmark.py          # sequential subprocess orchestrator (same shape as stt)
```

Models (k2-fsa sherpa-onnx release assets, extracted to models/):

- Kokoro: `kokoro-en-v0_19.tar.bz2` (English-focused; verify current asset name
  in sherpa-onnx TTS docs at implementation time; fall back to multi-lang v1_0)
- Piper: `vits-piper-en_US-lessac-high.tar.bz2`

Engine API: `sherpa_onnx.OfflineTts` with `OfflineTtsConfig` (kokoro/vits model
configs); `tts.generate(text, sid=0, speed=1.0)` → samples + sample_rate.

Per-sentence result JSONL mirrors STT shape: header {engine, load_s,
peak_rss_mb, decode_params} + rows {sentence_id, n_words, audio_s (generated),
proc_s, rtf}. RTF here = proc_s / generated_audio_s.

Sentence set: ~30 English sentences shaped like app output (conversational
translations, 5–20 words, mix of lengths + numbers + names). Committed as
plain text so the benchmark is reproducible.

## Related Code Files

- Create: everything under `benchmarks/tts/`
- Modify: none elsewhere
- Delete: none

## Implementation Steps

1. Scaffold uv project + deps; write `sentences-en.txt`
2. `measure.py` (copy latency_stats, PeakRssSampler, preload_onnxruntime_dll
   from stt_bench — keep self-contained, no cross-project import)
3. `download_models.py` — fetch + extract both model tarballs (idempotent)
4. Engines: `sherpa_kokoro_en.py`, `sherpa_piper_en.py` (OfflineTts, threads
   from env, decode_params with model/version/speed/sid)
5. `run_engine.py`: load → warmup 1 sentence → per-sentence timed synth →
   write JSONL + WAV per sentence to `results/<tag>/wav/<engine>/`
6. `run_benchmark.py`: sequential subprocess per engine
7. Smoke-test both engines on 2 sentences; verify WAV playable + timing sane

## Success Criteria

- [ ] Both engines synthesize on this machine CPU-only via sherpa-onnx
- [ ] JSONL header has load_s + peak_rss_mb + decode_params
- [ ] WAVs written per engine, listenable
- [ ] No files outside benchmarks/tts/ touched

## Risk Assessment

- Kokoro asset name/format drift in sherpa-onnx releases → check docs/HF at
  step 3; multi-lang v1_0 fallback
- espeak-ng data needed by some vits/kokoro packages → bundled in k2-fsa
  tarballs; verify at smoke test
- DLL collision (known) → preload fix copied from stt harness
