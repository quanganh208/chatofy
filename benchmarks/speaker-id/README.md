# speaker-id bench

Measures whether per-turn speaker attribution is deliverable on the web app, for
an **unknown number of speakers** on one far-field microphone.

It was built to answer that before any product code existed, behind a
two-checkpoint kill gate. **Both of those are now history**: the gate passed far
enough for the acoustic layer to ship behind `SPEAKER_EMBEDDING_ENABLED`, and the
plan tree this README used to cite has been retired. What the bench still does is
the thing it is for — it is the only place the numbers in
`docs/system-architecture.md` can be reproduced, and each runner carries its own
pass bars as constants rather than deferring to a document.

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

## What is in here

Grouped by what a piece measures rather than by phase number: the phase numbering
this section used to carry belonged to the plan tree that has since been retired,
and a status column pointing at a deleted document is how a reader ends up citing
a state the bench left long ago. Every runner carries its own pass bars as
constants.

**Substrate**, shared by every runner.

| Piece                        | What it is                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `speaker_bench/segment.py`   | Port of the production speech gate. Cuts audio the way the app cuts it.        |
| `scripts/gate-reference.mjs` | Drives the **real** TypeScript `SpeechGate` offline — the segmentation oracle. |
| `speaker_bench/embed.py`     | Warm `SpeakerEmbeddingExtractor`, L2-normalised output, one lock per model.    |
| `speaker_bench/corpus.py`    | Streaming access to the VoxVietnam test split — 38 parquet shards, 4.3GB.      |
| `speaker_bench/pairs.py`     | Trial-pair construction for a corpus carrying no session metadata.             |
| `speaker_bench/augment.py`   | Far-field simulation: a room impulse response plus additive noise.             |
| `speaker_bench/channel.py`   | Turn-log handling for the browser-channel recording.                           |
| `speaker_bench/io.py`        | Audio loading, the production resample path, and the shared CSV writer.        |
| `speaker_bench/scoring.py`   | Scoring and count metrics that keep the sign, borrowing no oracle.             |
| `scripts/download_models.py` | The three candidate models, plus labelled smoke clips.                         |
| `scripts/fetch_corpora.py`   | VoxVietnam and Vietnam-Celeb. Never accepts a licence on your behalf.          |

**The algorithm under test.**

| Piece                               | What it is                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `speaker_bench/online.py`           | The attributor the product runs: two thresholds, a dead zone, an optional cluster cap. |
| `speaker_bench/settle.py`           | The offline arm — average-linkage agglomerative clustering over a finished session.    |
| `scripts/attribution-reference.mjs` | Drives the **real** TypeScript clusterer offline — the attribution parity oracle.      |

**Runners.**

| Runner                      | What it answers                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `run_latency.py`            | Embedding cost per model x duration x thread count, idle and under STT contention. |
| `run_pairwise.py`           | Turn-against-turn verification EER. This is the number Checkpoint 1 read.          |
| `run_session.py`            | Simulated meetings, unknown speaker count, `cold` and `warm` modes.                |
| `run_settle.py`             | Whether the offline pass repairs the online arm, merges and splits never netted.   |
| `run_duration_control.py`   | Whether turn length or the trial population dominates the EER.                     |
| `run_channel_delta.py`      | How far the browser's `noiseSuppression` and `autoGainControl` move the numbers.   |
| `run_known_good_control.py` | Whether the bench itself is sound, against a published VoxCeleb1-O EER.            |

`scripts/probe_*.py` are seven one-question probes, each named for its question:
truncation window, channel leakage, threshold transfer, centroid growth, enrolment
identification, unenrolled guest, session-level guest detection.

**The order it happened in**, because one heading further down still reads as a
standing verdict. `run_pairwise.py` ran first and returned KILL. The kill clause
named enrolment as the first thing to try before abandoning the feature, and
`scripts/probe_enrollment_identification.py` measured it: audio that scores 23.0%
EER turn-against-turn identifies at 88.3% against a centroid built from about 15
seconds. What had failed was the task, not the model — open-set verification on
one 2s turn is not what the product does. That reopened the gate; `run_session.py`
and `run_settle.py` were then written against the task the product actually runs,
and the acoustic layer ships behind `SPEAKER_EMBEDDING_ENABLED`.

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

