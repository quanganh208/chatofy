---
phase: 2
title: 'Channel delta gate'
status: pending
priority: P1
effort: '2d + one recording session'
dependencies: [1, 7]
---

# Phase 2: Channel delta gate

## Promoted twice — 2026-09-01

This phase began as a channel check. It is now **the decisive experiment of the
plan**, for two independent reasons recorded on the dates they were established.

**First promotion — the acoustic layer carries the whole load.** The user chose
to defer per-turn language ID and keep the session one-directional for now
(D10). With no language prior, nothing else supplies speaker evidence. And the
acoustic layer's measured number differs by **20 points** between the two cells
that bracket the real channel: campplus, N=2, cold, 1.0s, `k_max=2 assign`,
prefix-locked reads **0.785 clean** (0.759 / 0.833 / 0.762) and **0.589
far-field** (0.569 / 0.627 / 0.570). Where the real channel falls inside that
spread decides whether the current slice can reach the bar at all.

**Second promotion — the only REAL shared microphone.** ~~A same-microphone
imposter pair does not exist in the corpus and cannot be constructed.~~
**CORRECTED (plan C2): that was false.** `build_embedding_cache.py:151-152`
applies one `RoomConfig()` and one RIR to every clip, so the far-field arm is
already a shared-channel condition and P7-M12 can build a synthetic same-channel
imposter set today.

What survives, and it is still enough to promote this phase: that channel is
**synthetic**. Two people, one **real** microphone, one room, one session, through
real browser NS/AGC/echo-cancel and the real 48→16k path is the product's actual
discrimination task, and this recording is the only place it is ever measured.

**And the correction cuts the other way too.** The far-field duration slope
(27.67 → 22.67) was the plan's evidence that the flat clean curve was not an
instrument artifact. A shared RIR inflates non-target cosines, so that slope is
confounded. P7-M11 is now the primary instrument check, which is a further reason
this phase waits for it.

**Consequence for scheduling:** `dependencies: [1, 7]`. Phase 7's M11 decides
whether the instrument this session would be designed against is sound. Running
the session first risks spending the one-shot fixture on a protocol calibrated to
a broken measurement.

**Unchanged:** everything below. This phase measures a microphone, not an
algorithm, and survives every premise change so far.

## Protocol additions — 2026-09-01, CORRECTED after red team

**None of the four additions below was runnable as first written.** They were
bolted onto a phase whose own rule is that everything about the protocol must be
settled before anyone is in the room, and they had no implementation step, no
Related Code File and no success criterion. The harness rejects two of them
outright. Each now carries what it actually needs.

**Blocking harness work — must land before the session:**

| Addition                       | What blocks it                                                                                                                                                                                                 | Required change                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Raw 48kHz track                | `channel.py:26` `SAMPLE_RATE = 16_000`; `run_channel_delta.py:72-73` and `channel.py:78-79` **raise** on any other rate. The recorder stamps `sampleRate: TARGET_RATE` = 16000 (`recorder/index.html:140,459`) | Parameterise the load path by sample rate, or record the raw track as a side artifact the harness never loads |
| Per-turn language label        | `channel.py:39-47` — frozen `Turn` is `turn_index, speaker_id, distance, start_ms, end_ms`. **No language field**                                                                                              | Add `language` to `Turn` and to the recorder's turn log                                                       |
| Near/far position + AGC on/off | No arm exists; nothing pairs a DSP-on and DSP-off take                                                                                                                                                         | Add the paired-take protocol and a `distance` value that is actually populated                                |
| Three-person stretch           | Nothing blocks it                                                                                                                                                                                              | Add a success criterion so it is not silently dropped                                                         |

**Retention — the raw track changes the calculus.** Its stated purpose was
"future DSP variants decided offline", which is open-ended retention of the
highest-fidelity biometric in the session, belonging to a counterpart who cannot
consent. That purpose is **incompatible** with this phase's destruction date.
Either the raw track carries the same date as the processed one, or it is not
recorded. It is not exempt because it is "just a control".

**Bucket correction.** This phase's own superseded note says adding a 5.0 bucket
raises `KeyError` on the unguarded `CORPUS_FAR_FIELD_EER` read
(`run_channel_delta.py:151,158`) — and `DURATION_BUCKETS_S = (1.0, 2.0, 3.0)`
already contains what M1 needs. **The Implementation Steps and Related Code Files
below still instruct adding it; that instruction is void.** A delegate who
follows it spends the one-shot fixture and then crashes in analysis.

