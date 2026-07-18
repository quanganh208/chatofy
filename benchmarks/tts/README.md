# tts benchmark harness

Measurement-only harness deciding the English TTS model that replaces
ElevenLabs (vi→en direction). Standalone `uv` project, mirrors
`benchmarks/stt/`; not part of the pnpm workspace.

Plan: `plans/260718-1933-tts-en-cpu-benchmark/`
Research context: `plans/reports/brainstorm-260718-1933-local-cpu-tts-en-report.md`

## Engines under test (both sherpa-onnx — same runtime as the chosen STT stack)

| Engine           | Model                        | License    | Claimed                     |
| ---------------- | ---------------------------- | ---------- | --------------------------- |
| sherpa-kokoro-en | Kokoro-82M (kokoro-en-v0_19) | Apache-2.0 | MOS ~4.5, RTF ~0.5 (4-core) |
| sherpa-piper-en  | Piper en_US-lessac-high      | MIT        | MOS ~4.0, RTF ~0.008        |

Metrics: per-sentence synthesis latency (mean/p50/p95), RTF (proc time /
generated audio duration), peak RAM (subprocess-isolated), load time. Plus
WAV outputs per engine for A/B listening. Decision rule: Kokoro p95 ≤2s per
sentence → Kokoro (quality); else Piper.

## Usage

```bash
cd benchmarks/tts
uv sync
uv run python scripts/download_models.py   # once, ~400MB total
uv run python run_benchmark.py --run-tag r1
uv run python run_benchmark.py --run-tag r2   # variance check
uv run pytest

# Regenerate the markdown report from all run tags:
uv run python run_benchmark.py --run-tag r2 --report-out ../../plans/reports/tts-en-cpu-benchmark-260718-results-report.md
```

WAVs for listening: `results/<tag>/wav/<engine>/<sentence_id>.wav`.
Latest results: `plans/reports/tts-en-cpu-benchmark-260718-results-report.md`.

Env: `TTS_BENCH_THREADS` (default 8). Windows note: engines preload the venv's
`onnxruntime.dll` before sherpa-onnx native code runs (System32 ships an old
ORT build that hard-crashes the process otherwise — same fix as benchmarks/stt).