## Checkpoint 1 returned KILL (overturned)

Kept in full because it was correct about what it measured, and what it measured
is still true of turn-against-turn verification. It is not the operating regime
the product ended up in — see "the order it happened in" above.

`run_pairwise.py`, 100,044 embeddings over VoxVietnam's test split. EER at the gate cell
(far-field, 2s turns), against a 10% PASS bar and a 15% KILL threshold:

| model                   | clean 1s / 2s / 3s  | far-field 1s / 2s / 3s  |
| ----------------------- | ------------------- | ----------------------- |
| eres2netv2              | 20.9 / 21.1 / 19.6% | 27.4 / **23.0** / 20.7% |
| campplus                | 21.2 / 20.5 / 20.5% | 27.7 / **23.1** / 22.7% |
| wespeaker_en (baseline) | 37.0 / 31.3 / 29.6% | 36.8 / **34.8** / 33.7% |

**The dead zone is the more decisive number.** tau_hi 0.472 / tau_lo 0.194 gives a 0.278-wide dead
zone, which swallows 47% of same-speaker turns and 54% of different-speaker turns. Coverage is
**49.5%** against Phase 4's >=80% requirement. Even a perfect clustering algorithm downstream would
leave half of all turns unattributed.

The models are not blind — eres2netv2 separates same from different by +0.30 mean cosine. What fails
is the **variance**: at +-0.21 the same-speaker distribution's lower tail reaches deep into the
non-target one, so no single threshold splits them. That is "right on average, unreliable per turn",
which is exactly the regime where per-turn attribution fails.

### The verdict was audited before it was believed

A KILL ends the feature, so it got the scrutiny a suspiciously good number would get:

- **Truncation window.** The screen takes each clip's first n seconds and bypasses `segment.py`.
  `scripts/probe_truncation_window.py` shows clip starts are almost all speech (leading window a
  median 4% quieter than the loudest) and that using the loudest window instead moves EER by
  **0.3 points**. Not the explanation.
- **Pair rigour.** Sampling with no gap rule gives **14.3%**; the gap>=25 rule gives 20.1% on the
  same subset. So a naive bench would have reported MARGINAL rather than KILL — the rigour changed
  the verdict. Even 14.3% fails the 10% bar.

**Every known bias points the same way.** Negatives are matched on nothing (Vietnam-Celeb-H matches
gender and dialect, which is harder); there is no browser DSP anywhere; residual same-video pairs
would inflate further. The real number is at least this bad.

## The corpora, and why the screen no longer needs participants

Checkpoint 1 used to run on a self-recorded 3-5 person session, which blocked three phases on
scheduling. It now runs on public Vietnamese speaker-verification corpora with official trial lists
— a far stronger screen (120 test speakers, ~55k matched pairs) that needs nobody. The recording
survives as the browser-channel arm — `recorder/`, `speaker_bench/channel.py` and
`run_channel_delta.py` — measuring the one thing no corpus has: production's browser DSP channel.
**The gate did not kill the feature, so that recording is owed rather than avoided, and it has not
been made**: nothing under `results/` carries a channel-delta number. That is the whole reason every
shipped threshold is calibrated on audio the browser's `noiseSuppression` and `autoGainControl`
never touched, and the reason the feature ships switched on to be measured rather than because the
measurements say it is ready.

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

### What the fetched corpus actually contains

VoxVietnam's `test` split, measured after fetching (38 shards, 4.3GB):

|                       |                    |
| --------------------- | ------------------ |
| Utterances / speakers | 26,523 / 150       |
| Total audio           | 40.7h              |
| Sample rate           | 16 kHz, every clip |
| Duration p50          | **3.00s**          |

| Bucket | Utterances     | Speakers with a same-speaker pair |
| ------ | -------------- | --------------------------------- |
| 1s     | 6,099 (23.0%)  | 92                                |
| 2s     | 6,956 (26.2%)  | 100                               |
| 3s     | 13,399 (50.5%) | 135                               |

The 2s cell Checkpoint 1 reads has 6,956 utterances over 100 usable speakers, so the gate is not
being read off a thin cell.

