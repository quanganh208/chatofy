---
title: 'STT CPU Benchmark Harness (vi+en): sherpa-onnx vs faster-whisper vs cloud'
description: >-
  Standalone uv Python harness measuring WER, RTF/latency, peak RAM of local CPU
  STT stacks vs ElevenLabs cloud baseline; results drive model decision + thesis
  comparison chapter
status: completed
priority: P2
branch: main
tags:
  - stt
  - benchmark
  - thesis
blockedBy: []
blocks: []
created: '2026-07-18T11:39:57.342Z'
createdBy: 'ck:plan'
source: skill
---

# STT CPU Benchmark Harness (vi+en): sherpa-onnx vs faster-whisper vs cloud

## Overview

Measurement-only harness (NO app integration) comparing 3 STT stacks on target
Windows 8-core CPU / 32GB RAM machine:

- **Stack A (sherpa-onnx):** Zipformer-30M-RNNT-6000h (vi) + Moonshine base (en)
- **Stack B (faster-whisper INT8):** PhoWhisper-small CT2 (vi) + whisper small.en (en)
- **Baseline (cloud):** ElevenLabs Scribe v2 REST

Metrics: WER (normalized), RTF + latency (mean/p50/p95), peak RAM per engine,
model load time. Decision threshold: RTF ≤ 0.3 (5–10s utterance → ≤2s).

Context: `plans/reports/brainstorm-260718-1836-local-cpu-stt-vi-en-report.md`
(locked requirements, candidate research, user decision = benchmark-first).

Harness lives at `benchmarks/stt/` — standalone uv project outside the
pnpm/turbo workspace, same convention as `services/vieneu-tts`. Results feed
thesis comparison chapter and the final model choice; harness stays in repo as
reproducible thesis artifact.

## Phases

| Phase | Name                                                                               | Status    |
| ----- | ---------------------------------------------------------------------------------- | --------- |
| 1     | [Dataset and Metrics Foundation](./phase-01-dataset-and-metrics-foundation.md)     | Completed |
| 2     | [Engine Runners](./phase-02-engine-runners.md)                                     | Completed |
| 3     | [Benchmark Run and Results Report](./phase-03-benchmark-run-and-results-report.md) | Completed |

## Dependencies

- Phase 2 depends on Phase 1 (manifest format + metrics utils)
- Phase 3 depends on Phase 2 (all runners working)
- No cross-plan dependencies; future "STT integration" plan will be blockedBy this one

## Acceptance Criteria

- One command runs all engines × both languages, emits results JSONL + markdown report
- ≥50 utterances per language with reference transcripts; identical normalization for all engines
- Per-engine peak RAM isolated (subprocess per engine)
- Results report includes decision matrix vs RTF ≤ 0.3 threshold + recommendation
- No changes to apps/, packages/, services/ existing code

## Open Questions

- PhoWhisper-small CT2 INT8: use existing HF conversion (quocphu/kiendt) or convert locally with ct2-transformers-converter — Phase 2 tries HF first, falls back to local conversion
- ElevenLabs baseline needs `ELEVENLABS_API_KEY` + credit; if unavailable, run local-only and mark cloud column pending
