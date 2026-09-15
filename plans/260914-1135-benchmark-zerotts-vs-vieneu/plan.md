---
title: 'Benchmark ZeroTTS vs VieNeu-TTS v3 Turbo (Vietnamese TTS, CPU)'
description: 'Measure ZeroTTS against the Vietnamese voice services/local-tts ships today, on latency, RTF, peak RAM, time-to-first-audio, and ASR round-trip intelligibility.'
status: completed
priority: P2
effort: 13.5h
branch: feat/conversation-audio-recording
tags: [benchmark, tts, vietnamese, speech]
blockedBy: []
blocks: []
created: 2026-09-14
---

# Benchmark ZeroTTS vs VieNeu-TTS v3 Turbo

## Overview

`services/local-tts` synthesizes Vietnamese with **VieNeu-TTS v3 Turbo** (fp32
ONNX, CPU). It measures **1402 ms p50 per sentence in-service**
(`docs/development-journey.md`), and its two voices were chosen by one person
listening — no quality figure has ever been recorded for it.

**ZeroTTS** (zeroweight-ai, released 2026-08-19) is a plausible replacement:
202M parameters, fp32 ONNX, CPU-only, MIT-licensed, eight built-in Vietnamese
presets, 48 kHz output. Its vendor claims 70 ms to first audio sample, RTF 0.50×,
and 1.03% WER.

This plan builds `benchmarks/tts-vi` to test those claims on this machine against
the incumbent, and to produce the first recorded quality number for Vietnamese
TTS in this repo.

**The vendor numbers are hypotheses, not baselines.** The upstream repo is about
four weeks old, every Hugging Face `model-index` entry carries `"verified": false`,
no CPU hardware is named alongside the figures, and no independent reproduction
exists.

## Goals

| #   | Goal                                                                                                                              | Priority |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Measure both engines on identical Vietnamese sentences: latency per word, RTF, speaking rate, peak RSS, load time                 | P1       |
| 2   | Measure time-to-first-audio against the configuration that actually ships — VieNeu **clause-split**, not whole-sentence           | P1       |
| 3   | Produce the first intelligibility figure (ASR round-trip WER/CER) for Vietnamese TTS in this repo, against a human-speech control | P1       |
| 4   | Reach a stated verdict on replacing VieNeu — including "too close to call"                                                        | P1       |
| 5   | Record the comparison in `docs/development-journey.md` as thesis evidence                                                         | P2       |
| 6   | Resolve VieNeu v3 Turbo's actual upstream licence, which the swap decision depends on                                             | P2       |

## Why a new harness rather than extending `benchmarks/tts`

`benchmarks/tts` self-describes as the harness that chose the **English** voice:
its `TtsEngine` docstring says "(English slot)", `ENGINES` is hardcoded to two
sherpa engines, and its only data file is `sentences-en.txt`. The intelligibility
stage additionally needs `faster-whisper`, which does not belong in a TTS latency
harness. Its tracked `results/r{1,2}/*.jsonl` are the recorded evidence behind a
decision already shipped, so re-pointing it at Vietnamese would disturb that
record.

The repo has already settled this trade-off explicitly, in
`benchmarks/tts/tts_bench/measure.py`:

> Self-contained copies of the patterns proven in benchmarks/stt … the two
> benchmark projects stay independent on purpose so either can be deleted or
> evolved without breaking the other.

Five standalone harnesses follow that convention; this makes six. Roughly 610
lines get vendored. If the direction turns out wrong, abandoning it costs one
directory.

One coupling this does create, which the convention does not cover: the
`text_normalize.py` copy must stay identical to `benchmarks/stt`'s, or the
control floors below stop applying. Phase 4 records that in the file itself.

## Phases

| #   | Phase                                                                          | Depends on | Status |
| --- | ------------------------------------------------------------------------------ | ---------- | ------ |
| 1   | [Harness and engines](./phase-01-harness-and-engines.md)                       | —          | Done   |
| 2   | [Sentence sets](./phase-02-sentence-sets.md)                                   | —          | Done   |
| 3   | [Synthesis and TTFA measurement](./phase-03-synthesis-and-ttfa-measurement.md) | 1, 2       | Done   |
| 4   | [Intelligibility round-trip](./phase-04-intelligibility-round-trip.md)         | 3          | Done   |
| 5   | [Report and verdict](./phase-05-report-and-verdict.md)                         | 4          | Done   |

