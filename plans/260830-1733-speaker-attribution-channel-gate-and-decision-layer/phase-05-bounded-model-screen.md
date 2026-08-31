---
phase: 5
title: 'Bounded model screen'
status: completed
priority: P3
effort: '1d'
dependencies: []
---

# Phase 5: Bounded model screen

## Overview

The user asked whether adding a model helps. Close that axis with a number
rather than an argument.

Runs **in parallel** with Phases 1-2 and is **abandonable at any point**. It
adds no product code and ships nothing unless it clears a hard bar.

## Requirements

**Functional**

- Screen drop-in candidates from the same sherpa-onnx release the sidecar
  already consumes, through the existing harness. No new bench code.
- Report EER at the gate cell and p95 latency at the 2-decode ceiling for each.
- **The adoption bar, stated once — four conditions, licence first:**
  1. **Licence** recorded in the CSV, not only in a docstring, and checked
     _before_ any measurement. **Relaxed by D7:** Chatofy is a non-commercial
     graduation project, so NC-licensed weights are permitted where they were
     previously excluded. VoxBlink2 therefore fails on **latency and size alone**
     (25-50M params, 2-8× over budget), not on its CC BY-NC-SA terms. The
     condition stays in the bar because it must still be recorded, and because a
     future commercial turn would reinstate it as a hard filter.
  2. **≥3.0 EER points** over campplus's 23.1% at the gate cell.
  3. The **enrollment top-1** cell moves — EER alone has proved insensitive to
     model choice across this range.
  4. **≤200ms p95** at the applicable contention cell. Note that
     `contended-stt4` (132.2ms for campplus) is the _per-container_ ceiling; with
     both stacks live the host runs up to four concurrent decodes, and the
     measured analogue is `contended-stt8`, where campplus is already 183.5ms.
     Screen against `contended-stt8` or state why not.

  Otherwise the axis closes permanently and campplus stays.

**Non-functional**

- Latency measured **in the prod container**, not on the host — the two diverged
  57% on one contended cell, and the container run is authoritative.
- `SPEAKER_BENCH_REQUIRE_PARITY=1`.

## Architecture

### Why the prior is against this

- campplus 23.1% vs eres2netv2 23.0% at far-field 2s — 0.1 points for 3.9× the
  latency.
- On the metric that actually gates the product, they are indistinguishable:
  enrollment top-1 far-field 2s N=5 is 79.0% vs 80.0%, inside noise.
- Architecture is not the axis; **training data dominates**. `wespeaker_en` and
  production's campplus are both CAM++ and score 34.8% vs 23.1% at the same cell
  — **11.7 points**. Caveat added after red-team: they are not a clean controlled
  pair. Measured embedding dimensions differ (512 vs 192, bench README), so
  recipe and dimension are confounded with corpus. The direction of the effect is
  solid; "corpus alone" overstates it.
- No Vietnamese-trained speaker embedder is published. VoxVietnam ships a
  dataset, not weights.

So the only candidates worth an hour are ones whose _training data_ differs in a
direction that might transfer to Vietnamese far-field.

### Candidates

