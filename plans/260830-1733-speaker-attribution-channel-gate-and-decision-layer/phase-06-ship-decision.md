---
phase: 6
title: 'Ship decision'
status: pending
priority: P1
effort: 'ongoing — spans real sessions'
dependencies: [4]
---

# Phase 6: Ship decision

## Pre-registered fork rule — written 2026-09-01, before P2's numbers exist

The option screen left exactly two moves if the current slice misses the bar:
**per-turn language ID** or **fine-tuning on Vietnamese data**. Everything else
was measured closed, priced out, or found to be the wrong mechanism.

Writing the rule now is what stops it being relitigated under deadline pressure
once numbers exist and one of the two has a sunk cost attached.

**Keyed on Δ EER, corrected 2026-09-01.** An earlier draft keyed row 1 on
"settled-label accuracy on the real channel", which **no phase produces** — P2
emits Δ EER, Δ top-1, target-mean cosine loss and per-turn CSV, and P7-M13 scores
the _corpus_, not the real channel. That row was unevaluable and its bands left
`[0.80, 0.85)` unmapped, which is exactly where the measured values sit (clean
prefix-locked 0.785, clean Hungarian ceiling 0.879). Both defects are fixed here.

| P7 + P2 outcome                                                                                   | Fork                                | Why                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P7-M11 says the instrument is suspect**                                                         | **Neither fork. Repair the bench.** | Every number feeding this table is void, including P1's FAIL. This row is evaluated first                                                                                      |
| P2 Δ EER small (real channel ~ **clean**) **and** P7-M13 settled-label **>= 0.85 over all turns** | **Ship.** Neither fork opens        | The slice succeeded on CPU at $0. Note the bar is the absolute D6 bar over **all** turns, not a delta                                                                          |
| P2 Δ EER small **and** M13 in **[0.70, 0.85)**                                                    | **Fine-tune leads.** LID parked     | Channel is not the problem, so the acoustic axis is the lever, and fine-tune is the only option with a published path under the 15% EER KILL line. **The whole band, no hole** |
| P2 Δ EER large (real channel ~ **far-field** or worse)                                            | **LID leads.** Fine-tune parked     | Fine-tuning on clean VieSpeaker cannot repair a channel it never saw. LID is orthogonal to channel damage                                                                      |
| M13 **< 0.70** on any channel                                                                     | **Both, or stop**                   | Neither lever alone closes a 15-point gap. Escalate as a scope decision with the ladder below                                                                                  |