---

Settled before anyone is in the room, per this phase's own one-shot rule.

- **Record raw 48kHz alongside the DSP-processed chain.** Duration buckets
  (1.0s / 2.0s / full) and any future DSP variant are then decided offline
  instead of requiring a second session. The raw track is also the control the
  DSP delta is measured against.
- **Record near/far speaker position explicitly** — who holds the device, who is
  across the table, and the approximate distance. The synthetic far-field
  condition applies one 2m channel to _both_ talkers, which erases the proximity
  asymmetry the real product has. This session is the only chance to measure
  whether that cue survives `autoGainControl`, which exists precisely to remove
  it. Record with AGC on and off.
- **Label the language of every turn.** Costs nothing during transcription and
  measures the cross-language fraction that Decision D9's arithmetic depends on
  — the number that decides whether the deferred LID path (D10) can ever clear
  the bar. M1 carries durations only and cannot answer it.
- **Include at least one three-person stretch.** D5's above-cap behaviour and the
  N=3 tension recorded in D8 are otherwise untestable on real audio.

## Overview

Measure the one thing nobody has measured: what the browser's DSP chain does to
a speaker embedding, and what the production 48→16k per-block downsample does on
top. This is the codebase's own stated reason the feature ships off.

**The session is one-shot** — by the harness's rule, if the gate kills the
feature nobody is recorded a second time. Everything that could be wrong about
the protocol must be settled before anyone is in the room.

**Unchanged by the premise reversal.** This phase measures a microphone, not an
algorithm, so every requirement below holds whether the product seeds a named
roster or mints anonymous ordinals. Two things it now gates differently: the
verdict applies to the auto-attribution thresholds P1 selects rather than to
`TAU_SUGGEST`, and it matters _more_, because a zero-manual product has no human
correction loop to absorb channel-induced errors.

**The duration buckets follow P1-M1.** If the measured real turn duration differs
from 2.0s, this session's buckets track the measured value — recording at a
duration the product does not produce would repeat P1's own mistake at ten times
the cost.

## Requirements

**Functional**

- Record 3-5 real speakers (prefer 5) through production `getUserMedia`
  constraints, DSP-on and DSP-off paired against one turn log.
- ≥40 turns per speaker, **each at least as long as the longest bucket** (buckets
  are analysis-side truncations of the same turns, not separate takes), with
  ≥700ms trailing silence so
  `require_terminated()` does not silently drop turns.
- Report Δ EER, Δ top-1, and target-mean cosine loss, per bucket, with per-turn
  CSV and cosine histograms — **three of which the harness does not currently
  emit** (see Architecture).
- Report Δ as a **leave-one-speaker-out spread**, and gate on the worst
  leave-one-out value, not the pooled one.
- Produce a **verdict**. Not an offset — see below.

**Non-functional**

- Consent recorded per participant **before** capture.
- Retention decision with a date, made **before** capture, covering `fixtures/`,
  the browser download directory **and git history** — the turn logs are tracked
  (`.gitignore:18-22` re-includes `fixtures/**/*.json`) and cannot be retracted
  after a push.
- The turn log is stripped of device and wall-clock identifiers before capture.
- `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest` with its exit code recorded.

## Architecture

### The session invalidates; it does not adjust (`red-team #2`)

An earlier draft of this plan specified "apply Δ as an offset to the Phase 1
corpus thresholds". **That is withdrawn.** The harness author rules it out in
the file that would do the measuring:

- `run_channel_delta.py:14-19` — _"**Read the delta, not the absolute.** One
  session means one room, one microphone and same-speaker pairs that share both
  … this fixture's absolute EER is optimistic and not comparable to Checkpoint
  1's 23.0%."_
- `run_channel_delta.py:52-56` — corpus far-field numbers are _"**NOT a baseline
  to subtract from** — different corpus, different pairing rules, different
  room."_

The statistical objection is concrete: on a fixture where separation is easy,
Δ sits near a floor. Adding a floor-effect delta to a threshold set whose
operating point is 23.1% mixes two incommensurable scales and would flip the
flag on evidence that never addressed the failure regime.

