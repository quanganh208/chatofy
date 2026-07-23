# stt benchmark harness

Measurement-only harness comparing STT stacks on CPU for the model decision +
thesis comparison chapter. **Not** part of the pnpm/turbo workspace and never
imported by the app — standalone `uv` Python project (same convention as
`services/local-stt`).

Plan: `plans/260718-1836-stt-cpu-benchmark-harness/`
Research context: `plans/reports/brainstorm-260718-1836-local-cpu-stt-vi-en-report.md`

## Stacks under test

| Stack    | vi                        | en                    | Engine         |
| -------- | ------------------------- | --------------------- | -------------- |
| A        | Zipformer-30M-RNNT-6000h  | Moonshine base        | sherpa-onnx    |
| B        | PhoWhisper-small CT2 INT8 | whisper small.en INT8 | faster-whisper |
| Baseline | ElevenLabs Scribe v2      | ElevenLabs Scribe v2  | cloud REST     |

Metrics: WER (shared normalization), RTF + latency p50/p95, peak RAM per
engine (subprocess-isolated), model load time. Decision threshold: RTF ≤ 0.3.

## Setup

```bash
cd benchmarks/stt
uv sync
```

## Prepare test data (once)

```bash
uv run python scripts/prepare_datasets.py
```

Downloads VIVOS test split (vi, CC BY-NC-SA 4.0 — measurement use only) and
LibriSpeech test-clean (en, CC BY 4.0), selects 50 utterances/lang (3–10s,
seed 42), converts to 16 kHz mono WAV, writes `data/manifest-{vi,en}.jsonl`.

## Test

```bash
uv run pytest
```

## Download models (once)

```bash
uv run python scripts/download_models.py
```

Caches Zipformer-30M vi (+ generates tokens.txt from bpe.model), Moonshine
base en INT8, PhoWhisper-small CT2, whisper small.en CT2 into `models/`.

## Run benchmark

```bash
uv run python run_benchmark.py --run-tag r1            # 4 local engines
uv run python run_benchmark.py --run-tag r2            # variance-check rerun
uv run python run_benchmark.py --include-cloud ...     # + ElevenLabs baseline
```

Engines run sequentially, each in its own subprocess (isolated peak-RAM
measurement, no CPU contention). Render the markdown report from all run tags:

```bash
uv run python -c "from pathlib import Path; from stt_bench.report import render_report; print(render_report(Path('results')))"
```

Latest results: `plans/reports/stt-cpu-benchmark-260718-results-report.md`
(repo root). Environment:

- `STT_BENCH_THREADS` — CPU threads per engine (default 8, physical cores)
- `ELEVENLABS_API_KEY` — required only for the cloud baseline rows

Windows note: the sherpa-onnx wheel does not bundle `onnxruntime.dll`; the
engines preload the venv's copy before use so the ORT 1.17 build that ships in
`System32` cannot be picked up (that mismatch hard-crashes the process).