**Two gates stand before this table is even reached**, both from the red team:
P4 Step 0 has no input (D5 as re-derived — M9's `abstain` and `raise_tau` arms are
`NO-CONFIG` on every split, and P4's own stop rule has already fired), and P3 was
never amended for D8. Neither is a P6 decision, but P6 cannot run before both
resolve.

**The user has already accepted the LID branch in principle** (D10) and chose to
sequence it after this measurement, not before. Fine-tune is parked, not deleted
(D11). Neither fork may be opened before P7 and P2 have both reported.

**Cross-language fraction — D9 downgraded 2026-09-01.** The "~85% break-even"
had **no derivation anywhere in this plan**, so it cannot gate the LID branch.
P2 still labels the language of every turn (cheap, and M1 cannot answer it), but
**no fork may be decided on 85%** until D9 is re-derived with its model stated.
See Open questions in `plan.md`.

## Overview

Decide whether `SPEAKER_EMBEDDING_ENABLED` flips to true by default, using
evidence from real sessions rather than corpus cells.

**The inherited gate is void and must be replaced, not relaxed.** It gated on
`confirmedMatching : corrected ≥ 4:1` and `tap rate ≥ TAP_RATE_FLOOR` (0.5,
`attribution-stats.ts:36`). Both terms count taps. **A zero-manual product has a
tap rate of ≈0 by design**, so both are undefined at a zero denominator. Red-team
finding 14 flagged this as a hypothetical; the premise reversal makes it certain.

## Requirements

**Functional**

- Observe ≥10 real sessions with the feature enabled in a non-production stack
  before any flag change.
- Gate on the four replacement signals below. Each is readable by a human running
  a session; none requires analytics.
- A failed gate leaves the feature off. That is a documented outcome, not a retry
  trigger.
- Answer the 0→100% flip question explicitly (plan Constraint 9): build a ramp,
  or record the all-at-once flip as an accepted decision.

**Non-functional**

- No analytics added. See below.

## Architecture

### The replacement signals

| #   | Signal                                                                                                  | Bar                                                                    | How it is read                                            |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| S1  | **Count accuracy** — chips shown vs. the true number of people, written down by the session operator    | mean `\|dN\|` ≤ 0.25; no session over by ≥2                            | Human counts the people, counts the chips                 |
| S2  | **Correction rate** — machine ordinals the user corrected, over ordinals the user actually **reviewed** | ≤ 20%, and **UNMEASURED below a minimum reviewed count** — see below   | Derived from state, with an explicit reviewed denominator |
| S3  | **Post-settle churn** — ordinal changes the user sees _after_ a turn has been on screen ≥5s             | reported; > ~1 per 10 turns ⇒ settle demotes to end-of-session cadence | Counted during the session                                |
| S4  | **Unresolved rate** — turns still pending at session end (was "abstention rate", **retired by D8**)     | **must be 0** — a non-zero value is a contract violation, not a metric | Derived from state                                        |
| S4b | **Time-to-resolve** — how long a turn stays pending before its ordinal lands                            | reported; a long tail is the real cost D8 traded abstention for        | Derived from state                                        |
| S5  | **Misattribution rate** — turns labelled with the wrong person, from the operator's own notes           | reported with a bar set from P1-M9                                     | Human, same pass as S1                                    |

**S2 nearly reproduced the defect that voided `TAP_RATE_FLOOR`** (`red-team round
2`). Three problems in the first draft: it counted renames, and P4 removes the
only rename UI; it counted "merges", which are a machine operation the settle pass
performs, not a user action; and `outcomesFor` skips any attribution without
`suggestedSpeakerId` (`attribution-stats.ts:76-77`), so with the auto-attributor
writing plain ordinals the ratio is literally `0/0`. A gate that reads 0% because
the correction surface was removed is the same self-certifying failure in a new
costume — and `attribution-stats.ts:38-55` already names it: _"if accepted just
means not corrected, then a session where nobody looked at the screen scores
perfectly."_

So S2 carries an explicit **reviewed** denominator, mirroring the module's own
three-bucket design, and reads **UNMEASURED — not PASS** below the minimum. P4
must also state whether the attributor writes `suggestedSpeakerId` at all;
without it S2 is undefined regardless of the denominator.

**S5 is new**, because S1 cannot see the failure that matters most. Above `K_max`
the product misattributes rather than abstaining (P4 Mechanism), and
misattribution leaves the chip **count** correct — S1 reads it as a pass. Only a
human comparing labels against who actually spoke catches it.

S1 is still the metric the whole plan turns on, and the one no oracle flatters
(plan-level "The Hungarian remap"). ~~S4 has no bar deliberately: abstention is a
_designed_ outcome, and a ceiling on it would push the product back toward
inventing people.~~ **SUPERSEDED by D8.** Abstention is no longer a designed
outcome, so S4 is a contract check ("must be 0"), not a metric. The concern the
struck sentence raises does not vanish — it moves to **S5**, which is now the
bar that stops the product inventing people.

**Caveat that must travel with S1:** it counts chips, and `display-groups.ts`
renders one chip per merged block. If P4's split-rule fix does not ship, S1
measures the grouping rule rather than the attributor.

### This gate is read by a human, not by a pipeline

`attribution-stats.ts` is explicit: _"Nothing leaves the browser. There is no
analytics in this repo and adding one to observe a feature about who spoke would
ship exactly the data this design keeps in memory."_ Stats are **derived, never
accumulated**.

So this is not automated telemetry. Whoever runs a session reads the numbers and
writes them down. The plan states this plainly rather than describing a gate that
sounds automatic and is not. Adding analytics to satisfy it would ship the data
the privacy contract exists to keep in the tab — a **non-goal**, not an
unimplemented step.

**S1 in particular requires a human to record ground truth.** Nobody else knows
how many people were in the room. That is a real cost, and it is the price of the
no-analytics contract.

### `attributionStats` needs rework, not reuse

`attribution-stats.ts:76-88` scores by comparing final `speakerId` against
`suggestedSpeakerId` — a comparison built for a product where a human confirms.
Under auto-attribution the useful comparison is machine-ordinal vs. user
correction (S2), and the count comparison (S1) has no in-state ground truth at
all. Rework the module or replace it; do not quietly reinterpret its existing
fields.

### Flip mechanics

Two switches, both required (existing behaviour, unchanged):

- Server: `SPEAKER_EMBEDDING_ENABLED` (`apps/api/src/config/env.schema.ts:165`,
  `prod.env.example:190`)
- Client: `embedSpeaker` on `client.session.start`
  (`apps/web/src/components/translate/cascade-panel.tsx:128`, already sent
  unconditionally)

The per-client opt-in stays regardless of the flag, because `apps/api` and
`apps/web` do not deploy atomically.

## Related Code Files

- Modify: `packages/realtime-client/src/state/attribution-stats.ts` — rework for
  the auto-attribution signals; `TAP_RATE_FLOOR` (`:36`) deleted or repurposed;
  `AttributionStats.tapRate` (`:63-64`) is part of a barrel-exported type
- Modify: `packages/realtime-client/src/index.ts:110-111` — `TAP_RATE_FLOOR` and
  `AttributionStats` are **barrel re-exports**; removing or reshaping either is
  the public-contract change this phase claims to record
- Modify: `packages/realtime-client/src/state/attribution-stats.spec.ts:9,107` —
  pins `expect(TAP_RATE_FLOOR).toBe(0.5)`
- Modify: `apps/web/src/components/translate/cascade-panel.tsx:194-211` — the
  **shipped** stats readout. Under zero-manual `confirmed` is 0 by design, so
  `fallback = totalTurns` (`attribution-stats.ts:98-107`) and a _successful_
  20-turn session would render "20 lượt · 0 đã đánh dấu · 20 chưa đánh dấu" —
  the product reporting total failure on a session that worked.
  **RESOLVED — validation V6: delete the readout and its two i18n keys.** It was
  written for a product with taps; under zero-manual its central number is 0 by
  design. P6 reads S1-S5 from state and from the operator's notes, not from this
  panel. <!-- Updated: Validation Session 1 - V6 -->
- Modify: `packages/i18n/src/vi.ts:186-189`, `en.ts:199-201` — the readout's copy
- Modify: `prod.env.example` (flag default, only on a pass)
- Modify: `~/.config/chatofy/prod.env` on the production host (outside the repo,
  mode 600 — not a repo change)
- Modify: `docs/system-architecture.md` — the "Off by default" paragraph and its
  stated reason become false on a pass and must be rewritten with the new evidence

## Implementation Steps

1. Rework `attribution-stats.ts` for S1-S4; remove or repurpose `TAP_RATE_FLOOR`
   and record the removal as a public-contract change.
2. Run ≥10 real sessions with the feature enabled locally, recording the true
   speaker count per session by hand.
3. Aggregate into a report under `plans/reports/`. State the sample size and that
   it is hand-collected.
4. Apply the gate. On a pass, decide the ramp question, then flip the server flag
   and update `prod.env.example`.
5. Rewrite `docs/system-architecture.md`'s "Off by default" section: the flag's
   stated reason was channel calibration, which P2 resolved. Record the new
   thresholds, the channel they were calibrated on, `K_max`, and the session
   evidence.
6. On a fail, record why and leave the flag off.
7. Settle the enrolment path. `speaker-centroids.ts` (`buildCentroids`,
   `suggestSpeaker`, `TAU_SUGGEST`) has had no caller since `auto-attribution.ts`
   replaced it in the reducer; it is still exported from
   `packages/realtime-client/src/index.ts`, which is where its retention is
   recorded and where this step is pointed from.
   - **Ship** → delete it, its spec, and its exports. The replacement is proven,
     so the baseline it exists to be compared against has no remaining reader.
   - **Stop** (`M13 < 0.70` on any channel, escalated and answered "stop") →
     delete it with the rest of the acoustic layer.
   - **A fork opens** (LID or fine-tune) → keep it, and say so in the fork's
     report. A fork reopens the enrolment-versus-online comparison, and this is
     the only implementation of one side of it.

   Removal is a public-contract change on a package entry point, so it is
   recorded the same way `TAP_RATE_FLOOR`'s is in step 1 rather than folded into
   the flip.

## Success Criteria

- [ ] `TAP_RATE_FLOOR` gate removed; its replacement recorded as a
      public-contract change
- [ ] ≥10 real sessions observed, sample size stated
- [ ] S1 mean `|dN|` ≤ 0.25, no session over by ≥2 — **and P4's display-group
      split fix shipped**, else S1 measures the grouping rule, not the attributor
- [ ] S2 has an explicit **reviewed** denominator and reads **UNMEASURED** below
      the minimum reviewed count; whether the attributor writes
      `suggestedSpeakerId` is stated
- [ ] A correction surface exists during the observation window — rename on the
      chip (V2) — else S2 is structurally 0/0 and must be reported as UNMEASURED,
      never PASS
- [ ] The `cascade-panel` stats readout and its two i18n keys are removed (V6)
- [ ] S3 churn reported; settle cadence set from it
- [ ] S4 **unresolved rate is 0** — zero rows pending at the end of a cleanly
      stopped session; S4b time-to-resolve reported
- [ ] S5 misattribution carries a **hard bar**, not just a report — D8 traded a
      visible failure for an invisible one, so the invisible one needs a ceiling
- [ ] S5 misattribution rate reported against the bar P1-M9 sets
- [ ] The 0→100% flip answered: a ramp exists, or the all-at-once flip is a
      written accepted decision
- [ ] No analytics added to the repo
- [ ] On a pass: flag flipped, `prod.env.example` updated,
      `docs/system-architecture.md` rewritten with the real calibration channel
      and `K_max`
- [ ] On a fail: reason recorded, flag stays off, no retry loop opened
- [ ] The enrolment path is deleted or its retention is written into the open
      fork's report — not left exported with no caller and no stated reason

## Risk Assessment

**The gate looks automated and is not.** _Signal:_ someone proposes adding
analytics to collect it. _Response:_ explicit non-goal above — that ships the data
the design keeps in the tab. Hand-collection with a stated sample size is the
honest form.

**Nobody records ground truth for S1.** It is the one signal that cannot be
derived from state, and it needs a person to count heads. _Signal:_ ten sessions
of chip counts with no true counts beside them. _Response:_ S1 without ground
truth is not a weaker gate, it is **no gate** — the run does not count.

**10 sessions is a thin, self-selected sample** — likely the maintainer and
colleagues, not the target user. _Response:_ state it in the report. This gate is
a floor, not a proof.

**The flip is 0→100% for every session at once.** `cascade-panel.tsx:128` already
sends `embedSpeaker: true` unconditionally, so the server flag is the only switch
and there is no staged rollout. _Signal:_ a regression appears only after the
flip. _Response:_ the flag is the revert — record before flipping who watches
what, and for how long, before the change is considered settled.

**The biometric subject is usually not the account holder.** The person whose
voice is embedded is typically the user's counterpart, who never interacts with
the product and cannot consent. Vectors are session-scoped and never stored, which
is why this is a note and not a blocker — but whether a notice surface is needed
is a product decision this plan does not make.

**Docs drift.** `docs/system-architecture.md` currently explains, at length, why
the feature is off. Flipping the flag without rewriting it leaves the repo's own
architecture doc arguing against the shipped state. _Response:_ step 5 is a
success criterion, not a follow-up.