Phases 1 and 2 are independent and may run in parallel — phase 2 writes only
`data/`, phase 1 everything else.

**Follow-up, 2026-09-15.** Phase 1's adapter recorded `vieneu` as having no
sampler and no streaming API; it has both. The harness was corrected and every
arm re-measured with both engines seeded and both streaming, which reversed the
time-to-first-audio result and the reproducibility comparison. See
`plans/reports/benchmark-260915-1051-seeded-streaming-rerun.md`.

## Measurement design

Four synthesis arms, two sentence sets, two run tags:

| Engine                       | Female voice       | Male voice         | Streaming           |
| ---------------------------- | ------------------ | ------------------ | ------------------- |
| `vieneu-vi` (v3 Turbo, fp32) | `Mai Anh`          | `Thanh Bình`       | none                |
| `zerotts-vi`                 | chosen by audition | chosen by audition | `synthesize_stream` |

Both pairs match the gender defaults `services/local-tts` exposes through
`POST /synthesize`, so the numbers describe what a caller would actually hear.

TTFA is measured over **four** arms, because the app already clause-splits in
front of the engine: ZeroTTS streaming, ZeroTTS clause-split, **VieNeu
clause-split** (the number the verdict must beat), and VieNeu whole-sentence for
context only.

~90 sentences × 2 engines × 2 voices × 2 tags, plus transcription by two judges,
lands well under an hour of wall-clock.

## What this deliberately does not measure

**UTMOSv2.** `benchmarks/mos/README.md` records that UTMOS is English-trained and
not a valid Vietnamese naturalness predictor. Reproducing the vendor's 2.91 would
reproduce a meaningless number.

**Naturalness.** WER measures intelligibility; a robotic but clearly articulated
voice scores well. VieNeu was chosen precisely for how it _sounds_, so if ZeroTTS
wins WER while sounding worse, the verdict is held open pending the
`benchmarks/mos` panel. Every WAV is retained to make that listening possible.

**Voice cloning.** ZeroTTS's voice encoder is withheld upstream. This costs us
nothing — the app never clones, it asks for a gender or a preset token.

## Success Criteria

- [ ] `benchmarks/tts-vi` runs end to end from a clean `uv sync` on this machine, with `uv.lock` committed and torch-free
- [ ] Both engines measured over identical sentences, at least two run tags
- [ ] Both engines run at the **same thread count**, with ZeroTTS seeded, `warmup=False`, and sha-pinned weights
- [ ] Latency per word, RTF, speaking rate, peak RSS, load time, and sample rate reported per arm
- [ ] Result files cannot collide, and an incomplete run cannot report as complete (`--check-complete` in phases 3 and 4)
- [ ] TTFA reported for all four arms, with stream sustain (underrun margin) beside ZeroTTS's figure
- [ ] WER/CER scored by PhoWhisper-small, with Zipformer-vi as a rank-agreement column and both human-speech control floors quoted
- [ ] WER significance decided by a paired test over sentences, not by r1/r2 spread
- [ ] WAVs retained per arm and sentence
- [ ] `uv run pytest` passes
- [ ] A verdict is stated, with "too close to call" and "blocked on judge disagreement" both available outcomes
- [ ] `docs/development-journey.md` carries the comparison, in Vietnamese, noting the Windows→Ubuntu move
- [ ] VieNeu v3 Turbo's upstream licence is recorded
- [ ] `git diff` proves `services/local-tts`, `apps/api`, `benchmarks/tts` and `benchmarks/stt` are untouched

## Risks

