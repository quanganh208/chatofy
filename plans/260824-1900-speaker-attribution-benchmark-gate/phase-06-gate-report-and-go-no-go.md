---
title: 'Phase 6: Gate report and go/no-go'
status: completed
phase: 6
priority: P1
effort: '0.5d'
dependencies: [3, 4, 5]
---

# Phase 6: Gate report and go/no-go

## Overview

Turn the measurements into a decision that survives the session: pass or kill, with the numbers that
justify it, and either a delivery handoff or a set of re-opened options for the user.

## Requirements

**Functional**

- [ ] One report carrying both checkpoint decisions and every number behind them
- [ ] On PASS: chosen model, calibrated τ values, measured accuracy band, latency verdict
- [ ] On KILL: the re-opened options, with what each would cost given what was learned
- [ ] The brainstorm record's unresolved questions revisited against measurement

**Non-functional**

- [ ] Written to the configured reports path, following repository naming convention
- [ ] Honest about what was not measured

## Architecture

The report is the deliverable of this whole plan. Its job is to make the decision reproducible by
someone who was not present — which means the numbers, the conditions they were measured under, and
the ones that are missing.

**Revisit the open questions with evidence.** The brainstorm record listed six. Several become
answerable here:

1. arXiv 2606.08505 streaming diarization technique — still needs a manual read; note whether the
   measured results make it worth pursuing.
2. VoxCeleb→Vietnamese cold EER had no direct citation, only a proxy. Phase 3 measured it on the
   real channel — replace the estimate with the measurement.
3. Per-model embedding dimensions — confirmed in Phase 2.
4. The combined worst case (VN + <2s + far-field) had no published source. Phase 3 is now that
   source, for this setup.
5. Re-cluster cadence — Phase 4 outputs a recommendation.
6. Whether the 2-session recording happened, and which split Phase 4 could therefore run.

**Do not let a marginal result drift into a pass.** If either checkpoint landed in its concern band,
the report says so in those words and takes it to the user. The gate scripts exit non-zero for the
same reason: a number in prose gets rationalized, an exit code does not.

## Related Code Files

- Create: `plans/reports/gate-{date}-speaker-attribution-benchmark.md`
- Read: all `benchmarks/speaker-id/results/` artifacts
- Update: `plans/reports/brainstorm-260824-1833-speaker-attribution.md` — unresolved questions
  resolved by measurement (append resolutions; do not rewrite history)

## Implementation Steps

1. Collect every artifact: pairwise CSVs and histograms, session CSVs, latency CSVs.
2. Write the report: contract recap, what was measured, both checkpoint decisions, the threshold
   non-stationarity gap, the speaker-count trajectory, the latency verdict.
3. Resolve the brainstorm record's open questions against measurement; list what remains open.
4. State clearly what was **not** measured — overlap handling, other devices and rooms, sessions
   longer than the fixture, more than 5 speakers.
5. **Name the deferred acceptance item explicitly.** The contract lists "end-to-end turn latency
   delta ≈ 0 measured on the prod container". Phase 5 measures a proxy — extractor cost idle and
   contended — because the real end-to-end path needs the `/embed` endpoint, which is product code
   this gate exists to authorize. Say so, so the acceptance list is not silently marked complete.
6. On PASS: write the delivery handoff — chosen model, τ values, recommended extractor
   `num_threads`, re-cluster cadence, and the concurrency ceiling if Phase 5 found one. Then run
   `/ak:plan` for the delivery phase (product code: `/embed`, API clustering, additive wire field,
   web UI).
7. On KILL: present the re-opened options to the user with what each now costs — named enrollment
   (approach C) with its consent and storage obligations, a longer-turn UX, or explicitly
   best-effort labels. Do not pick for them.

## Success Criteria

- [ ] Report written to the reports path
- [ ] Both checkpoint decisions recorded with their numbers and conditions
- [ ] Open questions revisited; resolved ones marked with the measurement, unresolved ones listed
- [ ] Unmeasured conditions stated explicitly, including the deferred end-to-end latency delta
- [ ] On PASS: delivery handoff parameters recorded and the delivery plan started
- [ ] On KILL or CALIBRATION-BLOCKED: options presented to the user, decision left to them
- [ ] `git diff --stat` confirms no changes outside `benchmarks/speaker-id/` and `plans/`

## Risk Assessment

- **Motivated reading of a marginal result.** Signal: the report arguing around a number rather than
  reporting it. Response: the concern bands are pre-declared for exactly this; a result in a concern
  band goes to the user, not through a rationalization.
- **Report outlives its accuracy.** These numbers describe one room, one laptop, 3-5 people.
  Response: scope every claim to its conditions in the text, so a later reader does not generalize
  them.
- **PASS creates false confidence for delivery.** A bench implementation is not a production one.
  Response: the delivery plan must re-verify the algorithm's behaviour in the API, using the bench
  as the reference implementation to match.

## Results

Report: `plans/reports/gate-260825-0905-speaker-attribution-benchmark.md`.

Written on a KILL, so step 6 (delivery handoff) did not apply and step 7 did: the re-opened options
go to the user. What changed is that they are no longer equally plausible, because two of the three
were measured rather than described.

- **Checkpoint 1 KILL** stands: 23.0% EER far-field @2s against a 10% bar, 49.5% coverage against an
  80% floor. Two audits (truncation window, pair rigour) confirmed it is not a harness artifact.
- **Checkpoint 2 was not run** and must not be: it benches the design Checkpoint 1 killed.
- **Named enrollment measured PASS** on Phase 4's own acceptance shape — 87.1% (campplus) / 88.3%
  (eres2netv2) over the most confident 80% of 2s far-field turns in a 5-speaker meeting, against a
  70% bar. This is a probe, not Checkpoint 2; it answers "is the option worth taking to the user",
  not "does the product work".
- **The longer-turn option is measured and nearly worthless**: 2s→5s buys 1.6 points.
- **Phase 5 decides the model, not accuracy.** eres2netv2 is MARGINAL at the 2-decode architectural
  ceiling (517ms, 28% headroom) while campplus keeps 82%, and the accuracy gap between them is 1.2
  points. If enrollment is chosen, campplus is the model.

The largest unmeasured risk moved: it is no longer "do embeddings separate Vietnamese speakers" but
**"does an unenrolled speaker get rejected"**, which this probe deliberately does not answer because
its trials are closed-set.

## Success Criteria

- [x] Report written to the reports path
- [x] Both checkpoint decisions recorded with their numbers and conditions — Checkpoint 2 recorded as
      not-run, with the reason
- [x] Open questions revisited; resolved ones marked with the measurement, unresolved ones listed
- [x] Unmeasured conditions stated explicitly, including the deferred end-to-end latency delta
- [ ] On PASS: delivery handoff parameters recorded — N/A, this was a KILL
- [x] On KILL: options presented to the user, decision left to them
- [x] `git diff --stat` confirms no changes outside `benchmarks/speaker-id/` and `plans/`
