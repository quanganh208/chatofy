# STT CPU Benchmark Results — vi + en, local vs cloud

Primary run: `r1` | Raw metrics: `benchmarks/stt/results/` | Harness: `benchmarks/stt/`
Plan `plans/260718-1836-stt-cpu-benchmark-harness/` retired after completion — see git history.
Research context: `plans/reports/brainstorm-260718-1836-local-cpu-stt-vi-en-report.md`

## Environment

- CPU: Intel64 Family 6 Model 167 Stepping 1, GenuineIntel — 8 physical / 16 logical cores
- RAM: 32 GB
- OS: Windows 10.0.26200
- Python: 3.11.15; CPU-only, no GPU used
- Timing: per-utterance wall time, 1 untimed warmup per engine; engines run sequentially in isolated subprocesses

## Results — vi (50 utterances)

| Engine              | WER % | RTF (pooled) | Latency p50 s | p95 s | Peak RAM MB | Load s |
| ------------------- | ----- | ------------ | ------------- | ----- | ----------- | ------ |
| sherpa-zipformer-vi | 5.38  | 0.017        | 0.07          | 0.09  | 223         | 0.95   |
| fw-phowhisper-vi    | 7.71  | 0.332        | 1.33          | 1.40  | 972         | 1.35   |

## Results — en (50 utterances)

| Engine              | WER % | RTF (pooled) | Latency p50 s | p95 s | Peak RAM MB | Load s |
| ------------------- | ----- | ------------ | ------------- | ----- | ----------- | ------ |
| sherpa-moonshine-en | 3.86  | 0.040        | 0.22          | 0.34  | 418         | 1.25   |
| fw-whisper-small-en | 3.74  | 0.228        | 1.28          | 1.47  | 552         | 0.85   |

## Decision Matrix (targets: RTF <= 0.3, p95 <= 2s per utterance)

| Engine              | Lang | RTF pass | p95 pass | License                         |
| ------------------- | ---- | -------- | -------- | ------------------------------- |
| sherpa-moonshine-en | en   | PASS     | PASS     | MIT                             |
| fw-whisper-small-en | en   | PASS     | PASS     | MIT                             |
| sherpa-zipformer-vi | vi   | PASS     | PASS     | CC-BY-NC-ND-4.0 (academic only) |
| fw-phowhisper-vi    | vi   | FAIL     | PASS     | BSD-3-Clause                    |

## Run Variance (pooled RTF per run)

| Engine              | r1     | r2     | delta % |
| ------------------- | ------ | ------ | ------- |
| fw-phowhisper-vi    | 0.3316 | 0.3305 | 0.4     |
| fw-whisper-small-en | 0.2285 | 0.2284 | 0.0     |
| sherpa-moonshine-en | 0.0402 | 0.0404 | 0.6     |
| sherpa-zipformer-vi | 0.0169 | 0.0161 | 5.0     |

## Decode Parameters

- `fw-phowhisper-vi`: {"model": "diepho/PhoWhisper-small-ct2", "base_model": "vinai/PhoWhisper-small", "compute_type": "int8", "beam_size": 1, "num_threads": 8}
- `fw-whisper-small-en`: {"model": "Systran/faster-whisper-small.en", "base_model": "openai/whisper-small.en", "compute_type": "int8", "beam_size": 1, "num_threads": 8}
- `sherpa-moonshine-en`: {"model": "k2-fsa/sherpa-onnx asr-models/sherpa-onnx-moonshine-base-en-int8.tar.bz2", "quantization": "int8", "decoding_method": "greedy_search", "num_threads": 8}
- `sherpa-zipformer-vi`: {"model": "hynt/Zipformer-30M-RNNT-6000h", "files": ["encoder-epoch-20-avg-10.int8.onnx", "decoder-epoch-20-avg-10.int8.onnx", "joiner-epoch-20-avg-10.int8.onnx"], "quantization": "int8", "decoding_method": "greedy_search", "num_threads": 8}

## Recommendation

**Stack A wins decisively — adopt sherpa-onnx với Zipformer-30M (vi) + Moonshine base (en).**

- vi: Zipformer beats PhoWhisper-small on BOTH axes — WER 5.38% vs 7.71% AND
  RTF 0.017 vs 0.332 (~20x faster, 1/4 RAM). PhoWhisper-small INT8 greedy
  **fails** the RTF <= 0.3 target on this machine (0.332) — confirms the
  brainstorm risk flag; no reason to trade license for worse accuracy + speed.
- en: Moonshine base ~= whisper small.en on WER (3.86% vs 3.74%, within noise)
  but 5.7x faster (RTF 0.040 vs 0.228). Both pass targets; Moonshine chosen
  for headroom (p95 0.34s) and single-engine consistency with the vi slot.
- Both chosen models share one runtime (sherpa-onnx) → one sidecar, ~640MB
  peak RAM combined, load < 2.5s total. Evidence contradicting brainstorm
  estimates: none — measured numbers land within or better than research claims
  (Zipformer even faster than the cited 0.025).
- License obligation: Zipformer-30M is CC-BY-NC-ND-4.0 — academic/thesis use
  only; must be stated in thesis + README. Swap path if commercialized later:
  PhoWhisper via the same SttProvider contract (accepting ~1.3s/utterance) or
  retrain/license upgrade.

Cloud baseline (ElevenLabs Scribe v2): skipped — `ELEVENLABS_API_KEY` not set
in the benchmark shell. Decision unaffected (targets are absolute); WER-vs-cloud
comparison can be added later via
`uv run python run_benchmark.py --include-cloud --run-tag r1`.

## Unresolved Questions

- Cloud WER columns pending API key (see above) — nice-to-have for thesis, not
  blocking the model decision.
- Self-recorded conversational (app-domain) utterances not yet in the test set;
  manifest-driven, can be appended without code changes.

## Notes

- WER normalization: NFC, lowercase, punctuation stripped, diacritics kept; numbers as written (spoken-vs-digit mismatches count as errors).
- vi test set: VIVOS test subset (CC BY-NC-SA 4.0, measurement only); en: LibriSpeech test-clean subset (CC BY 4.0). Seed 42.
- Cloud rows measure wall latency including network; not an RTF.
