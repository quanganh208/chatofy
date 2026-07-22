# TTS EN CPU Benchmark Results — Kokoro-82M vs Piper (sherpa-onnx)

Primary run: `r1` | Raw metrics: `benchmarks/tts/results/` | Harness: `benchmarks/tts/`
Plan `plans/260718-1933-tts-en-cpu-benchmark/` retired after completion — see git history.
Research context: `plans/reports/brainstorm-260718-1933-local-cpu-tts-en-report.md`

## Environment

- CPU: Intel64 Family 6 Model 167 Stepping 1, GenuineIntel — 8 physical / 16 logical cores
- RAM: 32 GB
- OS: Windows 10.0.26200
- Python: 3.11.15; CPU-only; sherpa-onnx OfflineTts
- Timing: per-sentence wall time, 1 untimed warmup; engines sequential in isolated subprocesses; RTF = synth time / generated audio duration

## Results (30 sentences, 5-20 words)

| Engine           | Latency mean s | p50 s | p95 s | RTF (pooled) | Avg audio s | Peak RAM MB | Load s |
| ---------------- | -------------- | ----- | ----- | ------------ | ----------- | ----------- | ------ |
| sherpa-piper-en  | 0.45           | 0.45  | 0.57  | 0.154        | 2.9         | 323         | 1.61   |
| sherpa-kokoro-en | 0.97           | 0.99  | 1.18  | 0.323        | 3.0         | 619         | 1.07   |

## Decision Matrix (target: p95 <= 2s per sentence)

| Engine           | p95 pass | License                         |
| ---------------- | -------- | ------------------------------- |
| sherpa-piper-en  | PASS     | MIT (voice: lessac, permissive) |
| sherpa-kokoro-en | PASS     | Apache-2.0                      |

## Run Variance (pooled RTF per run)

| Engine           | r1     | r2     | delta % |
| ---------------- | ------ | ------ | ------- |
| sherpa-kokoro-en | 0.3227 | 0.3191 | 1.1     |
| sherpa-piper-en  | 0.1545 | 0.1537 | 0.5     |

## Decode Parameters

- `sherpa-kokoro-en`: {"model": "k2-fsa/sherpa-onnx tts-models/kokoro-en-v0_19.tar.bz2", "base_model": "hexgrad/Kokoro-82M", "sid": 0, "speed": 1.0, "num_threads": 8}
- `sherpa-piper-en`: {"model": "k2-fsa/sherpa-onnx tts-models/vits-piper-en_US-lessac-high.tar.bz2", "base_model": "rhasspy/piper en_US-lessac-high", "speed": 1.0, "num_threads": 8}

## A/B Listening Verdict

User (2026-07-18) A/B-compared r1 WAVs (s001/s003/s015/s027 pairs) and chose
**Kokoro-82M** — quality gap judged worth the extra latency. Solo-listener
verdict; mini-MOS panel noted as future thesis rigor.

## Decision

**Kokoro-82M (kokoro-en-v0_19, sherpa-onnx) is the English TTS model.**

- Objective: p95 1.18s/sentence — PASS the ≤2s rule with headroom; RTF 0.32,
  619MB RAM, load ~1s. On this 8-core machine Kokoro beat its published 4-core
  RTF (~0.5), vindicating the benchmark-first call.
- Subjective: user verdict above (quality-first rule holds; no override).
- License: Apache-2.0 — clean for thesis AND commercial (better than the vi
  STT model's CC-BY-NC-ND).
- Architecture: joins the same sherpa-onnx runtime as Zipformer-vi + Moonshine-en
  STT → future unified local speech sidecar covers STT vi/en + TTS en in one
  process; VieNeu sidecar stays for TTS vi.
- Piper lessac-high recorded as the latency-first fallback (p95 0.57s, MIT).

Full local pipeline latency estimate per turn (vi→en): STT ~0.25s + translate
(cloud Gemini ~1s) + TTS ~1s ≈ **2.3s** — comparable to the current
cloud-based flow.

## Notes

- Sentence set: benchmarks/tts/data/sentences-en.txt (30 conversational translation-style sentences, committed for reproducibility).
- Latency is the UX-relevant metric for the turn-based pipeline; RTF normalizes across engines' different speaking rates.