**Two caveats that belong next to any number from this corpus.** It is already 16 kHz, so
`to_pcm16_16k` has nothing to resample — production audio reaches the extractor after a 48->16k
per-block downsample and this audio never did. And utterances per speaker run from 1 to **2,559**
while the median speaker has 8, so unbalanced pair sampling would produce an EER describing three
voices rather than a language. Phase 3 caps per-speaker contribution and reports the effective
speaker count beside every EER.

### Which VoxVietnam test set, and why it matters

VoxVietnam's HuggingFace repo carries audio and speaker labels only — no trial list. The authors
recommend **VoxVietnam-O** (separate Drive download) over VoxVietnam-E/H, because E/H were "labelled
by volunteers without visual information". The gap that correction opens is large:

| ECAPA-TDNN trained on | EER on O (verified) | EER on E / H (noisy labels) |
| --------------------- | ------------------- | --------------------------- |
| VoxVietnam-T          | **3.03%**           | 12.80 / 21.81               |
| Vietnam-Celeb-T       | 3.25%               | —                           |

So a Vietnamese-trained model reaches ~3% on clean data, not ~13%. Quoting E/H as the reference
would have made Checkpoint 1's <=10% bar look far harder than it is.

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

## References

**Nothing here was derived from a paper**, and stating that before the list
matters more than the list does. `speaker_bench/online.py` was written from the
problem, and both of its thresholds come from calibrating it on held-out speakers
in this bench rather than from any published value. What follows is what the field
calls what this code does, recorded so a number produced here can be argued about
in the field's terms — not a provenance claim.

**The embedding model.** CAM++ — Hui Wang, Siqi Zheng, Yafeng Chen, Luyao Cheng,
Qian Chen, _CAM++: A Fast and Efficient Network for Speaker Verification Using
Context-Aware Masking_, Interspeech 2023, arXiv:2303.00332. Distributed in the
3D-Speaker toolkit (arXiv:2403.19971) and served through sherpa-onnx as
`3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`. The two candidates
it beat are ERes2NetV2 and a WeSpeaker English model; `run_latency.py` is where
that choice was made, and on latency rather than accuracy.

**The online clustering.** `online.py` is a two-threshold sequential clustering
scheme over an unknown number of clusters, with an undecided band between the
thresholds and a later pass that resolves it. In pattern-recognition terms that is
**TTSAS**, the Two-Threshold Sequential Algorithmic Scheme of Theodoridis &
Koutroumbas, _Pattern Recognition_, ch. 12; the cluster ceiling (`k_max`) is
BSAS's `q` from the same family, and the running-sum centroid is a sequential
k-means update in the manner of MacQueen (1967). Three departures are deliberate:
similarity is cosine rather than distance, so every inequality inverts; exactly
one resolving pass runs rather than looping to fixation; and `above_cap` has no
counterpart at all, because the textbook scheme has no notion of a cap it is
expected to keep working past.

**The settle pass.** `speaker_bench/settle.py` is average-linkage **agglomerative
hierarchical clustering** on cosine distance, the standard offline baseline for
this task, kept here as the offline arm the online attributor is measured against.

**The task's name.** Labelling turns a segmenter has already cut is not
diarization, which also decides where the boundaries and overlaps are. The nearest
named family is the centroid-based branch of **online speaker diarization**; the
naive online clustering baseline this resembles is described in Wang et al.,
_Speaker Diarization with LSTM_, arXiv:1710.10468. The argument for declining to
decide under uncertainty, rather than forcing every segment into its nearest
cluster, is made in Kwon, Heo, Lee, Kim and Jung, _Absolute decision corrupts
absolutely: conservative online speaker diarisation_, ICASSP 2023,
arXiv:2211.04768 — a different mechanism from the dead zone here, and the same
reason for having one.

**The corpora and the control.** VoxVietnam (Pham et al., Interspeech 2023) is the
primary set and is licence-gated — `scripts/fetch_corpora.py` will not accept the
licence for you. Vietnam-Celeb is the secondary. `run_known_good_control.py` is
the control that establishes the bench itself is sound, by reproducing the tested
checkpoint's published 1.16% EER on VoxCeleb1-O.
