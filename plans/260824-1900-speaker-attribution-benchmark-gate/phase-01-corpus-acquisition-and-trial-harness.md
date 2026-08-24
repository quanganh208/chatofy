---
title: 'Phase 1: Corpus acquisition and trial harness'
status: in-progress
phase: 1
priority: P1
effort: '1d work; elapsed gated on dataset access approval'
dependencies: []
---

# Phase 1: Corpus acquisition and trial harness

## Overview

Fetch the public Vietnamese speaker corpora Checkpoint 1 screens on, and construct the trial-list
and EER machinery Phase 3 reads off. No participants, no scheduling.

**This phase replaced a self-recording phase.** The original Phase 1 produced a 3-5 person fixture
and blocked Phases 3, 4 and 6 on convening people twice. Research
(`plans/reports/research-260824-2132-vietnamese-speaker-corpora.md`) found public Vietnamese
speaker-verification corpora with official trial lists, which give a **much stronger screen** —
120 test speakers and ~55k gender-and-dialect-matched pairs, against 3-5 participants — and give it
immediately. The recording work survives as Phase 7, measuring the one thing corpora cannot supply.

## Requirements

**Functional**

- [ ] VoxVietnam **test split only** fetched (38 parquet shards), not the 44GB whole
- [ ] Vietnam-Celeb extraction VERIFIED on disk (manual download), licence resolved before use
- [x] Trial-list parsing, EER computation, and duration bucketing available to Phase 3
- [ ] Audio normalised to 16k mono through the SAME path the bench uses elsewhere

**Non-functional**

- [x] Corpus audio gitignored — large, and licensed for evaluation rather than redistribution
- [x] Fetch script idempotent, matching `scripts/download_models.py` style
- [x] **The script never accepts a dataset licence on the user's behalf**

## Architecture

**Two corpora, different roles.**

|                       | Vietnam-Celeb                              | VoxVietnam                                        |
| --------------------- | ------------------------------------------ | ------------------------------------------------- |
| Speakers / utterances | 1,000 / 87,140                             | 1,406 / 187,980                                   |
| Hours                 | 187                                        | 261                                               |
| `<2s` / `2-5s`        | 5.8% / 43.8%                               | 23.6% / 51.0%                                     |
| Extra labels          | **gender + dialect** (N/C/S)               | genre (spontaneous/reading/singing)               |
| Trial lists           | official E + H, 55,015 pairs each, 120 spk | E + H; VoxVietnam-O separately                    |
| Access                | GitHub -> Google Drive, 4-part zip         | HF `hustep-lab/VoxVietnam-Dataset`, `gated: auto` |
| Licence               | **unstated on the repo**                   | **cc-by-nc-4.0** (HF metadata)                    |

VoxVietnam is **primary**: its licence is explicit, its `test` split is 38 shards separable from the
44GB whole, and 74.6% of its utterances are under 5s — much closer to this product's 1-3s turns than
Vietnam-Celeb's 49.6%.

Vietnam-Celeb is **secondary but valuable**, for two reasons VoxVietnam does not cover:

1. Its **H list matches negatives on gender AND dialect**. A screen whose negatives are random pairs
   flatters any model; matched negatives are the honest hard case, and dialect matching in
   particular is a Vietnamese-specific confound nothing else here controls for.
2. Its paper publishes EER for a **VoxCeleb-pretrained** model on the same lists (13.19 E / 16.52 H)
   and for a Vietnamese-trained one (6.31 / 8.62). Running our candidates on those exact lists makes
   our numbers directly comparable to a published reference instead of free-floating.

**Licence handling is a hard behaviour, not a note.** VoxVietnam is `gated: auto` — it requires a
logged-in HuggingFace account that has accepted its conditions. `fetch_corpora.py` therefore reads a
token from the environment and **fails with an explanation** if it is absent or unaccepted. It never
sends an acceptance, and never works around the gate.

**Vietnam-Celeb cannot be fetched at all — corrected during implementation.** The plan assumed its
trial lists were plain text in the GitHub repo. They are not: the repo holds only a README pointing
at four Google Drive parts, and `vietnam-celeb-e/h.txt` plus the speaker metadata TSV live _inside_
that archive. There is no piecemeal path, and Drive blocks automated downloads at that size. So the
script **verifies** an extraction the user performed and names precisely which files are still
absent, rather than pretending to download it. Its licence is unstated — which is more restrictive
in practice than a stated NC one, since absent an explicit grant default copyright applies.

Consequence for sequencing: **VoxVietnam alone is enough to run Checkpoint 1**, and a missing
Vietnam-Celeb is therefore not a fetch failure. What it costs is the published-baseline comparison
(13.19/16.52) and the gender+dialect-matched negatives — valuable, not blocking.

**Corrected after fetching: VoxVietnam ships no trial list on HuggingFace.** The repo holds only
`data/*.parquet` plus a README, and the parquet schema is `{audio: {array, sampling_rate}, speaker}`.
Pairs must therefore either be constructed from the speaker labels, or taken from **VoxVietnam-O** —
a separate, cleaner evaluation set on Google Drive that the authors explicitly recommend over
VoxVietnam-E/H, because E/H "are labelled by volunteers without visual information".

