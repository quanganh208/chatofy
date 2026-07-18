---
title: 'TTS EN CPU Benchmark: Kokoro-82M vs Piper via sherpa-onnx'
description: >-
  Measure RTF/latency/RAM of Kokoro vs Piper English TTS on target CPU + A/B
  listening WAVs; decides the model replacing ElevenLabs TTS (en)
status: completed
priority: P2
branch: main
tags:
  - tts
  - benchmark
  - thesis
blockedBy: []
blocks: []
created: '2026-07-18T12:41:57.872Z'
createdBy: 'ck:plan'
source: skill
---

# TTS EN CPU Benchmark: Kokoro-82M vs Piper via sherpa-onnx

## Overview

Measurement-only harness at `benchmarks/tts/` (standalone uv project, mirrors
`benchmarks/stt/`) comparing English TTS candidates on the target 8-core
Windows CPU:

- **Kokoro-82M** (Apache-2.0, MOS ~4.5, published RTF ~0.5 on 4-core — unverified here)
- **Piper en_US-lessac-high** (MIT, MOS ~4.0, RTF ~0.008)

Both run via **sherpa-onnx OfflineTts** — same runtime as the chosen STT stack,
so the winner joins the future unified speech sidecar unchanged.

Objective metrics: latency per sentence, RTF, peak RAM, load time (reusing the
STT harness measurement patterns + the Windows onnxruntime DLL preload fix).
Subjective metric: identical sentence set synthesized to WAV per engine for
A/B listening (user verdict recorded in the report).

Decision rule (from brainstorm `plans/reports/brainstorm-260718-1933-local-cpu-tts-en-report.md`):
if Kokoro achieves ≲2s per typical sentence on this machine → Kokoro (quality);
otherwise → Piper (speed). Results feed the thesis comparison chapter.

## Phases

| Phase | Name                                                                                 | Status    |
| ----- | ------------------------------------------------------------------------------------ | --------- |
| 1     | [Harness and Engines](./phase-01-harness-and-engines.md)                             | Completed |
| 2     | [Benchmark Run and Decision Report](./phase-02-benchmark-run-and-decision-report.md) | Completed |

## Dependencies

- Phase 2 depends on Phase 1
- Builds on decisions from `plans/260718-1836-stt-cpu-benchmark-harness/` (completed);
  future speech-sidecar integration plan will be blockedBy this one

## Acceptance Criteria

- One command benchmarks both engines over the same ~30-sentence set, emits
  results JSONL + WAV files + markdown report
- Report: latency mean/p50/p95 per sentence, RTF, peak RAM (subprocess-isolated),
  load time, 2-run variance <10%, decision vs ≤2s/sentence rule, license table
- A/B WAVs organized for listening (`results/<tag>/wav/<engine>/<id>.wav`)
- No changes outside `benchmarks/tts/` + plans/reports

## Open Questions

- Kokoro model choice: sherpa-onnx `kokoro-en-v0_19` vs `kokoro-multi-lang-v1_0`
  — Phase 1 picks the English-focused package with best sherpa-onnx support
- User A/B verdict method: solo listening is enough for the decision; mini-MOS
  panel optional later for thesis rigor
