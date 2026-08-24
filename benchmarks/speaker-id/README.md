# speaker-id bench

Measures whether per-turn speaker attribution is deliverable on the web app, for
an **unknown number of speakers** on one far-field microphone. It exists to
answer that before any product code is written, behind a two-checkpoint kill gate.

Plan: `plans/260824-1900-speaker-attribution-benchmark-gate/`
Contract and design: `plans/reports/brainstorm-260824-1833-speaker-attribution.md`

Standalone `uv` project, like `benchmarks/stt`. Nothing here is imported by the
app, and nothing in `apps/`, `packages/` or `services/` changes because of it.

## Setup

```bash
cd benchmarks/speaker-id
uv sync
uv run python scripts/link_onnxruntime.py   # see "Why the symlink" below
uv run python scripts/download_models.py    # ~129MB of weights + smoke clips
uv run pytest
```

## What exists so far (Phases 1, 2 and 5)

| Piece                        | What it is                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `speaker_bench/segment.py`   | Port of the production speech gate. Cuts audio the way the app cuts it.                 |
| `scripts/gate-reference.mjs` | Drives the **real** TypeScript `SpeechGate` offline — the parity oracle.                |
| `speaker_bench/embed.py`     | Warm `SpeakerEmbeddingExtractor`, L2-normalised output, one lock per model.             |
| `speaker_bench/io.py`        | Audio loading, the production resample path, and the shared CSV writer.                 |
| `scripts/download_models.py` | The three candidate models, plus labelled smoke clips.                                  |
| `run_latency.py`             | Embedding cost per model x duration x thread count, idle and under real STT contention. |

Phases 3 and 4 (pairwise EER screen, simulated session) are not written yet — both need corpus
audio on disk. Phase 5 (latency) is done; it depends only on Phase 2, so it ran ahead.

## Two things a Phase 3–4 bench must do

**Call `require_terminated()`, not `.turns`.** `segment()` returns a `Segmentation`, and a turn the
gate opened but never closed is dropped — production never sent one. On a clip that stops promptly
after the last word that means ZERO turns, which reads exactly like "no speech here". Clips need
about `MIN_TRAILING_SILENCE_MS` (~700ms) of trailing silence, and `require_terminated()` is what
turns a violation into a loud failure instead of an empty CSV and a confident wrong verdict.

**Call `unit()` on centroids before `cosine()`.** A centroid is a mean of unit vectors and is not
itself unit — typically 0.6–0.9 in norm. Comparing a raw centroid scales every similarity down by
an amount that varies with cluster tightness, so Phase 3's pairwise thresholds would silently fail
to transfer to Phase 4's clustering and the run would report CALIBRATION-BLOCKED for an arithmetic
reason with nothing to do with speakers. `cosine()` raises rather than let that happen quietly.

## Why segmentation is a port, not a shortcut

Benches must cut audio the way production cuts it. Oracle or hand-placed cuts
overstate attribution accuracy and the numbers do not transfer: a cut that clips
a syllable degrades the embedding, and that degradation is part of what is being
measured.

So `segment.py` copies every constant from
`packages/realtime-client/src/audio/speech-gate.ts` (plus `PRE_ROLL_MS` from
`capture-pump.ts`), and `tests/test_segment_parity.py` checks the port against
the genuine article on all 35 realtime fixtures **at two ceiling configurations**
plus a synthetic clip — comparing both the event stream and the per-block speech
mask. Agreement is currently exact, not merely within the one-block tolerance.

Two configurations rather than one because with no ceiling `hasCeiling` is false
and three of the subtlest branches in `speech-gate.ts` never run: `armIfDue`, its
`probableEndFired` suppression, and the armed-cut-before-hangover ordering. The
speech mask is compared directly because it drives net-speech and therefore
duration buckets, and a noise-floor drift can flip borderline blocks without
moving any event.

`segment()` — what audio a turn actually CONTAINS — is a separate layer with its
own tests in `test_segment_turns.py`, on synthesised signals so they run with no
fixtures and no toolchain. That layer follows `capture-pump.ts` rather than the
gate: held silence is dropped at close, pre-roll cannot reach back past the
previous turn, and an unterminated turn is dropped but counted.

**The oracle is `scripts/gate-reference.mjs`, never
`benchmarks/realtime/vad-reference.mjs`.** That file is not a second copy of the
gate — its own header says it exists precisely so that it does _not_ share a line
of reasoning with `SpeechGate` (whole-file energy threshold vs adaptive floor, dB
margin with hysteresis vs fixed linear, median-smoothed mask vs per-block
streaming decisions never revised). It is the independent denominator for
capture coverage. A **correct** port would legitimately disagree with it, so
using it as the oracle would either fail spuriously or need a tolerance wide
enough to prove nothing.

