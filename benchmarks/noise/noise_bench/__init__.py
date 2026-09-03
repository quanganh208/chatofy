"""Noisy-WER harness.

Two things live here and are deliberately kept apart so the first can be tested
without the second's dependencies:

- `mix` — add noise to clean speech at a target SNR. Pure numpy, no service, no
  model; this is the part with the arithmetic worth testing.
- `transcribe` — post a WAV to the real STT sidecar and read the text back.

The orchestrator `run_noise_wer.py` at the package root joins them and scores the
result with stt-bench's WER, so the noisy numbers are comparable with the clean
STT benchmark.
"""
