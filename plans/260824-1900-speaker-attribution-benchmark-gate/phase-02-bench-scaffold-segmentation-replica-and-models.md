---
title: 'Phase 2: Bench scaffold, segmentation replica, models'
status: completed
phase: 2
priority: P1
effort: '1d'
dependencies: []
---

# Phase 2: Bench scaffold, segmentation replica, models

## Overview

Stand up `benchmarks/speaker-id/` as a standalone `uv` project, port the production speech gate so
benches cut audio the way production does, and fetch the candidate embedding models.

Independent of Phase 1 — can run in parallel while the fixture is being recorded.

## Requirements

**Functional**

- [x] Standalone `uv` project; does not touch `services/local-stt`'s environment
- [x] Embedding extraction over `sherpa_onnx.SpeakerEmbeddingExtractor`
- [x] Segmentation is a faithful replica of `speech-gate.ts`, verified against it
- [x] All candidate models fetched, idempotently

**Non-functional**

- [x] `sherpa-onnx==1.13.4` + `onnxruntime==1.27.0` pinned identically to the sidecar — the ABI pair
      is coupled and must not drift
- [x] Model weights gitignored

## Architecture

**Standalone, like `benchmarks/stt`.** The sidecar's environment is production; a bench that shares
it can break it. Same pins, separate `.venv`.

**Segmentation must replicate, not improve.** Benches cut with a port of
`packages/realtime-client/src/audio/speech-gate.ts`, never oracle or manual cuts. Oracle cuts
overstate accuracy and the numbers do not transfer — the VAD's placement error is part of what is
being measured, because a cut that clips a syllable directly degrades the embedding. Port the
constants exactly: `SPEECH_HANGOVER_MS=500`, `MIN_SPEECH_MS=120`, `SPEECH_MARGIN=0.018`,
`MIN_NOISE_FLOOR=0.004`, `FLOOR_RISE=0.002`, `FLOOR_FALL=0.05`, `PRE_ROLL_MS=320`
(the pre-roll lives in `capture-pump.ts`).

**Verify the port against the real gate — not against `vad-reference.mjs`.** That file is an
offline VAD reference, and its header states plainly that it exists _precisely so that it does not
share a line of reasoning with `SpeechGate`_: whole-file energy threshold vs adaptive floor, dB
margin with hysteresis vs a fixed linear margin, median-smoothed mask vs per-block streaming
decisions that are never revised. It is the independent denominator for capture coverage. A correct
port of `SpeechGate` will legitimately disagree with it on boundary placement, so using it as the
oracle would either fail spuriously or need a tolerance so wide it proves nothing.

The oracle must be `SpeechGate` itself. It has no browser dependency — `speech-gate.spec.ts:18-25`
drives it with a plain harness, and it consumes `(rms, ms)` rather than samples. So write a small
Node harness that reads a WAV, computes per-block RMS the way `microphone-graph.ts` does, feeds the
real TS `SpeechGate` plus the capture-pump pre-roll logic, and prints turn boundaries as JSON. Both
sides then run the same deterministic algorithm with the same constants, so the tolerance can be
tight (~1 block) instead of meaninglessly loose.

Run the parity check over the existing `benchmarks/realtime/fixtures/` — this keeps Phase 2 fully
independent of Phase 1, so the two really can proceed in parallel.

**Mirror the forced-cut path too**, not only the hangover path: `CUT_LOOKAHEAD_MS=500` and the
`maxUtteranceMs` ceiling that `capture-pump.ts` configures. Long fixture turns will reach it, and a
port that only models the silence path will diverge exactly where turns are longest.

**Net speech, not wall time.** The short-turn ladder keys off _net speech_ milliseconds. The gate
already distinguishes speech blocks from silence — the segmenter must emit net-speech duration per
turn alongside wall duration, or Phase 3's duration buckets measure the wrong quantity.

## Related Code Files

- Create: `benchmarks/speaker-id/pyproject.toml` — pins matching `services/local-stt/pyproject.toml`
- Create: `benchmarks/speaker-id/speaker_bench/embed.py` — extractor wrapper, one warm model, L2-normalized output
- Create: `benchmarks/speaker-id/speaker_bench/segment.py` — speech-gate port, emits `{startMs, endMs, netSpeechMs}`
- Create: `benchmarks/speaker-id/speaker_bench/io.py` — WAV load/resample to 16k mono, CSV writers
- Create: `benchmarks/speaker-id/scripts/download_models.py` — candidate models, idempotent
- Create: `benchmarks/speaker-id/scripts/gate-reference.mjs` — Node harness driving the REAL `SpeechGate` over a WAV, emitting turn boundaries as JSON
- Create: `benchmarks/speaker-id/tests/test_segment_parity.py` — Python port vs `gate-reference.mjs` (NOT vs `vad-reference.mjs`)
- Read (do not modify): `packages/realtime-client/src/audio/speech-gate.ts`, `packages/realtime-client/src/audio/capture-pump.ts`, `packages/realtime-client/src/audio/speech-gate.spec.ts` (harness pattern), `packages/realtime-client/src/audio/microphone-graph.ts` (per-block RMS), `services/local-stt/pyproject.toml`, `services/local-stt/audio/decode.py`

## Models to fetch

From the sherpa-onnx `speaker-recongition-models` release. **No int8 exists for any of them** —
fp32 on CPU is expected; do not self-quantize.