That correction moves the reference numbers a long way, and in the optimistic direction. ECAPA-TDNN
on VoxVietnam-O: **3.03% EER** trained on VoxVietnam-T, 3.25% trained on Vietnam-Celeb-T — against
the 12.80/21.81 measured on the noisy-label E/H sets quoted in the earlier research report. A <=10%
Checkpoint 1 bar looks far more reachable against 3% than against 13%.

The Vietnam-Celeb figures are unaffected: that corpus used visual-aided labelling, so its
13.19/16.52 for a VoxCeleb-pretrained model remains the honest reference for cross-language transfer.

`cc-by-nc-4.0` is non-commercial. Evaluating off-the-shelf models on it is research use and is
fine; **training on it or shipping any part of it is not**, and this gate does neither. The gate
report records the licence of every corpus a number came from.

**The EER machinery lives in `speaker_bench/`, not in the Phase 3 script.** Phase 3 computes an EER,
Phase 4 re-uses the same threshold sweep to calibrate tau, and Phase 7 compares two EERs. Three
callers means one implementation, tested on its own.

**Duration buckets are derived, not selected.** A trial list gives whole utterances; the gate needs
1s/2s/3s buckets. Truncation is the mechanism, and it must run through `to_pcm16_16k` so the audio
handed to the extractor is framed the way `capture-pump.ts` frames it — the same reason `segment.py`
is a port rather than a shortcut.

## Related Code Files

- Create: `benchmarks/speaker-id/scripts/fetch_corpora.py` — gated fetch, idempotent, never auto-accepts
- Create: `benchmarks/speaker-id/speaker_bench/trials.py` — trial parsing, EER sweep, duration buckets
- Create: `benchmarks/speaker-id/tests/test_trials.py` — EER verified against an analytic value
- Create: `benchmarks/speaker-id/tests/test_fetch_corpora.py` — the gate refusal is the tested behaviour
- Modify: `benchmarks/speaker-id/.gitignore` — corpora/
- Read (do not modify): `benchmarks/speaker-id/speaker_bench/io.py`, `speaker_bench/segment.py`

## Implementation Steps

1. `speaker_bench/trials.py`: parse the VoxCeleb-convention trial line (`label path_a path_b`),
   compute EER by threshold sweep with interpolation at the crossing, and bucket by duration.
2. `tests/test_trials.py`: verify EER against the analytic value for two Gaussians of known
   separation, plus the degenerate cases (perfect separation -> 0, identical distributions -> 0.5).
3. `scripts/fetch_corpora.py`: VoxVietnam test split via `huggingface_hub` with `allow_patterns`
   restricted to `data/test-*`; Vietnam-Celeb verified rather than fetched, with the manual Drive
   procedure and the licence caveat printed when files are absent.
4. Gitignore `corpora/`.
5. Resolve the Vietnam-Celeb licence question before any number derived from its audio is reported.

## Status

Harness complete and tested; **the corpora themselves are not fetched.** VoxVietnam needs a
HuggingFace token from an account that has accepted its conditions, and Vietnam-Celeb needs a manual
Google Drive download with its licence resolved. Both are the user's acts, deliberately: the script
refuses rather than deciding either on their behalf.

Unticked criteria below are exactly the ones that need data on disk.

## Success Criteria

- [x] `fetch_corpora.py` runs idempotently and refuses, with an actionable message, when the
      HuggingFace gate has not been accepted
- [ ] VoxVietnam test split on disk, 16k mono, without the train splits
- [ ] Vietnam-Celeb extraction verified when present, and its absence reported without failing
- [x] `trials.py` EER matches the analytic Gaussian value within tolerance
- [ ] Duration bucketing runs through the production resample path
- [x] Corpora gitignored; no corpus audio in git

## Risk Assessment

- **Licence taken for granted (highest).** `cc-by-nc-4.0` permits evaluation, not shipping, and
  Vietnam-Celeb states nothing at all. Signal: a gate number quoted without naming its corpus.
  Response: the gate report names the corpus and licence behind every number, and the fetch script
  refuses to act on the user's behalf.
- **The gate is now calibrated on a channel production does not use.** Corpus audio is
  broadcast-processed, not `getUserMedia`-processed. Signal: none at gate time — this fails silently.
  Response: Checkpoint 1 stays explicitly necessary-but-not-sufficient, and Phase 7 measures the
  delta before any tau ships.
- **Test split still large.** 38 shards of a 44GB dataset is roughly 4-5GB, not 40MB. Signal: disk
  pressure or a fetch that will not finish. Response: shard-level `allow_patterns` already bounds it;
  take a subset of shards and record how many were used, since EER over 55k pairs is stable well
  before the full set.
- **Gate approval never arrives.** VoxVietnam is `gated: auto`, which is normally instant, but it is
  still an account action, and it is now the only automatable corpus. Signal: the fetch keeps
  refusing. Response: Vietnam-Celeb's manual Drive download is the independent path, at the cost of
  a much larger transfer and an unresolved licence.
- **Ties in the score distribution flatter the EER.** Found while implementing: a threshold sweep
  stepping per SAMPLE rather than per DISTINCT score treats equal scores as orderable and credits
  itself with separation the data does not contain. Signal: EER improves when scores are rounded.
  Response: `compute_eer` sweeps unique thresholds, and two invariant tests (duplication does not
  move the EER; quantisation does not lower it) fail if that ever regresses.
