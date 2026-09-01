---
type: measurement
phase: 7
measurement: M11b
date: 2026-09-01
status: measured
host: ssh.quanganh208.dev (i7-11700K, 8C/16T, 31GiB)
question: 'Does this harness reproduce a published EER for the exact model under test? If it does, the Vietnamese 17% is a domain gap; if it does not, the harness is broken.'
verdict: 'SOUND on all three arms. Arm A reproduces the published 1.16% at 1.35%; arm B agrees with the official list within 0.35pt. OQ11 closes SOUND. And arm A1 shows turn length, not language, is the dominant error term: 15.65% EER on one second of English studio audio.'
---

# M11b — the known-good control

**Pre-registration. Written and committed before any number was read.** Anything
below `## Results` did not exist when the bars were chosen.

## Why this exists

M11 returned **UNDETERMINED** (R = 1.40x, inside the escalation band) and left
the plan's central question open: is **17.15% EER on 8 seconds of clean audio** a
real Vietnamese domain gap, or a broken instrument?

M11 could not decide it because **nothing in this repo has ever been measured
against a number somebody else published.** Every EER here is self-referential.

This control removes that. The exact checkpoint under test —
`iic/speech_campplus_sv_zh_en_16k-common_advanced` — publishes on its own
ModelScope card:

| test set       | EER       | minDCF (p=0.01) |
| -------------- | --------- | --------------- |
| **VoxCeleb-O** | **1.16%** | 0.1271          |
| CN-Celeb Test  | 5.98%     | 0.3805          |

[published] Source: the model card's raw README via the ModelScope repo API.

**Do not confuse this with the 3D-Speaker GitHub benchmark table** (VoxCeleb1-O
0.65% / CNCeleb 6.78%). That table belongs to
`iic/speech_campplus_sv_zh-cn_16k-common`, a **different, Mandarin-only**
checkpoint. 1.16% is the number for the file this repo actually loads.

## Corpus and licence

- **Audio:** VoxCeleb1 test split, `vox1_test_wav.zip`, from the ungated mirror
  `ProgramComputer/voxceleb` (HF API reports `gated: false`, tagged cc-by-4.0).
  1.07 GB, 4,874 wav, 40 speakers.
- **Trial list:** the **official** `veri_test2.txt` from Oxford VGG, 37,611 pairs,
  still served ungated. This is the list the published 1.16% was measured on.

**Two limitations, recorded before the run.** The mirror was not verified
bit-identical to Oxford's original zip. And VoxCeleb1's original terms may be
stricter than the mirror's cc-by-4.0 tag — this is internal benchmark use only,
and the corpus is not redistributed.

## The three arms, and what each isolates

The value of this control is that it decomposes a single failure into three
separable suspects. Every arm uses the same embedder (`campplus` through
`sherpa-onnx`) and the same `compute_eer` this repo has always used.

| arm    | pairs                     | length            | isolates                                                                         |
| ------ | ------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| **A**  | official `veri_test2.txt` | full utterance    | the embedder + the EER routine, with our pair construction **bypassed entirely** |
| **A1** | official `veri_test2.txt` | truncated to 1.0s | the duration effect, on a corpus where the model is known to work                |
| **B**  | our own `build_trials`    | full utterance    | our pair construction, against arm A on identical audio                          |

Arm A is full-length because 1.16% was measured full-length. Comparing a
truncated cell against it would repeat M11's own population mistake in a new
place.

## Pre-registered bars

### Arm A — is the measuring apparatus sound?

| reading                                               | meaning                                                        | pre-decided response                                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **EER <= 2.16%** (within 1.0 absolute point of 1.16%) | The embedder and the EER routine reproduce a published result. | Apparatus **sound**. Proceed to read B.                                                                                                       |
| **EER >= 5.0%**                                       | Cannot reproduce a published number on the published list.     | **Everything in this plan is void**, including P1's FAIL. Repairing the embedding or scoring path becomes the next phase. Do not schedule P2. |
| between                                               | Degraded but functional.                                       | Report, find the cause (resampling? loader? truncation?), and do not read arm B until it is explained.                                        |

### Arm B — is our pair construction sound? (read only if A is sound)

| reading                 | meaning                                                                  | pre-decided response                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **B <= A + 2.0 points** | Our construction agrees with the official list on the same audio.        | Pair construction **sound**. **OQ11 closes SOUND**: the Vietnamese 17% is a domain gap, P1's FAIL stands, proceed to M12-M14 and then P2. |
| **B >= A + 5.0 points** | Our construction inflates EER on audio where the official list does not. | Pair construction **broken**. **OQ11 closes SUSPECT**: stop the slice, repair `pairs.py`, re-run everything.                              |
| between                 | Partially inflating.                                                     | Report and quantify the inflation; requote every Vietnamese number with that offset stated.                                               |

### Arm A1 — the duration ratio, on a corpus that works

No pass/fail. It is a **reference value for M11's R**, which is the whole reason
M11 was undetermined. M11 measured R = 1.40x on Vietnamese over 1s -> 8s and
could not say whether that was weak-but-real or broken.

`R_voxceleb = EER(A1) / EER(A)` is the same statistic on a corpus where this
model is known to work, through this same harness. If it lands near the
literature's 2-4x while Vietnamese reads 1.40x, that is direct evidence the
Vietnamese ceiling is Vietnamese and not the harness. If it also reads ~1.4x,
then the harness compresses the duration axis everywhere, and M11's R was never
interpretable.