**So P2's output is a verdict:** the channel either leaves the corpus
calibration usable, or it does not.

### The band, and the constant that already contradicts it (`red-team #2`)

The script hardcodes `MATERIAL_DELTA = 0.05` (`:64`) with its own written
rationale, and prints a binary verdict against it. This plan's band is:

| Δ EER (worst leave-one-out) | Verdict                                                 |
| --------------------------- | ------------------------------------------------------- |
| ≤ +3.0 points               | PASS — corpus calibration stands                        |
| +3.0 to +6.0                | PROCEED, bars widen, Phase 6 is the sole ship authority |
| > +6.0 points               | STOP the delivery                                       |

These disagree. Step 1 reconciles them **in the script**, so the artifact and the
plan cannot say different things six weeks later.

### The exit contract (`red-team #6`)

`run_channel_delta.py` documents itself as _"Diagnostic, never a gate. It always
exits 0"_ and returns 0 at `:123`, `:164`, `:197` — including on an absent
fixture, which it treats as UNMEASURED. A mis-pathed session therefore produces
a clean exit and an empty report that reads as "no delta detected". Phase 2
calls itself a hard gate; the script must be changed to match or the phase must
stop claiming it.

### Three outputs the harness does not produce (`red-team #15`)

`run_channel_delta.py:146-155` emits nine aggregate columns per model × bucket:
`processed_eer, control_eer, delta, corpus_far_field_eer, target_pairs,
nontarget_pairs, speakers` and friends. There is **no** Δ top-1, **no**
target-mean cosine, and **no** per-turn row. Two success criteria depend on the
first two. Add them before the session, not after.

**Superseded — bucket alignment.** An earlier draft here said _"Phase 1 measures
`(2.0, 5.0)`, there is no 5s bucket, add 5.0, and require ≥40 turns per speaker
per bucket."_ All three clauses are now wrong. Phase 1 runs at the **single**
`TURN_S` that M1 selects, so no cell needs 5s; adding a 5.0 bucket raises
`KeyError` on the unguarded `CORPUS_FAR_FIELD_EER` read; and buckets are
analysis-side truncations of the same turns, not separate recordings. The correct
statement is the section above: **align `DURATION_BUCKETS_S` and the gate bucket
to M1's measured duration, add the matching corpus keys, and record ≥40 turns per
speaker each at least as long as the longest bucket.**

### The recorder is mostly already built (`red-team #15`)

Contrary to an earlier draft, `recorder/index.html` already has
`PRODUCTION_CONSTRAINTS` including `echoCancellation: true` (`:126-129`),
`CONTROL_CONSTRAINTS` (`:134-137`), and dual-track paired capture (`:296-297`).
What it does **not** have:

- an assertion covering anything but `noiseSuppression` — the `wrong` guard at
  `:333-334` checks that one field; `echoCancellation`, `autoGainControl` and
  the sample rate are rendered for a human to read, not asserted;
- any sample-rate pin. `state.context = new AudioContext()` (`:292` — an earlier
  draft of this plan cited `:328`, which is a table cell rendering
  `noiseSuppression`) takes the
  OS default, and so does production (`use-streaming-translate.ts:205`). **The
  48→16k path this plan asserts as fact may never run on either side.**

And "make the recorder _import_ `open-microphone.ts`" is not achievable as
written: `serve.mjs` is a 74-line static file server with two roots and no
bundler, so a TypeScript import is unavailable. Achievable alternatives: emit a
generated `constraints.js` at recorder start-up, or add a Vitest in `apps/web`
asserting the recorder's literal block equals `CONVERSATION_AUDIO`.

Note the recorder's own comment cites `use-streaming-translate.ts` as the source
of the copy; the constraints actually live at `open-microphone.ts:57-61`. That
drift has already happened once.

### The turn log carries device fingerprints, and it is committed (`red-team round 2`)

The retention criterion below names two locations — `fixtures/` and the browser
download directory. **There is a third, and it cannot be retracted.**

`recorder/index.html:466-468` serializes `settingsReported` straight from
`MediaStreamTrack.getSettings()` (`:187`), unfiltered. On Chromium that object
includes `deviceId` and `groupId` — per-origin-stable hardware identifiers for the
participant's machine — alongside a full ISO `recordedAt` (`:461`) and the
free-text `sessionId` (`:458`).

