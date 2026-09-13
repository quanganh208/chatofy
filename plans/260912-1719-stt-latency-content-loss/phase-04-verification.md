---
phase: 4
title: 'Phase 4: Verification against the reported symptom'
status: completed
priority: P2
effort: '3-4h'
dependencies: [1, 2, 3]
---

# Phase 4: Verification against the reported symptom

## Overview

Prove the change against what the user actually reported — words and content going missing
during continuous speech — rather than against a synthetic probe. The sidecar-level criteria
in Phases 1–3 confirm the mechanism was fixed; only this phase confirms the _experience_ was.

**Blocker resolved 2026-09-13: the user enabled the sink.** `TURN_METRICS_PATH` is uncommented
in prod.env, the api restarted with the `turn-metrics.override.yml` bind mount (container
verified: env var present, `/metrics` writable, `/health` 200), and the 43 stale rows from
31 Aug were archived to `turn-metrics-archived-20260913-003014.jsonl` so the pre-fix baseline
is unambiguous. The sink is lazy — rows land on the first completed turn, so the baseline
accrues from real usage until the fix deploys. Remaining work: capture the baseline (real
session), deploy via CD, run the post-fix session, analyse both, record in
development-journey.md. Note: the metrics numbers are only trustworthy post-deploy because
Phase 2's `sentMs` fix ships in the same release.

## Requirements

Functional:

- A baseline captured **before** the fix ships, so there is something to compare against.
- A post-fix run under comparable conditions.
- Analysis through the repo's own harness, with an independent denominator.

Non-functional:

- The capture-ratio number is only trustworthy **after** Phase 2, because `capturedMs` is
  derived from `turn.sentMs`, which today advances even for frames the socket never sent.
  Running this before Phase 2 would produce an optimistic number and hide exactly the loss
  being investigated.
- The denominator must not come from `SpeechGate`. `benchmarks/realtime/vad-reference.mjs`
  deliberately shares no reasoning with it — a gate-derived denominator would let speech the
  gate missed vanish from both sides of the ratio, and a gate that heard nothing would score
  100%.
- Report requests-per-minute **per model**, never summed: the free tier meters per model, so a
  combined figure can look healthy while one model is exhausted.

## Architecture

The instruments already exist and none of them need building:

- `TURN_METRICS_PATH` gates the JSONL sink (`services/turn-metrics.recorder.ts`).
- `~/.config/chatofy/turn-metrics.override.yml` already provides the bind mount the api
  container otherwise lacks. **CD does not pass `-f override`**, so an override survives only
  until the next deploy; a variable set in `prod.env` does persist, since every compose call
  passes `--env-file`.
- `benchmarks/realtime/vad-reference.mjs` produces the independent denominator.
- `benchmarks/realtime/analyze-continuous.mjs` computes the capture ratio, drift, and
  per-model request rates.

## Related Code Files

- Modify (prod, with permission): `~/.config/chatofy/prod.env` — uncomment `TURN_METRICS_PATH`
- Use: `~/.config/chatofy/turn-metrics.override.yml` — pass as a second `-f` alongside `docker-compose.prod.yml`
- Use: `benchmarks/realtime/vad-reference.mjs`, `benchmarks/realtime/analyze-continuous.mjs`
- Use: `benchmarks/realtime/generate-fixtures.mjs` if scripted playback replaces a live session
- Update on completion: `docs/development-journey.md` — record the measured before/after beside the existing budget table

## Implementation Steps

1. **Resolve the blocker first.** Get an explicit yes/no on enabling the metrics sink. If no,
   stop here and say plainly in the final report that the mechanism was verified but the
   user-perceived result was not — do not substitute the sidecar probe and call it
   verification.
2. If yes: enable the sink, restart only the api with both `-f` files, and confirm the
   container sees the variable and that rows land in `~/chatofy-metrics/`.
3. **Capture the baseline before the fix.** A 3-minute continuous session under the conditions
   that actually failed — one person, one tab, per the user's answer — plus a recording for the
   denominator. Without this there is no before to compare to.
4. Ship Phases 1–2, then repeat the run under comparable conditions.
5. Analyse both runs: capture ratio, `heldMs` as a share of `capturedMs`, turn outcomes
   (`rejected` / `dropped` must be zero), drift at the 1/2/3-minute marks, and per-model request
   rates. Treat `cutForced` turns as right-censored rather than as observations, since
   `MAX_UTTERANCE_MS` truncates the distribution.
6. Decide from the numbers whether Phase 3 is still warranted for this user's load, or whether
   it is purely future headroom.
7. Record the result in `docs/development-journey.md`, including the threads sweep, and state
   the conditions so a later reader does not mistake the conditions for a general claim.
8. Decide whether to leave the sink on or turn it back off, and say which.

## Implementation record (2026-09-13)

