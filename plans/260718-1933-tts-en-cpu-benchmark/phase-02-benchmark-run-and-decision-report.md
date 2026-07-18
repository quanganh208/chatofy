---
phase: 2
title: Benchmark Run and Decision Report
status: completed
effort: 0.5 day
priority: P2
dependencies:
  - 1
---

# Phase 2: Benchmark Run and Decision Report

## Overview

Run both engines twice (variance check), aggregate metrics into the results
report, collect the user's A/B listening verdict, and record the model
decision.

## Requirements

- Functional: aggregation → markdown report to `plans/reports/`; decision vs
  the ≤2s-per-sentence rule; A/B listening step with user verdict recorded
- Non-functional: quiesced machine, sequential runs, raw JSONL + WAVs kept
  under gitignored `results/`

## Architecture

- `tts_bench/report.py` — aggregate `results/{tag}/{engine}.jsonl` →
  markdown: environment header, per-engine table (latency mean/p50/p95, RTF,
  peak RAM, load), 2-run variance, decision matrix (≤2s/sentence + license),
  decode params, A/B verdict section (filled after listening)
- Report path: `plans/reports/tts-en-cpu-benchmark-260718-results-report.md`

Decision rule (from brainstorm report): Kokoro p95 ≤2s/sentence on this
machine → Kokoro (quality-first); else → Piper. User listening verdict can
override toward Piper if Kokoro quality gain is judged not worth its latency,
but not vice versa (a FAIL on latency cannot be overridden).

## Related Code Files

- Create: `benchmarks/tts/tts_bench/report.py`,
  `plans/reports/tts-en-cpu-benchmark-260718-results-report.md` (generated + verdict)
- Modify: `benchmarks/tts/README.md` (run instructions)
- Delete: none

## Implementation Steps

1. `report.py` (adapt stt report structure; no WER — replace with A/B section)
2. Full run r1 + r2; check RTF variance <10%
3. Generate report; present WAV paths to the user for A/B listening
   (same 3-5 representative sentences per engine); record verdict in report
4. Write decision + rationale; cross-link the TTS brainstorm report
   (`brainstorm-260718-1933-local-cpu-tts-en-report.md`) with measured outcome
5. Update memory + journal at session finalize

## Success Criteria

- [ ] Both engines measured over full sentence set, 2 runs, variance <10%
- [ ] Report in plans/reports with decision matrix + license table
- [ ] User A/B verdict recorded in the report
- [ ] Final model decision written (Kokoro or Piper) with rationale

## Risk Assessment

- Kokoro borderline vs 2s rule (e.g. p95 2.1s) → present numbers + WAVs, let
  user decide; document as user decision
- Subjective verdict is solo-listener → note as thesis limitation; mini-MOS
  panel listed as future work
