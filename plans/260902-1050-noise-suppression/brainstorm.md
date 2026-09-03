# Noise handling — brainstorm

**Date:** 2026-09-02.
**Status:** options explored; approach chosen (see `plan.md`).

## Two problems wearing one word

"Lọc tiếng ồn" splits into two independent failure modes in this codebase, and
they are fixed in different places:

1. **Noise corrupts the transcript.** Background noise reaches the STT engine and
   the recognizer returns plausible-but-wrong words. Fixed by **denoising the
   audio** before it is transcribed.
2. **Noise corrupts endpoint detection.** `speech-gate.ts` decides a turn is over
   from RMS against an adaptive noise floor; a noisy room raises false starts and
   cuts sentences early. Fixed by a **learned voice-activity detector**.

Both were chosen for v1.

## What already exists (do not rebuild)

- **Browser-native cleanup is already on.** `apps/web/src/lib/open-microphone.ts`
  sends `echoCancellation + noiseSuppression + autoGainControl` on every
  conversation path (WebRTC APM). The lab-baseline route deliberately records raw
  so its comparison stays honest. So a v1 that only "turns on noise suppression"
  would be a no-op — that lever is already pulled.
- **`speech-gate.ts` already anticipated a learned detector.** Its own docstring
  names Silero via `@ricky0123/vad-web` as the more robust option and says the
  RMS detector "stays dependency-free behind an interface that a learned detector
  can be dropped into." The seam is designed; it just has no second implementation.
- **`MicrophoneGraph` forbids a gate, not a transform.** Its docstring says in
  bold: _"There is no gate here… Do not add filtering here."_ That warning is
  about **withholding blocks** — a gate that drops quiet audio truncates the live
  translation (measured: cutting at the last speech sample returned "However, the
  graft" and nothing more). A denoiser that outputs the **same number of samples,
  just cleaned**, is a transform, not a gate — it withholds nothing. The plan
  inserts denoise as its own node in the graph and keeps `MicrophoneGraph`'s
  "emits every block" contract intact.
- **Measurement-first culture.** `benchmarks/stt`, `benchmarks/mos` etc. exist and
  are run deliberately. Any noise change ships with a benchmark or it cannot be
  argued.

## Denoise — where to put it

| Option                                 | Pros                                                                                                                                                                   | Cons                                                                               | Verdict                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| **Client RNNoise (WASM AudioWorklet)** | Local-first (no cloud); no server load; ~10ms/frame, real-time safe; RNNoise is speech-tuned and small (~85KB); cleans audio for BOTH the transcript and the RMS floor | Runs per client; needs a WASM asset served; may double-process against browser APM | **Chosen for v1**                            |
| Server-side (Python, before engine)    | One place; also cleans uploaded files; easier to swap models                                                                                                           | Adds server CPU + latency on the hot `/transcribe` path; every turn pays it        | Future — good when a heavier model is wanted |
| Tune browser APM only                  | Free, no dependency                                                                                                                                                    | Already on; low ceiling; not controllable                                          | Rejected (no-op)                             |
| DeepFilterNet                          | Much better SNR gain than RNNoise                                                                                                                                      | Heavier; risky for arbitrary client CPU in real time                               | Future / server-side option                  |

**Chosen: client RNNoise.** It is the local-first, real-time-safe option, and it
cleans the signal that both the STT engine and the RMS noise floor read, so it
helps problem (1) directly and problem (2) as a bonus even before Silero lands.

### The one thing to measure early: RNNoise × browser noiseSuppression

Running RNNoise on top of WebRTC's `noiseSuppression` is double denoising and can
add artifacts that _hurt_ WER. Phase 1's harness measures three arms — APM only,
RNNoise only (APM off), APM+RNNoise — and the winner sets the constraint. Do not
assume stacking helps.

## VAD — learned detector

- **Silero via `@ricky0123/vad-web`** (onnxruntime-web + WASM model asset). Feed
  its speech probability into `SpeechGate` in place of `rms > floor`, keeping the
  gate's endpoint policy (hangover / probable-end / forced-cut) unchanged — the
  latency win is from ending turns automatically at all, not from which detector
  decides, so only the decision input changes.
- **Keep RMS as the dependency-free default** behind a `Detector` interface;
  Silero is opt-in. This matches the existing docstring's intent and means a
  build that cannot serve the model still works.

## Out-of-scope ideas parked here

- Server-side denoise and DeepFilterNet (future, when a heavier model is wanted).
- Per-speaker noise profiles / adaptive suppression.
- Extension and mobile surfaces (v1 is web-only; both inherit the
  `realtime-client` node once proven).
- Dereverberation and echo (echo is already handled by APM `echoCancellation`).
