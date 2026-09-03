# Noise harness

Phase 1 of the noise-suppression work: the **ruler** every later phase is
measured against. See `plans/260902-1050-noise-suppression/plan.md` for the whole
feature; this directory holds the baseline, and nothing here changes app
behaviour.

"Lọc tiếng ồn" is two problems, measured in two places:

| Arm                | Problem                                                                                         | Where it runs                                                                      | Needs                                               |
| ------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Endpoint / VAD** | Noise corrupts turn detection — a noisy room raises false starts and stops the turn ever ending | `packages/realtime-client/src/audio/speech-gate-noise.measure.spec.ts`             | nothing                                             |
| **Noisy-WER**      | Noise corrupts the transcript — the recognizer returns plausible-but-wrong words                | `benchmarks/noise/` (this dir, uv project — see [status](#noisy-wer-arm-to-build)) | a clean corpus, a noise corpus, and the STT sidecar |

## Why the endpoint arm is a measure-spec, not a script here

The plan sketched both arms living in `benchmarks/noise`. The endpoint arm moved
into `realtime-client` as a `*.measure.spec.ts` for one reason: it must drive the
**real `SpeechGate`**, and a copy would drift — which this codebase treats as its
most expensive class of defect. Benchmarks are not workspace packages (`apps/*`
and `packages/*` only), so a script here could only import a built snapshot of the
gate. A measure-spec beside the gate imports the source, runs under the existing
vitest with no new tooling, and stays honest as the gate changes. The noisy-WER
arm has no such pull — it talks to the STT service over HTTP — so it stays here as
a standalone uv project, mirroring `benchmarks/stt`.

## Endpoint / VAD arm — runnable now

Drives the real gate down the real capture path (48 kHz gaussian noise → the
production block size → the real `downsampleToPcm16` → the real `pcm16Rms`), so
the per-block level fluctuates the way a microphone's does. Deterministic: a
seeded PRNG makes the baseline reproducible rather than a number that shifts every
run.

```bash
MEASURE_NOISE=1 pnpm --filter @chatofy/realtime-client exec vitest run \
  src/audio/speech-gate-noise.measure.spec.ts
```

Off by default (`MEASURE_NOISE` unset) so it does not spend CI time or spam the
suite with a table. It asserts no threshold — a pass/fail line on a false-start
rate would only describe the noise seed it last ran on — except the one sanity arm
that fails if the harness has stopped driving the gate the way a clean room does.

### Baseline (2026-09-03, gaussian white noise, speech RMS 0.18)

```
False starts over 60s of pure noise (every start is wrong by construction):
  noise-rms   SNR    false-starts/min
     0.002    39dB          0.0
     0.020    19dB          0.0
     0.028    16dB          1.0

Endpoint after 1500ms speech + a 2500ms noise bed:
  noise-rms   SNR    end-latency   reason
     0.002    39dB       505ms     hangover
     0.020    19dB       505ms     hangover
     0.028    16dB        lost     —          ← turn never closes
```

**Read it as a floor, not an estimate.** Gaussian noise is white and stationary,
so the gate's adaptive floor tracks it and absorbs most false starts; a café, a
fan, or a passing truck has transients a white bed does not, and would score
worse. What the baseline already shows is the headline failure the feature exists
to fix: at a realistic noisy-room SNR the **endpoint is lost entirely** — the bed
keeps counting as speech and the turn runs on forever. A recording of a real
noisy room tightens the false-start numbers; the noisy-WER arm is where that
corpus lands, and the same recordings can drive this arm through the WAV path once
they exist.

## Noisy-WER arm — to build

Not yet built. The design, mirroring `benchmarks/stt`:

- A uv project here (`pyproject.toml`, `noise_bench/`), reusing `stt_bench`'s
  engine wrappers and WER metric rather than copying them.
- Mix a clean speech corpus with a noise corpus (DEMAND or MUSAN) at a few SNRs
  (e.g. 20, 10, 5, 0 dB), transcribe each arm through the **real** STT sidecar,
  and report WER per SNR against the clean-audio WER as the ceiling.
- Record the baseline table before Phase 2 touches anything, so denoise is a
  numbered delta: it must beat baseline WER at low SNR without hurting high SNR.

This arm answers the other open Phase-1 question — **APM stacking** (plan decision
3): measure APM-only vs RNNoise-only vs both, and let the winner set
`CONVERSATION_AUDIO` in `apps/web/src/lib/open-microphone.ts`.

Nothing in this directory commits audio or weights — corpora are downloaded and
mixes are regenerated, as in the sibling harnesses.