`gate-reference.mjs` transpiles `speech-gate.ts` **and `pcm-resampler.ts`** with
the workspace's own esbuild into `.cache/`, then imports both. The gate is not
exported from `@chatofy/realtime-client`'s index, and it uses a TypeScript
parameter property, which is not erasable syntax — so Node's type stripping
cannot load it directly.

The resampler is imported rather than copied for a specific reason: if this
script hand-copied `downsampleToPcm16`/`pcm16Rms` and the Python side hand-copied
them too, the two could agree exactly while both mis-modelling production —
parity would stay green and prove nothing about the framing, and would stay green
forever if `pcm-resampler.ts` later changed. The only things still modelled by
hand in the oracle are WAV reading and the 1024-sample blocking.

### Making parity failures loud

Skips exist so a casual run on a machine without the workspace toolchain is not a
wall of red — but "46 passed, 35 skipped" reads a lot like "46 passed". Anything
producing official Phase 3-5 numbers must run with:

```bash
SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest
```

which turns every parity skip into a failure. A measurement whose segmentation
was never verified against the real gate has no provenance.

### Block framing

Audio is blocked at the **source** rate, not at 16 kHz. The capture worklet posts
1024 samples at the AudioContext's own rate (typically 48 kHz) and each block is
then downsampled, so one production block is `floor(1024 / 3) == 341` samples —
about **21.3ms**, not the round 20ms the worklet comment approximates. Blocking
at 16 kHz instead would put every boundary somewhere production never puts one.
Fixture audio is 48 kHz for the same reason.

## An early finding worth knowing

`tests/test_embed_smoke.py` runs the three candidates over the labelled Mandarin
clips shipped with the sherpa-onnx release. The two 3D-Speaker models separate
the speakers cleanly. The **English VoxCeleb baseline does not**: same-speaker
similarity drops to ~0.47 while different-speaker reaches ~0.84 — through the
same code path the others pass through, so it is the model and not the plumbing.

Two advisory opinions disagreed about whether VoxCeleb-trained models transfer to
Vietnamese. This is one data point, and only that: these clips are Mandarin,
close-talking and read, none of which is this product's channel. Phase 3 answers
the question properly, for Vietnamese, far-field, through the browser's DSP.

Measured dimensions: eres2netv2 **192**, campplus **192**, wespeaker_en **512**.

## What the latency bench found

`run_latency.py`, run inside `chatofy_prod-local-stt` with production's thread environment
(`REPS=50`, warm-up discarded, p95 by nearest rank). Gate cells are extractor `num_threads=2`,
turns <=3s, against the 723ms Gemini translation window.

| Model        | idle    | 1 STT decode | 2 STT decodes (ceiling)    |
| ------------ | ------- | ------------ | -------------------------- |
| campplus     | 24.9ms  | 35.3ms       | 132.2ms                    |
| eres2netv2   | 160.1ms | 268.2ms      | **517.0ms (28% headroom)** |
| wespeaker_en | 25.6ms  | 40.7ms       | 136.6ms                    |

**Two concurrent decodes is the ceiling, not a sample point.** `services/local-stt/engines/registry.py`
registers exactly two engines (`vi`, `en`) and each holds its own lock across a decode, so no number
of concurrent sessions produces a third. Measuring there is measuring the worst case that can exist.

At that worst case **eres2netv2 is the only candidate that stops fitting** — 28% headroom at
production's `LOCAL_STT_THREADS=4`, and 895ms (over the window) at dev's 8. campplus and
wespeaker_en keep over 80% headroom. So the "embedding hides inside the translation window"
assumption is verified for the cheap models under full architectural load, and refuted for the
expensive one.

**Do not tune `num_threads` against a contended measurement.** At one decode `2` wins every
contended cell. At two decodes the winner scrambles per cell, because with 8 of 16 logical cores
held by STT the between-thread spread falls below run-to-run noise. The gate pins `num_threads=2`
rather than reading a winner off that noise; `1-2` is the honest recommendation.

Reproduce (the host run is a smoke check only — the container run is the authoritative one,
they diverged 57% on one contended cell):

```bash
docker run --rm -e LOCAL_STT_THREADS=4 -e OMP_NUM_THREADS=4 -e MKL_NUM_THREADS=4 \
  -v "$PWD:/bench" -v "$PWD/../../services/local-stt/models:/stt-models:ro" \
  chatofy_prod-local-stt /app/.venv/bin/python /bench/run_latency.py \
  --models-dir /bench/models --stt-models-dir /stt-models \
  --stt-instances 2 --out /bench/results/latency-container-2decode.csv
```