| Risk                                                                                                                                                                                          | Mitigation                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ZeroTTS samples from the global `np.random` unseeded**, so every figure is one draw from a distribution                                                                                     | Phase 1 seeds immediately before each synthesis and records the seed. Note `synthesize_stream` is a generator — draws happen lazily at iteration, so _where_ you seed matters |
| **ZeroTTS defaults to 4 ORT threads; VieNeu gets 8** — a 2× handicap invisible in the output                                                                                                  | Phase 1 passes both thread counts explicitly and records them separately                                                                                                      |
| **`warmup=True` folds a dummy inference into ZeroTTS's `load_s`** and the harness warms it again                                                                                              | Phase 1 constructs with `warmup=False`; the harness's own untimed warm-up serves both engines                                                                                 |
| **`synthesize` and `synthesize_stream` use different ONNX decoders**, so the TTFA arm and the WER arm describe different audio                                                                | Phase 1's smoke test measures whether they differ; phase 3 writes the streamed arm's WAVs if they do; phase 5 states the provenance either way                                |
| Seeding alone does not give determinism — sampling happens inside the graph over FP32 logits, and top-k/top-p over an autoregressive loop turns a 1-ULP difference into a divergent utterance | Thread count and `onnxruntime` pinned exactly; results claimed only at the recorded seed, threads, and ORT version                                                            |
| `zerotts` 0.1.2 is weeks old; the API may not match its README                                                                                                                                | Phase 1 ends at an asserting smoke test before any measurement code exists. Its spec was written against the package source, not the README                                   |
| Vendored orchestration silently overwrites results and leaves orphan WAVs on a crashed arm                                                                                                    | Phase 3 fixes both before copying, and gates on completeness                                                                                                                  |
| VIVOS is redistributed inside ZeroBench-TTS, so ZeroTTS may have seen it                                                                                                                      | It is the comparability arm; the conversational arm carries the verdict, and the caveat is in the report                                                                      |
| Our PhoWhisper is **small**; the vendor used PhoWhisper-large + whisper-large-v3                                                                                                              | Absolute WER is higher for both engines and is relative-only. Human-speech control floors (7.71% / 5.38%) make it interpretable                                               |
| Every baseline in `docs/development-journey.md` was measured on **Windows 11**; this machine is Ubuntu                                                                                        | The OS is recorded in every result header and named first in phase 5's reconciliation                                                                                         |
| ZeroTTS wins latency but sounds worse                                                                                                                                                         | The verdict may legitimately be "hold, pending MOS panel". WAVs are retained for exactly this                                                                                 |

## Corrections found during execution

Four premises of this plan turned out to be wrong, and are recorded here rather
than quietly dropped:

- **Sample rates do not differ.** VieNeu also outputs **48 kHz**, so there is no
  resampling question and no PCM16-over-HTTP payload difference between the two.
  The plan's honesty note about differing rates does not apply.
- **Licence does not separate them.** VieNeu v3 Turbo is **Apache-2.0**, weights
  included, with the model card explicitly permitting commercial use of audio
  made with the preset voices. ZeroTTS being MIT is therefore not an advantage,
  and `README.md`'s "see upstream" row is out of date rather than a risk.
- **The two ZeroTTS decoders agree** within a 1.55e-06 peak delta at equal
  length. Intelligibility measured on the whole-sentence path transfers to the
  streamed one, so the contingent third scoring arm was not needed.
- **The 70 ms first-chunk claim needs a companion metric to be meaningful.**
  ZeroTTS reaches first audio in ~140 ms but the stream then falls ~0.8 s behind
  playback, so the time until audio can play _gapless_ is ~910 ms. The report
  compares that against VieNeu clause-split, not the first-chunk figure.

## Unresolved questions

- VieNeu v3 Turbo's upstream licence is unrecorded here. Resolved in phase 1; the
  swap decision depends on it.
- Which two ZeroTTS presets to use is an audition result, not a lookup. Phase 1
  includes a listening step before any measured run.
- Does ZeroTTS's `synthesize_stream` yield its first chunk before or after the
  full backbone forward pass? If after, the 70 ms claim is unreproducible by
  construction. Phase 1's smoke test settles it.
- A GGUF variant may exist upstream (merged PR #4 in `zeroweight-ai/ZeroTTS`).
  Out of scope unless the ONNX path disappoints.

<!-- slug: benchmark-zerotts-vs-vieneu -->