| Candidate                                                      | Why worth one run                                                                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx`           | Same architecture and cost class as production's; different corpus. Isolates the corpus axis at zero latency risk                                     |
| `3dspeaker_speech_eres2net_base_200k_sv_zh-cn_16k-common.onnx` | 200k-speaker training set; sits between campplus and eres2netv2 on size. Cost must be **measured**, not extrapolated from file size                   |
| `wespeaker_zh_cnceleb_resnet34_LM.onnx`                        | CN-Celeb is multi-genre and tonal — the closest available domain analogue to VoxVietnam's in-the-wild content. The only genuine hypothesis in the set |

### Explicitly out of scope, with reasons

- **ReDimNet** — MIT and cheap, but no ONNX export in this stack (needs a
  hand-built fbank frontend outside `SpeakerEmbeddingExtractor`), and it is
  VoxCeleb-trained, i.e. the class that measured 34.8% here.
- **VoxBlink2 SimAM-ResNet34/100** — clearly stronger, and its CC BY-NC-SA 4.0
  terms are **no longer disqualifying** under D7. It remains dead on **latency
  and size**: 25-50M params, 2-8× over budget. One reason instead of two, and the
  surviving reason is the harder one.
- **resnet293_LM / titanet_large** — dead on latency without needing a run.
- **int8 quantisation** — no published int8 speaker model in the release, and
  campplus already keeps >80% headroom. It would only make an equally-accurate
  model cheaper, which buys nothing.
- **Fine-tuning on Vietnamese** — under D7 the `cc-by-nc-4.0` terms no longer
  block this, so the honest reason is now **effort and scope**: it is a training
  project, not a screen, and it is a plan non-goal. Recorded because the previous
  version cited a licence bar that no longer applies.

### Fusion

campplus + one cheap second model lands ~270ms at the ceiling — **estimated by
summing the two measured costs (132.2 + 136.6), not measured as a pair** — still
inside the window. But both 3D-Speaker candidates share training data, so score
correlation is high and the gain likely small. Do not add a second model to the
image on current evidence.

## Related Code Files

- Modify: `benchmarks/speaker-id/scripts/download_models.py` (one URL per
  candidate, each with its source corpus and licence, **plus a `sha256` verified
  before the staging rename** — neither downloader checks any hash today, and an
  adopted model is baked into the production image)
- Modify: `benchmarks/speaker-id/speaker_bench/embed.py:59` — the `CANDIDATES`
  registry. This is what every bench script actually resolves models through
  (11 call sites across 9 files); `download_models.py` only fetches bytes. Mark
  new entries so they do not silently join `SHIPPING` and widen the smoke-test
  matrix, and note that `run_pairwise.py:131` uses `default=list(CANDIDATES)`.
- Modify: `benchmarks/speaker-id/scripts/build_embedding_cache.py:62` and the
  per-script `MODELS = ("eres2netv2", "campplus")` tuples that would otherwise
  exclude the new candidates
- Modify: `services/local-stt/scripts/download_models.py` — `sha256` verification
  (adopted candidates only)
- Create: `benchmarks/speaker-id/results/pairwise-summary-screen.csv`
- Create: `benchmarks/speaker-id/results/latency-container-screen.csv`

## Implementation Steps

1. **Check each candidate's licence first** and drop anything off the allowlist
   before spending a download.
2. Add the three candidates to `download_models.py` with source corpus, licence
   and a verified `sha256`; register them in `speaker_bench/embed.py`'s
   `CANDIDATES` and in `build_embedding_cache.py`'s model tuple.
3. Confirm each loads through `SpeakerEmbeddingExtractor` unmodified. A candidate
   needing a custom onnxruntime path is out of scope — record it and stop.
4. Rebuild the embedding cache for the new candidates.
5. Run `run_pairwise.py` on the cached VoxVietnam set for each candidate.
6. Run `probe_enrollment_identification.py` at the target cell for any candidate
   clearing the EER bar.
7. Run `run_latency.py` **in `chatofy_prod-local-stt`**, `--stt-instances 2`,
   extractor `num_threads=2`, at **both** `LOCAL_STT_THREADS=4` and `=8` so the
   host co-tenancy cell is covered.
8. Write the verdict: adopted, or the axis is closed on measurement.

## Success Criteria

- [x] Every candidate's licence checked against the allowlist **before**
      measurement, and recorded in the results CSV — all three Apache-2.0;
      `licence`/`corpus`/`role` are columns in `pairwise-summary-screen.csv`
- [x] Every downloaded asset verified by `sha256` before use — verified before
      the staging rename; digests pinned on first fetch (upstream publishes none)
- [x] Candidates registered in `speaker_bench/embed.py`'s `CANDIDATES`, not only
      in the downloader — and the downloader now derives its list FROM that
      registry instead of keeping a second one
- [x] Three candidates screened at the gate cell with per-turn CSV —
      `results/screen/pairwise-pairs.csv`, 9.5MB
- [x] Latency measured in the prod container at both `LOCAL_STT_THREADS=4` and
      `=8` — `results/latency-container-screen.csv`
- [x] A candidate is adopted **only** on all four conditions — none was; all
      three fail condition 2, and two also fail condition 4
- [x] The model axis is recorded as closed on measurement and campplus stays
- [x] Every reported external benchmark carries its corpus and condition

## Outcome — 2026-08-31

**AXIS CLOSED. campplus stays.** Full report:
`reports/measurement-260831-1730-phase-05-model-screen.md`.

| candidate            | EER (far-field 2s) | vs campplus | p95 stt8 | verdict             |
| -------------------- | ------------------ | ----------- | -------- | ------------------- |
| eres2net_base_200k   | 22.5%              | +0.53 pts   | 248.9ms  | FAIL (cond 2 and 4) |
| campplus_zh          | 23.5%              | −0.39 pts   | 125.1ms  | FAIL (cond 2)       |
| wespeaker_zh_cnceleb | 26.0%              | −2.92 pts   | 217.6ms  | FAIL (cond 2 and 4) |

The best candidate buys 0.53 EER points against a 3.0-point bar, at 2.6× the
latency. The predicted "expected value is low and that is fine" held exactly.

Two claims in this phase's own Architecture section are now corrected by
measurement: the CN-Celeb hypothesis is **refuted** (worst of the four), and
"training data dominates" holds only across English-vs-Mandarin — _within_
Mandarin corpora the axis is flat to within 0.5 points.

## Risk Assessment

**Expected value is low and that is fine.** The phase exists to close an axis,
not to find a winner. _Pre-decided response:_ a negative result is the
deliverable; do not escalate into ONNX-export work.

**A candidate needs custom plumbing.** _Signal:_ it will not load through
`SpeakerEmbeddingExtractor`. _Response:_ record and stop. Integration cost is
out of this phase's bounds.

**A real-but-useless gain.** A winner at 19-20% EER instead of 23% changes no
product decision, because the metric that gates the product is insensitive to
model choice across this range. _Response:_ the three-part bar in Requirements —
EER alone cannot buy adoption.

**Quoting a headline EER without its condition.** The literature numbers here
(0.3-1.5% on Vox1-O) come from clean full-length English; this product's cell
reads 23%. _Response:_ explicit success criterion.

**An unverified remote graph reaches production.** Both downloaders fetch ONNX
over plain `urllib` with no checksum and no pinned digest, and an adopted model
is baked into the image on the box that also runs the production stack.
_Response:_ `sha256` verification is a success criterion, and it is a two-line
change to the existing staging-then-rename pattern.

**A licence-blocked model passes on measured merit.** _Signal:_ a candidate
clears EER and latency and nobody checked its terms. _Response:_ licence is
condition 1, evaluated first, and recorded in the CSV rather than a docstring.
