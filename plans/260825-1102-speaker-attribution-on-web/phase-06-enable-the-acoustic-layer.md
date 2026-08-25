---
phase: 6
title: 'Phase 6: Enable the acoustic layer'
status: pending
priority: P3
effort: '0.5d effort; elapsed gated on a recording session'
dependencies: [3, 5]
---

# Phase 6: Enable the acoustic layer

## Overview

Decide whether the suggestion layer earns being on, using thresholds recalibrated on the channel the
product actually uses. This phase is a decision with evidence, not a feature.

**Blocked on Phase 7 of `260824-1900-speaker-attribution-benchmark-gate`** — the browser-channel
delta. Its tooling is built; the recording session is not scheduled.

## Requirements

**Functional**

- [ ] Channel delta measured, and its effect on the two thresholds recorded
- [ ] Thresholds re-derived on browser-channel audio if the delta is material
- [ ] The flag flipped, or explicitly left off with the reason written down

**Non-functional**

- [ ] Every shipped threshold names the channel it came from
- [ ] The end-to-end latency figure is a measurement on the prod container, not an extrapolation

## Architecture

**What this phase is really deciding.** Everything measured so far came from corpus audio that never
passed through `echoCancellation`, `noiseSuppression` or `autoGainControl`, all three of which
production enables and two of which reshape the timbre an embedding reads. The gap is double: that
far-field condition was also pyroomacoustics-simulated rather than recorded. So `tau_assign` 0.350
and `tau_new` 0.150 describe a channel the product does not have.

**What can and cannot expire.** If the delta at the 2s bucket exceeds ~5 points, the two threshold
values expire. The architecture does not: not the roster, not the wire event, not `/embed`, not the
centroid state. That is the property Phases 1-5 were shaped to have, and it is why this phase is
cheap however the measurement lands.

**Read the delta, not the absolute.** One recording session means one room, one microphone, and
same-speaker pairs that share both — exactly what the corpus screen worked to avoid. Its absolute
EER is optimistic and is not comparable to the 23.0% Checkpoint 1 reported. The two tracks differ
only in the processing, so their difference is the measurement.

**Three outcomes, all acceptable.**

1. Delta small → thresholds survive; flip the flag.
2. Delta material → recalibrate on the recorded audio, then flip.
3. Recording never happens → the flag stays off, and the product is Phases 1-3. Say so plainly in
   the record rather than implying coverage that does not exist.

**Tap rate is the second input, and it can veto on its own.** Phase 3 exists to supply it. A
sustained rate below ~50% means confirmed turns are too rare to seed centroids, so suggestions would
be built on almost nothing — and turning them on then makes the failure worse rather than better,
because a bad suggestion still costs a correction. Good thresholds do not rescue a starved centroid.

## Related Code Files

- Modify: `plans/260824-1900-speaker-attribution-benchmark-gate/phase-07-browser-dsp-channel-delta.md` — record the run
- Create: `plans/reports/bench-{date}-browser-channel-delta.md`
- Modify: `benchmarks/speaker-id/run_session.py` — recalibrate on the recorded fixture, if needed
- Modify: `apps/api/src/config/env.schema.ts` — the flag's default
- Modify: `packages/realtime-client/src/state/speaker-centroids.ts` — the threshold constants
- Read (do not modify): `benchmarks/speaker-id/run_channel_delta.py`, `recorder/index.html`

## Implementation Steps

1. Run the recording session: 3+ people, the laptop that runs the product, 0.5m and 2m, 10-15 min.
   `node benchmarks/speaker-id/recorder/serve.mjs`, then move the three downloaded files into
   `benchmarks/speaker-id/fixtures/`.
2. Confirm the control track is genuinely raw using the page's loud-then-quiet check. If the AGC
   envelopes match, the platform did not hand over a raw track — take the unpaired fallback and
   record that it was taken.
3. `uv run --directory benchmarks/speaker-id python run_channel_delta.py --session s1`.
4. If the 2s delta exceeds ~5 points, re-run the session calibration on the recorded audio and take
   the new thresholds from it.
5. Read the tap rate from real sessions — sessions driven by people who did not build the feature.
6. Decide, and write the decision down with both numbers in it.
7. If flipping: measure end-to-end turn latency on the prod container with the flag on, and record
   it. **This is the acceptance item the benchmark gate deferred rather than met; this is where it
   is finally owed.**

## Success Criteria

- [ ] Channel delta measured per duration bucket, or recorded as UNMEASURED with the reason
- [ ] Every shipped threshold names its channel
- [ ] Tap rate from at least one session not driven by the author
- [ ] The flag's state is a written decision, whichever way it went
- [ ] If on: end-to-end latency measured on the prod container, with the number recorded
- [ ] If on: a session with 3+ people shows **confirmed-matching** suggestions outnumbering
      **corrected** ones, with **unreviewed** reported beside them and not folded into either

## Risk Assessment

- **Nobody is ever available.** The most likely outcome, and it has been the pattern throughout this
  work. Signal: no session scheduled. Response: leave the flag off and record the channel delta as
  UNMEASURED. Phases 1-3 are a complete feature; this is a smaller loss than it looks.
- **The delta is measured on one room and treated as general.** Signal: the number is quoted without
  its conditions. Response: quote it with the room, the microphone and the session length attached,
  every time. It bounds the effect; it does not retire it.
- **The flag gets flipped because the work is finished rather than because the evidence says so.**
  The strongest pull in this phase — five phases of built machinery arguing for their own use.
  Signal: the decision cites effort spent rather than a delta and a tap rate. Response: both numbers
  go in the record before the decision, and a decision that cites neither is not one.
- **Recalibration overfits to one session.** A fixture with one room and few speakers can be tuned
  to look excellent and generalise to nothing. Signal: recalibrated thresholds beat the corpus ones
  by a wide margin on the same fixture they were derived from. Response: that is the expected shape
  of overfitting, not a result. Prefer the corpus thresholds unless the channel delta specifically
  explains the gap.
- **The evidence certifies itself.** "Suggestions accepted more often than corrected" is satisfied
  by nobody looking at the screen, which is this plan's own premise for why suggestions are
  dangerous — so the metric would pass in exactly the case it exists to catch. Signal: a decision
  citing an accepted-vs-corrected ratio without an unreviewed count beside it. Response: read the
  three buckets Phase 3 produces. A high unreviewed count is not a pass; it is no evidence at all,
  and the flag stays off until there is some.
- **Turning it on makes the product worse.** Suggestions add a thing to check where before there was
  a thing to fill in. Signal: corrections outnumber confirmed-matching suggestions in a real session.
  Response: turn it off again. The floor is Phase 2, and returning to it costs one env value.
