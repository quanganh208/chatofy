# Noise suppression — cleaner audio for STT and a noise-robust turn detector

**Status:** designed — awaiting approval to implement.
**Date:** 2026-09-02.
**Depends on:** the client capture graph (`packages/realtime-client/src/audio/`:
`MicrophoneGraph`, `SpeechGate`, `pcm-resampler`) and the web live/streaming
paths (`apps/web/src/hooks/use-live-translate.ts`, `use-streaming-translate.ts`).
**Brainstorm:** `./brainstorm.md`.

## Problem

Two noise failure modes, fixed in different places (see brainstorm for detail):

1. Background noise reaches the STT engine and corrupts the transcript.
2. `speech-gate.ts` endpoints on RMS against an adaptive noise floor, so a noisy
   room raises false starts and cuts sentences early.

v1 addresses **both**, on **web only**, measurement-first.

## Approach

- **Denoise on the client** with an RNNoise WASM AudioWorklet node, inserted in
  the capture graph as a sample-preserving **transform** — never a gate. It
  cleans the signal both the STT engine and the RMS floor read.
- **Add a learned VAD** (Silero via `@ricky0123/vad-web`) behind a `Detector`
  interface in `SpeechGate`, keeping the gate's endpoint policy unchanged and RMS
  as the dependency-free default.
- **Measure first.** Phase 1 builds the noisy-WER and false-trigger harness and
  records a baseline before any behaviour changes, so every later phase is a
  numbered delta.

## Key design decisions

1. **Denoise is a transform node, not a gate.** `MicrophoneGraph`'s bold "no gate
   here / do not add filtering here" warning is about _withholding_ blocks, which
   truncates the live path. RNNoise emits the same sample count it consumed, so it
   inserts as `source → denoise → captureWorklet` and `MicrophoneGraph` keeps
   emitting every block, trailing quiet included. The insertion lives beside the
   graph, and the class's "emits every block" contract is asserted unchanged.
2. **Client RNNoise, not server-side.** Local-first, real-time-safe (~10ms/frame),
   no hot-path server cost. Server-side denoise and DeepFilterNet are future work.
3. **Browser `noiseSuppression` is decided by measurement, not assumption.**
   RNNoise on top of WebRTC APM is double denoising; Phase 1 measures APM-only vs
   RNNoise-only (APM off) vs both, and the winner sets `CONVERSATION_AUDIO`.
4. **`SpeechGate` keeps its policy; only its detector input becomes pluggable.**
   Extract a `Detector` interface (`push(block/level) → isSpeech`) with the
   current RMS logic as the default implementation and Silero as an opt-in one.
   Hangover / probable-end / forced-cut constants and behaviour are untouched.
5. **Everything is toggleable and off by default in lab paths.** The baseline
   lab route must stay raw; denoise and Silero are opt-in flags so the recorded
   prompt/STT baselines keep describing the default path.

## Where it slots

| Layer                                  | Change                                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/realtime-client` audio       | RNNoise denoise `AudioWorkletProcessor` + its insertion in `MicrophoneGraph` (transform, contract-preserving); WASM asset loading                               |
| `packages/realtime-client` speech-gate | extract `Detector` interface; RMS default impl; Silero (`@ricky0123/vad-web`) opt-in impl feeding `SpeechGate` unchanged policy                                 |
| `apps/web`                             | serve WASM/model assets; denoise + VAD-backend flags; settings toggle + wiring in the live/streaming hooks; `open-microphone` APM constraint per Phase-1 result |
| `packages/config` / `packages/types`   | flags + constants (denoise on/off, VAD backend), asset paths                                                                                                    |
| `packages/i18n`                        | vi/en strings for the settings toggle                                                                                                                           |
| `benchmarks/noise` (new)               | noisy-WER harness (clean corpus × noise at SNRs) and VAD false-trigger / endpoint-accuracy harness; recorded baseline                                           |
| `docs`                                 | `system-architecture.md` audio-pipeline section update                                                                                                          |

## Phases

1. **Measurement harness + baseline.** New `benchmarks/noise`: mix a clean speech
   corpus with noise (e.g. DEMAND/MUSAN) at a few SNRs; measure WER through the
   real STT service and the RMS gate's false-trigger + endpoint accuracy. Record
   the baseline numbers. **No behaviour change** — this is the ruler everything
   below is measured against, and it also answers decision 3 (APM stacking).
2. **Client denoise (RNNoise).** Denoise worklet + graph insertion respecting the
   no-gate contract; asset loading; off-by-default flag. Unit tests: sample-count
   preserved, every block still emitted, bypass when disabled. Re-run Phase-1
   harness; denoise must beat baseline WER at low SNR without hurting high SNR.
3. **Learned VAD (Silero).** `Detector` interface + RMS default + Silero impl;
   `SpeechGate` policy unchanged; RMS fallback when the model is absent. Unit
   tests for the interface and both impls. Re-run the VAD harness; Silero must cut
   the false-trigger rate at low SNR without regressing endpoint latency.
4. **Web wiring + settings + i18n + docs.** Settings toggle (denoise / VAD
   backend), wire through the live + streaming hooks, i18n strings, architecture
   doc update.

## Out of scope (v1)

- Server-side denoise and DeepFilterNet (future, when a heavier model is wanted).
- Extension and mobile surfaces — both inherit the `realtime-client` node once
  web proves it.
- Per-speaker noise profiles / adaptive suppression; dereverberation.
- Echo (already handled by APM `echoCancellation`).

## Open questions (empirical — resolved in Phase 1, not blocking approval)

- **RNNoise × browser `noiseSuppression`:** stack, or turn APM suppression off
  when RNNoise is on? Phase 1's three-arm measurement decides.
- **RNNoise library choice:** `@jitsi/rnnoise-wasm` vs `rnnoise-wasm` vs a hand-
  built worklet — pick on asset size + worklet ergonomics in Phase 2.
- **Silero asset budget:** onnxruntime-web + model size vs the web bundle's
  tolerance; confirm the served asset size before committing in Phase 3.

## Resolved decisions (2026-09-02, with user)

- **Scope → both problems:** denoise + learned VAD.
- **Denoise placement → client RNNoise WASM** (optimal for local-first + real-time;
  server-side / DeepFilterNet deferred).
- **Surfaces → web only for v1.**