And `benchmarks/speaker-id/.gitignore:18-22` excludes `fixtures/**` then
**re-includes `!fixtures/**/*.json`**, deliberately, so those turn logs are
**tracked and committed**. `git rm` does not remove them from history, and once
pushed they are on GitHub.

The failure is not hypothetical harm — it is a **false record**: five people
consent on the understanding that the recording is destroyed on a stated date, the
audio is destroyed, the retention step is logged as complete, and each
participant's device id, capture time and session label remain in the repository.

Three consequences, all blocking:

1. Whitelist the four fields actually needed (`echoCancellation`,
   `noiseSuppression`, `autoGainControl`, `sampleRate`) out of `getSettings()`
   before serialization. Everything else is dropped.
2. `sessionId` is a pseudonym, and `recordedAt` is coarsened or removed.
3. **Git history is a named location in the retention decision**, with an explicit
   "cannot be retracted after push" acknowledgement recorded _before_ capture.

### The 5s bucket crashes, and the verdict is hardcoded to 2.0s (`red-team round 2`)

Three defects that all land _after_ the one-shot session:

- `CORPUS_FAR_FIELD_EER` (`run_channel_delta.py:55-58`) is keyed `{1.0, 2.0, 3.0}`
  and read **unguarded** at `:151` and `:158`. Adding a 5.0 bucket raises
  `KeyError` mid-analysis, on a session that cannot be repeated.
- The verdict selects `bucket_s == 2.0` (`:173-176`) with a silent fallback to the
  worst bucket overall. So if M1 moves `TURN_S` off 2.0 — which is the whole point
  of M1 — the gate is computed on a bucket nobody chose, most likely the harshest.
- "≥40 turns per speaker **per duration bucket**" and "clip length is a recording
  decision, not an analysis one" are both wrong: buckets are analysis-side
  truncations of the _same_ turns, filtered by `eligible_turns(turns, bucket_s)`
  (`channel.py:133-135`). The recording requirement is "≥40 turns per speaker,
  each at least as long as the longest bucket."

Fix all three before the session, and add the 5.0 corpus keys — or drop the 5s
bucket, since no Phase 1 cell measures 5s any more (Phase 1 runs at the single
`TURN_S` M1 selects).

### Power, honestly (`red-team #15`)