**A run that measures less than the gate needs exits 3, not 0.** An idle-only artifact is not a
pass, and used to look like one.

## The corpora, and why the screen no longer needs participants

Checkpoint 1 used to run on a self-recorded 3-5 person session, which blocked three phases on
scheduling. It now runs on public Vietnamese speaker-verification corpora with official trial lists
— a far stronger screen (120 test speakers, ~55k matched pairs) that needs nobody. The recording
survives as Phase 7, measuring the one thing no corpus has: production's browser DSP channel.
**If the gate kills the feature, nobody is ever recorded.**

|                  | VoxVietnam (primary)                      | Vietnam-Celeb (secondary)      |
| ---------------- | ----------------------------------------- | ------------------------------ |
| Speakers / hours | 1,406 / 261h                              | 1,000 / 187h                   |
| `<2s` / `2-5s`   | 23.6% / 51.0%                             | 5.8% / 43.8%                   |
| Licence          | `cc-by-nc-4.0`                            | **unstated**                   |
| Access           | HF, `gated: auto`, test split = 38 shards | manual 4-part Google Drive zip |

**`fetch_corpora.py` never accepts a licence for you.** VoxVietnam is gated; the script reads a
token from the environment and fails with instructions when there is none. Accepting a dataset's
conditions is the user's act, and a script that worked around the gate would make that decision
silently. `cc-by-nc-4.0` covers evaluating off-the-shelf models, which is all this gate does; it
does not cover training or shipping.

Vietnam-Celeb cannot be fetched at all — its GitHub repo holds only a README pointing at Drive, and
the trial lists live _inside_ that archive. So the script verifies an extraction rather than
pretending to download one, and its absence is reported without failing: VoxVietnam alone runs the
screen. What Vietnam-Celeb adds is negatives matched on gender AND dialect, and a published EER on
those exact lists to sit our numbers beside.

### A published number worth knowing before Checkpoint 1 runs

On Vietnam-Celeb's lists, at **full utterance length and a clean channel**, an ECAPA-TDNN scores:

| Trained on         | E     | H     |
| ------------------ | ----- | ----- |
| VoxCeleb (English) | 13.19 | 16.52 |
| Vietnamese         | 6.31  | 8.62  |

Checkpoint 1's bar is **EER ≤ 10%** at the 2s far-field bucket. So a VoxCeleb-trained model — the
class `wespeaker_en` belongs to — is already above the bar under conditions easier than ours. Two
consequences: the English baseline is likely dead before we truncate anything, and a candidate
scoring far _better_ than 6.31 at 2s should be treated as a bug rather than a triumph.

### The EER is tested against an analytic value

For two unit-variance Gaussians separated by `d`, EER is exactly `Phi(-d/2)`. The sweep never sees
that identity, so agreeing with it is evidence rather than a restatement. This matters because a
subtly wrong threshold sweep still returns a believable percentage and a gate would read a decision
off it — which nearly happened: the first implementation stepped per sample, treating tied scores as
orderable, and reported 100% EER on fully-tied input instead of 50%.

## Why the symlink

`import sherpa_onnx` fails on a fresh venv with
`ImportError: libonnxruntime.so: cannot open shared object file`. The sherpa-onnx
Linux wheel omits `libonnxruntime.so` from `sherpa_onnx.libs/` while
`_sherpa_onnx.so`'s RPATH points there, and the `onnxruntime` wheel ships only
the versioned `libonnxruntime.so.1.27.0`. `scripts/link_onnxruntime.py` creates
the missing link; it is idempotent and needed again after any `uv sync` that
recreates the venv. `services/local-stt` and `services/local-tts` have the same
gap.

The `sherpa-onnx==1.13.4` / `onnxruntime==1.27.0` pins are exact and match the
STT sidecar's, deliberately: this bench exists to predict how that sidecar will
behave, so a different ABI pair here would measure a different thing than the one
that ships.

## Bench output rules

These apply to every bench added in Phases 3–5, and exist so that a bad result is
visible rather than absorbed:

- per-turn CSV artifacts, never only an aggregate;
- results reported **per duration bucket**, so a catastrophic 1s bucket is not
  averaged away by healthy 3s turns;
- speaker-count trajectory alongside accuracy — a run that scores well while
  minting nine speakers for four people has not passed anything;
- gate scripts **exit non-zero** on failure; a prose "hmm, 12%" gets rationalized,
  an exit code does not;
- cosine histograms emitted as images, because a single EER can hide a bimodal
  distribution.
