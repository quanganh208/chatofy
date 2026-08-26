---
title: 'Speaker attribution: contract, three advisory rounds, benchmark gate plan'
date: 2026-08-24
summary: Planned a kill-gated benchmark for unknown-N speaker attribution on web; five load-bearing corrections found along the way
---

# Speaker attribution: contract, three advisory rounds, benchmark gate plan

## What happened

User asked whether the existing stack could tell who is speaking, for one-way and
two-way translation with several people on one input. Scouted, researched, ran three
advisory rounds, closed a brainstorm contract, wrote a 6-phase benchmark plan.

Feasibility answer: yes, no new dependency. `sherpa_onnx.__init__` in the running prod
container already exports `SpeakerEmbeddingExtractor`, `SpeakerEmbeddingManager`,
`OfflineSpeakerDiarization`, `SileroVadModelConfig`, `TenVadModelConfig`. Only weights
are missing.

Accuracy answer: worse than hoped, and the user's "detect chính xác" could not survive
as an absolute. Research found **no Vietnamese-trained speaker embedding model exists**
in the sherpa-onnx zoo, and **no int8 variant of any speaker model** (unlike ASR).
Short-turn EER climbs steeply below 3s; far-field single-mic adds 1.3-1.7x DER at best;
the penalties stack and no source covers the combined case. Converted the requirement
into a measured band the user accepted: live 80-90%, final transcript 90-95% for 3-5
same-language speakers.

## Corrections that changed the design

1. **`speakerRole` is not a fake to replace.** `turn-session.ts:115` derives it from
   translation direction, and it is _side of conversation_ — it drives voice/direction
   routing and is consumed by the persisted `transcriptSegmentSchema` and
   `ws-events.ts:178`. Identity is an orthogonal axis; several people share the vi side.
   The wire change must be an additive optional field, not a widened `speakerRoleSchema`.

2. **Piggybacking the embedding on `/transcribe` is serial, not concurrent.** Translation
   cannot start until it has the transcript text, and the text would arrive in the same
   HTTP response as the embedding — so the embedding cost lands _before_ translation.
   That is +30-100ms (CAM++) or +150-500ms (ERes2NetV2) on a 1163ms p50 budget. The
   "avoids a second decode" optimization buys a 30-500ms serialization to save ~5ms.
   Needs a separate `POST /embed` fired parallel with the Gemini call. Suspected ONNX
   Runtime thread-pool contention first; that was wrong — `engines/base.py:62` gives each
   engine its own recognizer, and the CPU is idle during the network-bound translate
   window. The serialization was in HTTP, not the CPU.

3. **The Phase 2 parity test targeted the wrong oracle.** Had the Python speech-gate port
   verified against `benchmarks/realtime/vad-reference.mjs`. That file's own header states
   it exists _precisely so it does not share a line of reasoning with `SpeechGate`_ —
   whole-file energy threshold vs adaptive floor, dB margin with hysteresis vs fixed
   linear, median-smoothed mask vs per-block streaming decisions never revised. A correct
   port would legitimately disagree with it. Replaced with a Node harness driving the real
   `SpeechGate`, which takes plain `(rms, ms)` and has no browser dependency
   (`speech-gate.spec.ts:18-25` already does this).

4. **The DSP-off control could only be captured in Phase 1.** Had placed it in Phase 3's
   risk response, where it is unobtainable — if Phase 3 lands badly the participants would
   have to be re-convened. Browser audio processing is per-track, so a second concurrent
   `getUserMedia` with all three flags false yields the unprocessed path from the same mic
   simultaneously. Moved into the recorder as a paired second WAV on one shared turn log.

5. **Production enables all three DSP stages, not just AGC.**
   `use-streaming-translate.ts:109-117` sets `echoCancellation`, `noiseSuppression` and
   `autoGainControl` all true. Noise suppression reshapes voice timbre — the exact quantity
   an embedding measures. This makes "record the fixture through the real capture path"
   far more load-bearing than an AGC-only concern would have been.

## Decision

Approach A (per-turn embedding + leader-follower online clustering with a dual-threshold
dead zone, per-language namespaces, and a deferred re-cluster backstop). B (in-turn
diarization) rejected as quota-fatal and a superset of A anyway; C (named enrollment)
deferred, its biometric exposure coming from persistence which A avoids by construction.

Benchmark first, behind two kill checkpoints, before any product code:

- Checkpoint 1: EER at the far-field 2s bucket, ≤10% or stop. Necessary, not sufficient.
- Checkpoint 2: live per-turn accuracy as accuracy-over-attributed with a ≥80% coverage
  floor; both protocols <70% kills, primary-only <70% is a declared third outcome
  (CALIBRATION-BLOCKED) that goes to the user as a design question.

Anti-circularity: calibrate thresholds on public corpora, evaluate on the held-out
self-recorded fixture; the gap against a temporal-split run is the measured threshold
non-stationarity.

## Next steps

Cook Phase 2 (uv scaffold, speech-gate port + `gate-reference.mjs` harness, fetch three
candidate models) — it is independent of the fixture, so it proceeds while the user
schedules the recording. Phase 1 needs the participant protocol already written into it:
real capture path, turn log, 2x12-15 min preferred, both distances.

## Open

arXiv 2606.08505 (on-device streaming diarization, relative-minimum-cluster-size for the
new-speaker decision) still needs a manual read — PDF extraction failed. VoxCeleb to
Vietnamese cold EER has no direct citation, only a fine-tuning proxy; Phase 3 measures it.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
