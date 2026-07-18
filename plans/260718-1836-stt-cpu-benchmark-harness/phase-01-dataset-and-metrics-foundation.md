---
phase: 1
title: Dataset and Metrics Foundation
status: completed
effort: 0.5-1 day
priority: P2
dependencies: []
---

# Phase 1: Dataset and Metrics Foundation

## Overview

Scaffold `benchmarks/stt/` uv project; prepare vi + en test sets with reference
transcripts; build metrics utilities (WER normalization, RTF, RAM sampling)
shared by all engine runners.

## Requirements

- Functional: reproducible test manifest (≥50 utterances/lang, 3–10s each);
  metrics computed identically for every engine
- Non-functional: Windows-compatible; datasets cached locally, gitignored;
  no app code touched

## Architecture

```
benchmarks/stt/
├── pyproject.toml            # uv project; py 3.11 (match vieneu-tts)
├── README.md                 # setup + run instructions
├── .gitignore                # data/, models/, results/
├── data/                     # downloaded audio + manifests (gitignored)
├── scripts/
│   └── prepare_datasets.py   # download + convert + build manifests
└── stt_bench/
    ├── __init__.py
    ├── manifest.py           # load/validate manifest JSONL
    ├── text_normalize.py     # shared normalization for WER
    └── metrics.py            # WER (jiwer), RTF, latency stats, RAM sampler
```

Manifest JSONL per utterance: `{id, lang, audio_path, ref_text, duration_s}`.
Audio normalized to 16 kHz mono PCM16 WAV (all engines accept; ffmpeg convert).

Test sets:

- vi: VIVOS test split subset (~50 utts, HF `AILAB-VNUHCM/vivos`; CC BY-NC-SA —
  measurement-only use, note license in README)
- en: LibriSpeech test-clean subset (~50 utts, openslr.org; CC BY 4.0)
- optional: 10 self-recorded conversational utterances/lang (app-domain; add
  later without code change — manifest-driven)

Normalization (applied to ref + hypothesis before WER): Unicode NFC, lowercase,
strip punctuation, collapse whitespace. Keep Vietnamese diacritics intact.
Numbers left as-is (note as known WER caveat in report).

RAM sampler: psutil polling thread sampling process-tree RSS at 100ms,
records peak; used by Phase 2 subprocess runner.

## Related Code Files

- Create: everything under `benchmarks/stt/` per tree above
- Modify: root `.gitignore` only if needed (benchmarks/stt has its own)
- Delete: none

## Implementation Steps

1. `uv init` benchmarks/stt, py 3.11; deps: `jiwer`, `psutil`, `soundfile`,
   `numpy`; dev deps: `pytest`. ffmpeg documented as system prereq (already
   required by repo tooling)
2. `text_normalize.py` + unit tests (Vietnamese diacritics preserved,
   punctuation stripped, NFC)
3. `metrics.py`: `wer(refs, hyps)`, `rtf(proc_s, audio_s)`,
   `latency_stats(samples) -> mean/p50/p95`, `PeakRssSampler`
4. `prepare_datasets.py`: download VIVOS (HF hub) + LibriSpeech test-clean
   (openslr tarball), select N utterances 3–10s deterministically (seeded),
   ffmpeg → 16k mono WAV, emit `data/manifest-{vi,en}.jsonl`
5. `manifest.py`: load + validate (files exist, durations in range)
6. Run prepare script; verify manifests; `uv run pytest`

## Success Criteria

- [ ] `uv run python scripts/prepare_datasets.py` produces both manifests with ≥50 utts each
- [ ] All manifest audio is 16 kHz mono WAV, 3–10s
- [ ] pytest green on normalization + metrics units
- [ ] Nothing outside `benchmarks/stt/` modified

## Risk Assessment

- VIVOS HF download flaky → fallback direct AILAB mirror; step is cached/idempotent
- Utterance selection bias → deterministic seed; record selection in manifest
- ffmpeg missing on machine → check at script start, actionable error