| Model                                                    | Size   | Role                                                                                         |
| -------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common`        | 71.4MB | Primary candidate — best published short-duration, 200k-speaker tonal corpus                 |
| `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced` | 28.3MB | Bilingual challenger, 2–4× cheaper                                                           |
| `wespeaker_en_voxceleb_CAM++` (or ResNet34-LM)           | —      | Baseline; advisors disagreed on its VN viability, so it is measured rather than argued about |

## Implementation Steps

1. `uv init` the project; copy the exact `sherpa-onnx`/`onnxruntime` pins and the ABI comment
   explaining why they are coupled.
2. Write `download_models.py` for the three candidates; gitignore `models/`.
3. Write `embed.py`: load one extractor, expose `embed(samples) -> np.ndarray`, L2-normalize on the
   way out so every downstream consumer compares unit vectors.
4. Port `speech-gate.ts` to `segment.py`, constants byte-for-byte, emitting net-speech ms per turn,
   modelling both the hangover path and the forced-cut path.
5. Write `gate-reference.mjs` — drive the real `SpeechGate` over a WAV and emit boundaries as JSON.
6. Write `test_segment_parity.py`: run the Python port and `gate-reference.mjs` over the same
   `benchmarks/realtime/fixtures/` clips; assert boundary agreement within ~1 block. Fix the
   tolerance before writing the test, never tune it until it passes.
7. Write `io.py` helpers: 16k mono load, and a CSV writer used by every bench so artifact shape is
   consistent.
8. Smoke test: embed two clips of one speaker and one of another; confirm same-speaker cosine
   exceeds diff-speaker. If it does not, stop — something is wrong in the wiring, not the science.

## Success Criteria

- [x] `uv sync` succeeds; `import sherpa_onnx` works (needed the libonnxruntime symlink;
      `scripts/link_onnxruntime.py` now applies it idempotently)
- [x] All three models fetched; re-running the script is a no-op
- [x] Segmentation parity passes against `gate-reference.mjs` (the real `SpeechGate`) —
      **exact**, zero block drift, across 35 fixtures x 2 ceiling configs plus a synthetic clip
- [x] Forced-cut path modelled AND parity-checked at `max_utterance_ms=1500`
- [x] Per-block speech mask compared against the oracle, not only its length
- [x] Segmenter emits net-speech ms distinct from wall ms
- [x] Smoke test orders same-speaker above diff-speaker cosine (shipping candidates)
- [x] `git diff --stat` shows nothing outside `benchmarks/speaker-id/`
- [x] `segment()` covered by its own tests (94 tests total)

## What review changed

Code review found three defects in `segment()` — the layer the benches call, which the parity
suite structurally could not see because nothing called it. All are fixed and now tested.

1. **Turns overlapped across a close.** Pre-roll was clamped only at zero, so a turn starting
   within `PRE_ROLL_MS` of the previous one closing prepended up to 320ms of the PREVIOUS
   speaker's audio. Reproduced on `long-01.wav` at a 1500ms ceiling: ~149ms of real speech
   duplicated across a boundary. Production cannot do this — `capture-pump.ts:320` clears
   `preRoll` in `closeTurn`. Now clamped to the previous turn's closing block, inclusive
   (`gate.push` runs before the state check, so the closing block lands in the next pre-roll).
2. **Turn audio carried the whole hangover tail.** Production holds silent blocks, flushes them at
   `onProbableEnd`, and `closeTurn` DROPS whatever is still held — so ~350ms never reaches the
   server. The bench was handing that silence to the embedder, a systematic distortion worst in
   the sub-1s bucket, which is where Checkpoint 1 is decided. Turns now end at the last
   `probableEnd`.
3. **32 of 35 fixtures segmented to nothing, silently.** Dropping an unterminated turn is correct;
   doing it invisibly is not — an empty list reads exactly like "no speech here". `segment()` now
   returns a `Segmentation` carrying `dropped_open_turns`, with `require_terminated()` for benches
   to call. The ~700ms trailing-silence requirement is recorded as
   `MIN_TRAILING_SILENCE_MS` and is a constraint on Phase 1 recording and Phase 3 clip prep.

Also: `cosine()` now rejects non-unit vectors, because **a centroid is not a unit vector** — Phase 4
must call `unit()` on centroids or its thresholds silently fail to transfer from Phase 3, which
would surface as a spurious CALIBRATION-BLOCKED. `write_rows` refuses to write a headerless blank
file. Fixture audio is gitignored by directory rather than by `*.wav`, since `getUserMedia` records
webm/opus.

## Risk Assessment

- **sherpa-onnx import failure.** Known issue in this repo — the wheel links libonnxruntime by
  versioned symbol. Signal: ImportError on `sherpa_onnx`. Response: apply the same symlink
  workaround the sidecar uses; do not "fix" it by bumping the pins.
- **Segmentation port drifts silently.** Signal: parity fails, or passes with a tolerance so wide it
  proves nothing. Response: fix the tolerance before writing the test. And keep the oracle correct —
  comparing against `vad-reference.mjs` would be comparing against a deliberately different
  algorithm, which produces disagreement that means nothing either way.
- **Model download sizes.** ~110MB across three. Signal: slow first run. Response: cache, gitignore,
  and note it in the bench README.
- **Baseline model choice contested.** Advisors disagreed on VoxCeleb-trained models for Vietnamese.
  Response: this is why it is in the bench — no argument decides it, Phase 3 does.
