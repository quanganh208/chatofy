---
type: measurement
phase: 5
date: 2026-08-31
host: ssh.quanganh208.dev; latency inside chatofy_prod-local-stt
verdict: AXIS CLOSED — campplus stays
---

# Phase 5 — bounded model screen: the axis closes

Three candidates screened on the same VoxVietnam trial lists as the incumbent,
in one run. **All three fail the adoption bar. campplus stays.**

## Adoption bar, all four conditions

**1. Licence — checked before any download, recorded in the CSV.**
All three are **Apache-2.0** (upstream projects `modelscope/3D-Speaker` and
`wenet-e2e/wespeaker`, read from the GitHub API). Clears the allowlist outright,
and would clear even without D7's NC relaxation. `licence`, `corpus` and `role`
are now columns in `pairwise-summary-screen.csv`, not docstring prose.

_Recorded caveat:_ this is the **upstream project's** licence. The weights are
redistributed inside the sherpa-onnx release with no separate licence file, so a
stricter term on the original ModelScope artifact would not be visible here.

**2. ≥3.0 EER points over campplus at the gate cell (far-field, 2s).**

| candidate              | EER       | vs campplus   | verdict |
| ---------------------- | --------- | ------------- | ------- |
| eres2net_base_200k     | **22.5%** | **+0.53 pts** | FAIL    |
| campplus _(incumbent)_ | 23.1%     | —             | —       |
| campplus_zh            | 23.5%     | −0.39 pts     | FAIL    |
| wespeaker_zh_cnceleb   | 26.0%     | −2.92 pts     | FAIL    |

The best candidate buys **0.53 points against a 3.0-point bar**. Two of three are
_worse_ than the model already shipping.

**3. Enrollment top-1 must move.** Not run — condition 2 gates it, and the bar
is conjunctive. No candidate reached it. (Plan step 6: _"for any candidate
clearing the EER bar"_.)

**4. ≤200ms p95 at the applicable contention cell.** Measured in
`chatofy_prod-local-stt`, `--stt-instances 2`, extractor `num_threads=2`, 2s
turns, at **both** `LOCAL_STT_THREADS=4` and `=8` as the condition requires.

| model                  | p95 stt4 | p95 stt8 | verdict |
| ---------------------- | -------- | -------- | ------- |
| campplus _(incumbent)_ | 120.0ms  | 96.6ms   | PASS    |
| campplus_zh            | 80.2ms   | 125.1ms  | PASS    |
| wespeaker_zh_cnceleb   | 199.4ms  | 217.6ms  | FAIL    |
| eres2net_base_200k     | 258.7ms  | 248.9ms  | FAIL    |

**The best candidate on accuracy is also 2.6× campplus's latency and fails here
too.** It fails both live conditions, not one.

## Verdict

**The axis closes permanently. campplus stays.** No candidate clears condition
2; the only one that even improves EER fails condition 4 as well. Nothing is
adopted, so `services/local-stt/scripts/download_models.py` is untouched — its
`sha256` change was scoped to "adopted candidates only".

## What the screen actually taught

**The CN-Celeb hypothesis is refuted.** The plan called
`wespeaker_zh_cnceleb` _"the only genuine hypothesis in the set"_ — multi-genre
tonal Mandarin as the closest available analogue to VoxVietnam's in-the-wild
content. It scored **26.0%, the worst of the four**, 2.9 points behind campplus.
Domain similarity in that sense does not transfer.

**"Training data dominates" needs narrowing.** The plan inferred that from
`wespeaker_en` (34.8%) vs campplus (23.1%) — 11.7 points. But _within_ Mandarin
corpora the axis is nearly flat: campplus_zh (monolingual zh) vs campplus (zh+en)
differ by **0.39 points**, and eres2net_base_200k's 200k-speaker set buys
**0.53**. So the large effect is English-vs-Mandarin, not corpus choice in
general. Picking a different Mandarin corpus is not a lever.

**Model choice is not the bottleneck.** Four models spanning three corpora and
two architectures land in a 3.5-point band (22.5–26.0%) at the gate cell, all far
above the 15% KILL line. The barrier is the channel and the 2s turn, not the
embedder.

**campplus is cheaper here than the plan assumed.** Condition 4 cites 183.5ms for
campplus at `contended-stt8`; on this 16-core host it measures **96.6ms**. The
verdict is unaffected — it only widens the incumbent's margin.

## Provenance and integrity

- `download_models.py` now derives its fetch list from `CANDIDATES` instead of a
  second hand-maintained filename list, and **verifies sha256 before the staging
  rename** — a corrupted or substituted payload never occupies the real path.
  Digests are **pinned on first fetch**, not upstream-published (the release
  publishes none), so they detect change, not provenance.
- Screen candidates carry a `screen` flag and are excluded from `SHIPPING`, so
  they cannot silently widen the smoke-test matrix or be asserted about as
  though adopted.
- `run_latency.py` keeps its own model map by design (it runs inside the sidecar
  image, where `speaker_bench` is not installed). **The first latency run
  silently measured only the original three** because that map was not extended
  — caught, extended, and re-run. A comment now states that a candidate added to
  `CANDIDATES` must be added there by hand or it is never measured for latency.
- `ModelSpec.dim` tripwire caught a wrong recorded dimension:
  `eres2net_base_200k` is **512**, not the 192 assumed. Corrected, and noted that
  like `wespeaker_en` it therefore confounds dimension with corpus.
- 251 tests pass (up from 242; the new candidates bring their own smoke tests).

## Unresolved questions

1. `SPEAKER_BENCH_REQUIRE_PARITY=1` was **not** enforced — Node/pnpm are absent
   on the remote, so the 71 gate-parity tests skip. Neither script here calls
   `segment.py`, so no number above depends on segmentation, but the phase's
   non-functional requirement is formally unmet.
2. Latency was measured on a 16-core host while the prod stack was live but
   idle-ish. Contention from real traffic is not modelled.
