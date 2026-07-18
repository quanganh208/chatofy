---
phase: 3
title: Benchmark Run and Results Report
status: completed
effort: 0.5-1 day
priority: P2
dependencies:
  - 2
---

# Phase 3: Benchmark Run and Results Report

## Overview

Orchestrate the full run (all engines × languages, subprocess-isolated),
aggregate metrics, and generate the results report that drives the model
decision and the thesis comparison chapter.

## Requirements

- Functional: single command full run; aggregation → markdown report with
  decision matrix vs RTF ≤ 0.3 threshold
- Non-functional: run on quiesced machine (document conditions: plugged in,
  no dev servers); raw per-utterance JSONL kept for thesis appendix

## Architecture

```
benchmarks/stt/
├── run_benchmark.py           # orchestrator: subprocess run_engine per engine
└── stt_bench/report.py        # aggregate results/*.jsonl -> markdown tables
```

Report destination:
`plans/reports/stt-cpu-benchmark-260718-results-report.md` (repo-tracked;
raw JSONL stays gitignored under `benchmarks/stt/results/`).

Report contents:

1. Environment header: CPU model, cores, RAM, OS build, thread setting,
   decode params, model versions/revisions (from Phase 2 headers)
2. Per-language tables: engine | WER% | RTF mean | latency p50/p95 (s per
   5–10s utt) | peak RAM MB | load time s
3. Cloud row: WER + wall-latency (labeled "incl. network", not RTF)
4. Decision matrix: pass/fail vs RTF ≤ 0.3 and ≤2s per-utterance targets;
   license column (BSD/MIT vs CC-BY-NC-ND) carried from brainstorm report
5. Recommendation section: chosen vi + en models with 2–3 sentence rationale;
   explicit note if evidence contradicts brainstorm estimates
6. Unresolved questions (e.g. self-recorded domain audio still to add)

## Related Code Files

- Create: `benchmarks/stt/run_benchmark.py`, `benchmarks/stt/stt_bench/report.py`,
  `plans/reports/stt-cpu-benchmark-260718-results-report.md` (generated)
- Modify: `benchmarks/stt/README.md` (full run instructions)
- Delete: none

## Implementation Steps

1. `run_benchmark.py`: for each engine id → spawn `run_engine.py` subprocess
   sequentially (never parallel — engines must not contend for CPU),
   collect `results/{engine}.jsonl`
2. `report.py`: aggregate → compute per-engine WER (corpus-level via jiwer),
   RTF stats, latency percentiles; render markdown; `--out` path param
3. Execute full local run (4 local engines × manifests); rerun once to check
   variance <10% on RTF; record both runs
4. Execute cloud baseline (if `ELEVENLABS_API_KEY` present)
5. Generate report to `plans/reports/`; sanity-review numbers vs research
   estimates; write recommendation
6. Update brainstorm report "Decision" section with measured outcome pointer

## Success Criteria

- [ ] `uv run python run_benchmark.py` completes all local engines unattended
- [ ] Report exists in `plans/reports/` with all tables + environment header
- [ ] Decision matrix answers: which vi model and which en model meet RTF ≤ 0.3
- [ ] Recommendation recorded; brainstorm report cross-linked
- [ ] RTF variance between 2 runs <10% (else rerun with machine quiesced)

## Risk Assessment

- Background Windows processes skew timing → document run conditions; 2-run
  variance check; report medians alongside means
- Cloud credit/key unavailable → local-only report, cloud column "pending",
  WER comparison vs cloud deferred (not blocking model decision — threshold
  is absolute, not relative)
- All Stack B engines fail RTF target → still a valid outcome; decision falls
  to Stack A per brainstorm trade-off analysis (license note mandatory)