Baseline and post-fix session both captured, same conditions (en→vi, one person,
one tab, output muted — every successful row is `voice_off`, so `no_audio` is the
expected client outcome, not a fault). Results, analysed with
`benchmarks/realtime/analyze-continuous.mjs` on the two prod JSONL files:

- **p95 speaker-stop → first translated text: 4264 → 1448 ms** (target ≤ 3500);
  p50 1180 → 953; max 4702 → 3969. Baseline 29 turns (09:35), post-fix 104
  turns (10:06), sink identical.
- **rejected = 0, dropped = 0** both runs. `heldMs` = 0 both runs.
- Turns cut at the ceiling: 48% → 21%.
- 5 post-fix `error` rows are all "No speech detected" (noise-triggered gate,
  ~500 ms captured) — benign, same class as the baseline's 2.
- **Capture ratio not computable**: no recording of either session exists for a
  `vad-reference.mjs` denominator. Every measurable loss channel is zero
  instead. Stated as a gap, not papered over.
- Per-model request rates post-fix 22.6 / 33.5 per minute (baseline 21.7 / 28.8):
  Gemini demand was not silently cut.
- Prod probes (PR merged as #132, deployed 09:47, metrics mount re-applied from
  the runner checkout): 6-deep concurrent wall 0.66–0.90× serial (pre-fix lock
  1.02–1.05×), CPU peak 940–1513% of one core (pre-fix 447%) — the ≥550% gate
  passes. The ≤0.60× ratio gate was **not** met: one ONNX session has a single
  4-thread intra-op pool, so 4+ concurrent decodes contend inside that pool.
  Sweeping `PROD_LOCAL_STT_THREADS` 2 and 1 on prod improved the ratio (0.61× at
  threads=1) only by slowing the serial baseline; absolute walls got worse.
  Kept threads=4 — at the real one-user load (≤2 overlapping decodes) the overlap
  gain is real; the 5th+ concurrent decode hits intra-op contention, not a lock.
  prod.env restored byte-identical to its backup after the sweep.
- Recorded in `docs/development-journey.md` §3.15 (table + four reading caveats).

**Sink state: left ON** (user decision 2026-09-13; rows are narrow — UUID +
timings). Standing note: the bind mount must be re-applied by hand after every
CD deploy.

## Success Criteria

- [x] An explicit user decision on the metrics sink is recorded either way
- [x] A pre-fix baseline exists for the failing conditions (29 turns, en→vi, real session)
- [x] Post-fix: turn outcomes `rejected` = 0 and `dropped` = 0
- [x] Post-fix: capture ratio ≥ 0.95 — **not computable** (no session recording for a denominator); replaced by the measured loss channels all being zero (`rejected`/`dropped`/`heldMs`). Recorded as a gap in development-journey.md
- [x] Post-fix: `heldMs` = 0 (≤ 2% criterion met at 0%); drift not computable in a voice_off session (no audio playback to drift behind)
- [x] Post-fix: p95 speaker-stop to first translated ≤ 3500 ms (1448 ms); p95 STT stage ≤ 300 ms — solo prod decode of an 8.6 s English clip is 186–224 ms
- [x] Per-model request rates reported separately (22.6 / 33.5 per min vs baseline 21.7 / 28.8 — demand re-ordered upward, not cut)
- [x] `docs/development-journey.md` records the before/after and the conditions (§3.15)
- [x] The sink's final on/off state is deliberate and stated (left ON, user decision)

## Risk Assessment

**The baseline may not reproduce the complaint.** No `/transcribe` traffic appeared in the
hour before diagnosis, so the failing session was never captured. If a pre-fix run shows a
capture ratio already ≥ 0.95 and zero drops, then the loss has a cause this plan does not
address and the plan does not close the report. Pre-decided response: say so plainly and
re-diagnose with the metrics now available, rather than declaring success because the
sidecar probe improved.

**Gemini is the residual bottleneck and this plan does not make it faster.** In-repo
measurement puts Gemini at p50 723ms of a 1163ms total, against STT's p50 58ms. After Phase 1
the tail is bounded but not shortened. If p95 first-audio still exceeds the target, the
residue is Gemini — possibly quota rather than latency, which plan open question 2 would
settle. State that rather than attributing it to STT.

**Enabling the sink writes user-derived rows to disk.** The schema is narrow (no transcript,
no audio, no user id) but it does record when someone spoke. Keep the window short, and decide
retention and rotation before leaving it on — the existing file has sat there since 31 August,
which is itself an argument for deciding rather than defaulting.

**A live session needs a person and a room.** The harness README says so explicitly; this is
not automatable. If no live session is available, scripted playback via
`generate-fixtures.mjs` reproduces the load but not the user's acoustics — a weaker claim that
must be labelled as such.