"3 × 40 turns gives ~2,340 same-speaker and ~4,800 cross pairs" is correct
arithmetic and the wrong statistic. Pairs drawn from 3 speakers are not 2,340
independent observations — the effective sample is 3 voices, and every
same-speaker pair additionally shares room and microphone. The harness README
warns about exactly this ("an EER describing three voices rather than a
language"). Two mechanical caveats too: `channel.py:144-166` applies
`min_turn_gap` to targets only, so the real target count is lower, and it
returns all non-target pairs despite promising a matched count.

## Related Code Files

- Modify: `benchmarks/speaker-id/run_channel_delta.py` — the 3/6 band replacing
  `MATERIAL_DELTA`, non-zero exit on STOP and on absent fixtures, Δ top-1 and
  target-mean cosine columns, per-turn CSV, leave-one-speaker-out reporting
- ~~Modify: `benchmarks/speaker-id/speaker_bench/trials.py:27` — add the 5.0 bucket~~ **VOID.** No edit needed: `DURATION_BUCKETS_S = (1.0, 2.0, 3.0)` already covers M1's 1.0s
- Modify: `benchmarks/speaker-id/speaker_bench/channel.py:144-166` — fix or
  document the unmatched non-target count
- Modify: `benchmarks/speaker-id/recorder/index.html` — extend the `wrong` guard
  to `echoCancellation`, `autoGainControl` and `context.sampleRate`; abort on
  mismatch
- Create: an `apps/web` spec asserting the recorder's constraint literal equals
  `CONVERSATION_AUDIO` (`open-microphone.ts:57-61`)
- Create: `benchmarks/speaker-id/results/channel-delta.csv` (already the script
  default), plus the consent/retention record under `plans/reports/`
- Decide: whether production pins `new AudioContext({ sampleRate: 48000 })`

## Implementation Steps

1. **Write down the method and the verdict rule before anything else**: verdict
   not offset, the 3/6 band, and the leave-one-out gating. Reconcile
   `MATERIAL_DELTA` and the exit contract in the script in the same change.
2. Add the missing outputs: Δ top-1, target-mean cosine, per-turn CSV, the 5s
   bucket.
3. Extend the recorder's guard to all three DSP fields and the sample rate; add
   the `apps/web` constraint-parity spec. Decide the 48 kHz question and record
   the answer.
4. **Consent and retention**: record consent per participant; write the
   retention decision with a date, naming both `fixtures/` and the browser
   download directory.
5. Dry-run solo through the **full reporting path**, so a missing column is
   found while people are still available. A solo run measures channel
   distortion only, never separation.
6. Run the session: 3-5 speakers, ≥40 turns each per bucket, far-field placement
   matching the product's premise.
7. Run `run_channel_delta.py`. Report per bucket with histograms and the
   leave-one-speaker-out spread.
8. Apply the verdict. Resolve Phase 1's UNDETERMINED cells as
   still-usable / not-usable — **never by arithmetic adjustment**.
9. Execute the retention decision (destroy or archive per policy, both
   locations) and log it.
10. Write the gate verdict into `plans/reports/`.

## Success Criteria

- [ ] Method, verdict rule, `MATERIAL_DELTA` reconciliation and exit contract
      landed in the script **before** the session
- [ ] Consent recorded per participant before capture
- [ ] Retention decision with a date, made before capture, covering `fixtures/`,
      the browser download directory **and git history**, the last with an
      explicit "cannot be retracted after push" acknowledgement
- [ ] The turn log contains **no device or wall-clock identifier**: `getSettings()`
      is whitelisted to the three DSP booleans plus `sampleRate`, `sessionId` is a
      pseudonym, `recordedAt` coarsened or removed — asserted before capture
- [ ] The gate bucket is a parameter set from M1, not hardcoded to 2.0; corpus
      keys exist for every bucket run, or the extra bucket is dropped
- [ ] Δ top-1, target-mean cosine loss and per-turn CSV produced by the harness;
      `DURATION_BUCKETS_S` aligned to M1's measured duration with matching corpus
      keys (no unguarded `CORPUS_FAR_FIELD_EER` read)
- [ ] Recorder asserts `echoCancellation`, `noiseSuppression`, `autoGainControl`
      and sample rate, and aborts on mismatch
- [ ] `apps/web` spec pins the recorder's constraints to `CONVERSATION_AUDIO`
- [ ] ≥3 speakers (target 5) × ≥40 turns per bucket, DSP-on/DSP-off paired
- [ ] Δ reported as a leave-one-speaker-out spread; the gate reads the worst
- [ ] Worst-case Δ EER ≤ +3.0 → PASS; +3.0..+6.0 → proceed with widened bars and
      Phase 6 as sole ship authority; > +6.0 → STOP
- [ ] Target-mean cosine loss ≤ 0.05
- [ ] Phase 1 cells resolved as usable / not-usable — **no threshold arithmetic**
- [ ] Retention decision executed and logged
- [ ] `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest` exit code recorded

## Risk Assessment

**Δ > +6 points — the feature dies here.** Pre-decided: stop. The feature stays
off and the manual chip remains the only attribution. A valid documented
outcome, not a retry trigger.

**Someone converts the verdict into an offset anyway.** _Signal:_ a report adds
Δ to a corpus threshold. _Response:_ forbidden by the section above and by the
harness's own comment. The session's absolute EER is floor-effected and not
comparable to the 23% operating point.

**Recording a channel the product does not use.** _Signal:_ a constraint changes
in `open-microphone.ts` and nothing fails. _Response:_ the `apps/web` parity
spec in step 3. The drift has already occurred once — the recorder's comment
still names the wrong source file.

**Consent and retention.** Real voices, recorded, beside a shipped promise that
nothing is stored. The recorder saves through `<a download>` (`index.html:237-241`),
so copies land in the browser's download directory and are then hand-copied to
`fixtures/`; `.gitignore` excludes the audio but **re-includes
`fixtures/**/*.json`**, so turn logs are committed and their free-text
`sessionId` should be a pseudonym. _Response:_ steps 4 and 9 are blocking
criteria, not follow-ups.

**Only 3 speakers available.** _Response:_ run it, gate on the worst
leave-one-out delta, attach the thin-diversity caveat to every number, and do
not tune to the second decimal.