## Provenance

- `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest` exit code recorded below.
- Per-pair CSV emitted (constraint 11).
- Every number labelled measured / published / guess.
- 40 speakers in this control; the ~30-speaker evidence limit (constraint 13)
  applies to it too.

## Results

Run 2026-09-01 on `ssh.quanganh208.dev`. `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run
pytest`: **332 passed, exit 0**, immediately before launch. Artifacts:
`results/m11b-known-good.csv`, `m11b-known-good-pairs.csv` (76,822 rows),
`m11b-known-good.log`. Official list resolved 37,611 pairs over 4,708 clips and
40 speakers; every clip was long enough for both arms, so no pair was dropped.

| arm    | pairs    | length | EER        | same / diff   |
| ------ | -------- | ------ | ---------- | ------------- |
| **A**  | official | full   | **1.35%**  | 18802 / 18809 |
| **A1** | official | 1.0s   | **15.65%** | 18802 / 18809 |
| **B**  | ours     | full   | **1.69%**  | 1600 / 1596   |

All three bars fired cleanly. Nothing landed in a dead band.

### The apparatus reproduces a published number [measured]

**Arm A = 1.35% against a published 1.16% — 0.19pt apart**, well inside the 1.0pt
tolerance. This repo's embedder and its `compute_eer` reproduce somebody else's
result on somebody else's list. **The measuring apparatus is sound**, and that is
the first time anything in this plan has been checked against an external number.

### Our pair construction is sound [measured]

**Arm B = 1.69% against arm A's 1.35% — a +0.35pt gap** on identical audio,
inside the 2.0pt tolerance and nowhere near the 5.0pt failure bar. The rules in
`pairs.py` — `MIN_INDEX_GAP`, the per-speaker cap, the bucket rule — agree with
Oxford's official list.

**OQ11 closes SOUND.** The Vietnamese ~17% is a domain gap, not an artifact.
Phase 1's FAIL stands as a statement about this model on this corpus.

### The finding nobody was looking for [measured]

**Arm A1 = 15.65%. R_voxceleb = 11.64x.**

The harness resolves the duration axis enormously — 11.6x, far past the
literature's quoted 2-4x — on a corpus where this model is known to work.
Vietnamese reads 1.40x. **So M11's flat Vietnamese curve is a fact about
Vietnamese and not about the instrument**, exactly as arm B independently says.

But read arm A1 as a number rather than as a ratio and it says something larger.
**On one second of English studio audio, a model that scores 1.35% at full length
scores 15.65%.** Our Vietnamese one-second cell reads 24.00%.

|                                    | full length | 1.0s       | ratio  |
| ---------------------------------- | ----------- | ---------- | ------ |
| VoxCeleb1-O (English, studio)      | 1.35%       | **15.65%** | 11.64x |
| VoxVietnam (Vietnamese, broadcast) | 17.15% @ 8s | **24.00%** | 1.40x  |

**Turn length is the dominant term, and the language gap is the smaller one.**
Going from full length to one second costs **+14.3 points** on English. Going
from English to Vietnamese at one second costs **+8.4** on top of that. This plan
has spent its whole life treating the corpus and the channel as the problem. They
are a problem. They are the second one.

**Why this reframes the levers.** `TURN_S = 1.0` came from M1's measured
production median of 1065ms — a fact about how people talk to an interpreter, not
a parameter. So the largest measured lever is one the product cannot pull.

What survives, in measured order:

1. **Accumulating evidence across turns.** Already how the online attributor
   works, and it is why session-level prefix-locked accuracy reads 0.78 while the
   one-second pairwise cell reads 24% EER. This is the mechanism that is already
   carrying the feature.
2. **A non-acoustic channel** — the turn-taking prior or per-turn LID (OQ9).
3. **A better representation for short audio** (D11, fine-tuning), which is now
   better motivated than before: the deficit is concentrated at short durations,
   which is a narrower target than "Vietnamese".

**And it retires an idea this plan carried for days.** The browser-DSP channel
(P2) was framed as the decisive gate. It is still the only measurement of a real
shared microphone and still worth running — but it can no longer be the
explanation for the bulk of the error, because 15.65% of it appears on clean
English studio audio with no channel effect at all.

### Limitations, stated rather than footnoted

- The audio mirror was **not verified bit-identical** to Oxford's original zip.
  The 0.19pt agreement with the published number is itself strong evidence it is
  the right audio, but it is evidence rather than a checksum.
- VoxCeleb1's original terms may be stricter than the mirror's cc-by-4.0 tag.
  Internal benchmark use only; the corpus is not redistributed and is gitignored.
- 40 speakers, English, studio-adjacent interview audio (constraint 13). This
  says what the **harness** does. It says nothing about what the product does in
  a room.

## Unresolved questions

1. **Does the 11.6x duration slope hold on Vietnamese with a working model?**
   Both facts are now established separately — the harness resolves duration, and
   Vietnamese is flat — and their conjunction is odd enough to deserve an
   explanation rather than an assumption.
2. **Is `TURN_S = 1.0` still the right cell to design against?** It came from a
   solo, voice-off sitting (21 turns), and this measurement says the whole
   programme's difficulty is concentrated exactly there. A wrong turn-length
   estimate is now the single most expensive error available.
3. **Does the P2 recording still earn its cost?** It remains the only real-channel
   measurement, but it can no longer explain most of the error. Its value is now
   the turn-switch rate and the language mix (OQ9), not the channel delta.
