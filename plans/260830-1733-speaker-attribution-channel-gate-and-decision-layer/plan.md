---
title: 'Speaker attribution: bounded-K auto-detect, channel gate and decision layer'
description: 'Deliver zero-manual speaker attribution with anonymous ordinal labels, bounded by a measured speaker-count ceiling, where every turn ends the session carrying an ordinal — deferred and back-filled, never left blank. Gated on auditing the bench instrument, then measuring the browser-DSP channel on real people, before any further product code.'
status: pending
priority: P1
effort: '~9-11d + one recording session (P3 −2d by V1, P4 +2d by red team, +4.5d by P7/P8)'
tags: [speaker-attribution, benchmarks, realtime-client, cpu, zero-manual]
created: 2026-08-30
updated: 2026-09-01
---

# Speaker attribution: bounded-K auto-detect, channel gate and decision layer

## Current premise — 2026-09-01

**Read this before any phase file.** This plan carries three amendment strata.
Where a phase body and this block disagree, **this block wins**.

**Three binding user decisions, newest first:**

- **D8 — a chip that never resolves to a person is a failure.** Permanent
  abstention is out. Every turn ends the session carrying an ordinal; a pending
  ordinal may change until settled or human-touched, then never again. P4's
  abstention machinery and the inherited "above `K_max`, render no chip"
  criterion are **superseded**.
- **D10 — the session stays one-directional for now.** Per-turn language ID is
  accepted in principle but deliberately sequenced _after_ this measurement
  slice. So the acoustic layer currently carries the entire load.
- **D11 — fine-tuning is parked, not deleted.** It remains the only option with a
  published path under the 15% EER KILL line, and P6's fork rule says when it
  reopens.

**Execution order — numbers are identifiers, not sequence:**

```
P1 ✓  P5 ✓  ->  P7  ->  P2  ->  P3  ->  P4  ->  P6
                 |        |      (amend)  (re-spec)
                 |        `- decisive gate; one-shot; needs P7 first
                 `- can invalidate P1 and stop the slice

P8 — WITHDRAWN 2026-09-01 (correction C3). Premise was false.
```

P5 already ran in parallel with P1 and completed before P2 started, so
out-of-order numbering is this plan's existing norm. `dependencies:` frontmatter
is the machine-readable truth; P2 now declares `[1, 7]`.

**Two blockers stand before P4, both surfaced by the red team:**

1. **P4 Step 0 has no input** and P4's own stop rule has already fired unrecorded
   — see D5 as re-derived.
2. **P3 was never amended for D8.** It contains no pending state, so the
   authority table P4 was told to rely on cannot arbitrate the pending-row race.
   P3's file predates the whole 2026-09-01 stratum.

**Superseded text, by phase:** P4's abstention design (struck in place, kept for
its reasoning); P1's success criteria, which record bars P1 ran and **missed** —
they are history, not open checkboxes. **And `plan.md`'s own Overview** — see the
correction below.

## Correction stratum — 2026-09-01, after red team

The 2026-09-01 amendment above was written against three claims that a four-lens
red-team pass proved false. They are corrected here rather than deleted, because
the plan's value is that it records its own reversals.

**C1 — every `online.py` citation in this plan was ~120 lines stale, and the
central mechanism claim was wrong.** Phase 1's implementation rewrote the module
(k_max, three above-cap policies, `centroid_window`, deferred mint) and no
citation was re-anchored. The plan asserted "`K_max` bounds creation. It cannot
bound assignment." **False.** `ABOVE_CAP_POLICIES = ("assign", "abstain",
"raise_tau")` (`online.py:59`), validated at `:176-183`; `observe` (`:232`)
raises the assign bar to `tau_assign_capped` at `:247-248` **before** the assign
test at `:250`, and the `abstain` policy returns `label=None` above the cap at
`:263`. Suppressing assignment once the cap binds is implemented, validated, and
already measured. D5 is re-derived below.

**C2 — "a same-channel imposter pair cannot be constructed" is false.**
`build_embedding_cache.py:151-152` builds **one** `RoomConfig()` and **one** RIR
and applies it to every clip of every speaker, so the far-field arm is already a
shared-channel condition and its non-target pairs are already same-"microphone"
imposters. What survives is narrower and still true: that channel is
_synthetic_, so P2 remains the only measurement of a **real** shared microphone.
Two consequences: P7-M12 may build a synthetic same-channel imposter set today,
and the far-field duration slope (27.67 → 22.67) is **itself confounded** by the
shared RIR inflating non-target cosines — so it is not clean evidence against
the broken-instrument hypothesis either.

**C3 — Phase 8's premise was false and the phase is withdrawn.** `embedSpeaker`
is started eagerly at `translation-session.service.ts:293-299`, **before**
`transcribeAndTranslate` is awaited, and the shipped comment says so: _"Started
HERE, beside the translation rather than after it… awaited at the call site it
would become serial and buy nothing."_ The embedding already overlaps the
translation, so no latency ceiling follows from where the `await` sits and there
is no budget to free. Moving the `await` below `streamClauses` — which awaits TTS
synthesis **per clause, sequentially** (`:638-671`) — would delay the vector by
seconds and lose it entirely when the socket closes mid-delivery, because the
emit is guarded by `registry.holds` at `:350`. That would break D8's own
guarantee. **Phase 8 status: withdrawn.**

**Corrections to claims made elsewhere in this plan:**

- **"0/3 splits on all seven arms" is false as stated.** That is the **far-field**
  gate cell. `results/1s-m9-k2-assign.csv` records campplus **clean** N=2 cold at
  `verdict=PASS` on all three splits (accuracy 0.858 / 0.903 / 0.877). The FAIL is
  channel-conditional, which is precisely why P2 decides.
- **D9's "~85% break-even" has no derivation anywhere in this plan.** It is
  downgraded from a decision to an **open question** until the arithmetic — LID
  accuracy assumption, acoustic floor, combination rule — is written down.
- **The labels R1-R5 used in Phase 7 are not defined in this plan.** They were
  imported from a working note. They mean the numbered constraints in
  "Constraints" below; Phase 7 now cites those numbers directly.
- **The Overview's design sentence is superseded.** "Above `K_max`, stop minting
  and abstain" (below) predates D8 **and** C1. Abstention as a terminal state is
  out (D8); above-cap suppression is implementable (C1). Read D5 as re-derived,
  not the Overview.
- **P1 enabled a production metrics sink and its output is committed.** See the
  new Constraint 15.
- **M1's turn-length distribution came from a solo, voice-off sitting.**
  `results/turn-metrics-m1.jsonl`: **all 21 server rows are `voice_off`**, which
  `turn-timeline.ts` defines as _"a SUCCESSFUL turn that was never meant to be
  spoken"_ — speech output was disabled for the entire capture. No translation was
  ever played, so no counterpart could have been responding to one. It is one
  person talking to a device, not a conversation. **`TURN_S = 1.0s` was selected
  from this distribution**, and every measurement since is at 1.0s, so the whole
  program is conditional on a solo speaker's turn lengths resembling a
  conversational speaker's — unverified, and plausibly false, since people in
  dialogue produce shorter and more reactive turns. It also means the timing and
  turn-taking features P2 was newly asked to record have **zero real production
  data** behind them today. P2 is the first capture that would fix both.
- **The tail is robust to speaker ordering** [measured 2026-09-01]. Re-run at
  `order="alternating"` — strict round-robin, which the bench's own comment calls
  "what two-person dialogue actually does" — the unresolved tail does **not**
  shrink: 0.3096 -> **0.3587** at 10 turns, 0.3475 -> **0.3910** at 40. It grows
  slightly. What improves is quality on labelled turns (`acc imm` 0.9185 ->
  0.9576) and counting (`exact` 0.9417 -> **0.9967**). **Caveat:** `alternating`
  is p=1.0, perfect alternation, an extreme rather than reality. The bench offers
  only p~0.5 and p=1.0 and **cannot measure a realistic turn-switch rate at
  all** — and every earlier number in this plan was `shuffled`-only, which the
  bench's own docstring says is not interpretable without its pair.

- **The published EER-vs-duration curve is not a duration curve** [measured
  2026-09-01, P7-M11]. `pairwise-summary-screen.csv`'s 21.22 / 20.50 / 20.49%
  across 1s/2s/3s was read over **three different populations** — 80, 76 and 74
  contributing speakers — because `pairs.py:90-108` admits a speaker only when a
  clip is at least the bucket length. Hold the population fixed and the same
  span reads **24.00 -> 18.25%**, a 1.32x move rather than 1.04x. The duration
  effect was real and a harder speaker set at longer buckets was cancelling it.
  **Quote that curve with its speaker counts or not at all**, and hold every
  P7 cell to a stated fixed population.

  The direction also refutes what `phase-07` assumed. It reasoned that a longer
  bucket admits more speakers and therefore more confusable pairs; in fact
  **fewer** speakers (48 vs 80) scored **worse** at 1.0s. Which speakers, not how
  many, is what moves it.

  What the run did **not** settle: R = 1.40x over the full 1-8s span sits inside
  the pre-registered undetermined band, and the absolute anchor was missed —
  **17.15% EER on 8 seconds of clean audio**, against a model published near 1%
  on its own domain. P1's FAIL is neither invalidated nor confirmed. See open
  question 11.

## Overview

**The premise of this plan was reversed by the user on 2026-08-30.** The earlier
version delivered a human-seeded named roster: the user tapped once per person,
and the machine copied that label forward. The user rejected that flow outright:

> _"tôi không muốn user phải manual bất cứ chỗ nào, tự động detect, hiển thị
> người 1, người 2,... Sau này sẽ lưu lịch sử rồi sửa lại sau thì tuỳ user"_

Zero manual interaction anywhere. Auto-detect. Anonymous ordinal labels. History
and later correction are the user's option, deferred.

The plan below delivers that. Most of its machinery survives the reversal — the
channel gate measures a microphone, not an algorithm — but its central claim,
its acceptance bars, and its ship gate all change.

### The mechanism the user asked for already exists, and already failed

`benchmarks/speaker-id/speaker_bench/online.py` is exactly it: online clustering
with an unknown speaker count, anonymous integer cluster ids, no human input.
Mint below `tau_new`, assign-and-fold above `tau_assign`, abstain between. Its
docstring opens _"This is the algorithm the product would actually run."_

`run_session.py` measured it, against bars the script itself defines
(`ACCURACY_BAR = 0.70`, `ATTRIBUTION_FLOOR = 0.80`, `COUNT_ERROR_MAX = 1.0`).
Tallying all 24 cold rows of `results/session-summary.csv`:

> **4 PASS · 12 FAIL · 8 NO-CONFIG.**
> **All 4 passes are on `split == 1`** — one particular draw of 15 evaluation
> speakers, across both models and both acoustic conditions.
> **All 12 failures broke on `speaker_count_abs_error` alone.** Every one clears
> accuracy ≥ 0.70 and attribution rate ≥ 0.80.

`results/session.log` records the verdict that follows:
`enrolled mode: PASS   unenrolled mode: FAIL`.

Warm, for contrast: **21 PASS / 3 FAIL / 0 NO-CONFIG**; campplus warm is 12/12.

**So the mechanism hears correctly and counts wrongly** — and the UI the user
asked for, "Người 1, Người 2, …", is the surface that renders the count. Under a
named roster an extra latent cluster is invisible, because `suggestSpeaker`
returns a roster id or `null` and creates nothing. Under ordinals, **every count
error is on screen.** `run_session.py:16-20` already says so in the harness's own
voice: _"One person appearing under two names is a visible product failure."_

### Why this is nonetheless deliverable

Three things are unmeasured, all cheap, and each sits directly on the failure:

1. **The product's real turn duration is unknown.** The figure previously quoted
   as turn length (p50 1163ms) is _end-to-end latency_
   (`docs/development-journey.md:963`, "Tổng, 32 lượt"), and is superseded at
   `:996` by 859/1849ms. Meanwhile every bench number is measured on clips
   truncated to exactly **2.0 s** (`scripts/build_embedding_cache.py:56`,
   applied `:143`), and campplus far-field EER is **27.7% at 1s vs 23.1% at 2s**.
   The bench may be reading the wrong cell. `audioMs` already ships on the wire
   (`translation-session.service.ts:356`) — measuring this needs no corpus.
2. **N=2 has never been measured.** `MEETING_SIZES = (3, 5)`. The product's
   dominant case — one user, one counterpart — has no number of any kind.
3. **`centroid_cap` was never swept.** It exists (`online.py:159`), is honoured
   (`:126`), and its docstring calls the right value _"an empirical question the
   session bench answers."_ `run_session.py` never passes it. Every published
   cold number, including the 83%→71% within-session decay, is the **uncapped**
   baseline.

And one design change removes the failing metric by construction rather than
tuning against it: **bound the cluster count.** Above `K_max`, stop minting and
abstain. At `K_max = 2` a two-person conversation cannot render four chips — that
is arithmetic, not statistics.

## Decisions (settled — do not relitigate)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The channel-delta recording session **is runnable**; 3-5 people available                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | P2 stays the hard gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D2  | A human edit is **terminal**. The machine may renumber or merge non-confirmed rows; it may never touch a row the user has touched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | P3's authority table; enables the settle pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D3  | Real meeting size is **2-3 people**, not 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Now the gate.** N=2 is the primary cell; N=5 is reported, never gated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D4  | ~~Explicit enrollment must be skippable~~ — **SUPERSEDED.** Enrollment is **absent** from the live flow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | P4 no longer ships an enrollment ritual. `seed` survives only as a measured arm (P1-M6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D5  | **Bounded speaker count.** `K_max` set to the largest N the measurement supports. ~~**Restated after red team:** `K_max` bounds the chip count, not the error. It can only guard cluster creation — `online.py:125` runs the assign branch first — so above the cap a turn is folded into the nearest existing ordinal at a measured 64.9% theft rate.~~ **RE-DERIVED 2026-09-01 (C1): that restatement was wrong.** The cap **is** consulted before the assign test — `observe` (`online.py:232`) overrides the bar to `tau_assign_capped` at `:247-248`, tests at `:250`, and the `abstain` policy returns `label=None` above the cap at `:263`. Three policies exist and are validated (`:59`, `:176-183`). **But the choice has no input:** every `campplus, far-field, cold` row of `1s-m9-k2-abstain.csv` and `1s-m9-k2-raise_tau.csv` is `count_constraint=unreachable`, `verdict=NO-CONFIG`, accuracy columns empty — 3/3 splits each. Only `assign` produced numbers, and it is `FAIL`. **P4's own stop rule has therefore already fired and was not recorded.** The 64.9% theft rate is separately disqualified: it is the `enrolled=2` row of `guest-summary.csv`, measured 2026-08-26 at **2.0s**, in a seeded mode D4 removed from the product | **Blocks P4 Step 0** — but not for the reason first recorded. **MEASURED 2026-09-01** (`diag-abstain-reachability`, host, 1.0s cache, 105-point grid, 150 meetings/point, campplus far-field N=2 cold): `assign` reaches attribution rate **0.9953** and clears the target at 12/105 points; `abstain` tops out at **0.8747** and `raise_tau` at **0.7927** — **0/105 each**. `calibrate` filters on `ATTRIBUTION_FLOOR + CALIBRATION_MARGIN = 0.94` _before_ the count criterion is considered, so a policy that withholds attribution by design can never be graded. **`NO-CONFIG` was a harness artifact, not a policy verdict.** And the direction is the opposite of what was assumed: at those points `abstain` scored accuracy **0.8483** and `raise_tau` **0.8654** against `assign`'s **0.8332** — the two discarded arms look _more_ accurate. Diagnostic only: calibration speakers, max-rate points not max-accuracy points, no transfer loss applied. **The fix is the floor, not the grid.** **MEASURED AGAIN, held-out, 2026-09-01** (`reports/measurement-260901-0110-above-cap-floor-sweep.md`): with the floor swept instead of fixed, **both discarded arms pass** — `abstain` at floor 0.65 scores prefix-locked **0.8809** (3/3 shippable) and `raise_tau` at 0.60-0.65 scores **0.8706-0.8731** (3/3), against `assign` at the harness floor scoring **0.5887** (0/3). Validity check: `assign` @ 0.94 reproduces the recorded 0.5887 exactly. **The far-field cell the whole plan treats as FAIL reaches 0.87-0.88.** Cost: live attribution rate 0.54-0.60, i.e. ~40-46% of turns defer and are back-filled under D8 |
| D6  | **Bars tightened at N=2.** accuracy ≥ **0.85** (chance is 0.50 at N=2, and a swapped chip in a _translation_ app puts the counterpart's words in the user's mouth); **exact-count rate ≥ 0.90** replaces `\|dN\| ≤ 1.0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | P1's bars. See "Why the inherited count bar is degenerate at N=2"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D7  | **Chatofy is a non-commercial graduation project.** `cc-by-nc-4.0` corpora are usable for evaluation without reservation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Unblocks the measurement program. P5's licence condition relaxes to "NC permitted"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D8  | **A chip that never resolves to a person is a failure.** _"theo tôi là thất bại"_ — asked whether "Người ?" on an undecidable turn was acceptable. Permanent abstention is out; **defer then back-fill** replaces it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | P4 re-specified. Governing metric moves from `prefix_locked_accuracy` to **settled-label accuracy** (P7-M13). **Open tension:** the assign branch runs before the mint guard, so an over-cap third speaker must now carry a wrong ordinal — there is no third option. See Open questions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D9  | ~~**The cross-language fraction is a measured gate.** Break-even sits near **85%**~~ **DOWNGRADED to an open question, 2026-09-01.** The 85% figure has **no derivation anywhere in this plan** — no stated LID accuracy, no acoustic floor, no combination rule. It cannot gate a branch until the arithmetic is written down. What survives: the cross-language fraction is worth measuring, and P2 can label it for free                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | P2 still labels the language of every recorded turn — it is cheap and M1 cannot answer it. But **no fork may be decided on 85%** until D9 is re-derived with its model stated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D10 | **The session stays one-directional for now.** Per-turn language ID is **accepted in principle** (_"chấp nhận"_) but sequenced after this measurement slice: _"làm chắc 1 chiều trước, LID sau"_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | The acoustic layer carries the entire load in the current slice. **This is what promotes P2 to the decisive gate.** Reopened by P6's fork rule, not before                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D11 | **Fine-tuning is parked, not deleted.** VieSpeaker (902h, 4,715 speakers, free on HF) was not an accessible corpus when the non-goal was written; the block was effort and corpus availability, not licence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Still a non-goal for this slice. It is the only option with a published path under the 15% KILL line, so P6's fork rule names the exact condition that reopens it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D12 | **Fewer wrong labels beats faster labels.** Shown the trade concretely, the user chose ~6 of 10 turns labelled instantly with ~0.7 wrong, over 10 of 10 labelled instantly with ~4 wrong                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Selects the `abstain` / `raise_tau` direction at a **lowered attribution floor**, which is the measured passing region (prefix-locked 0.87-0.88, 3/3 shippable). `assign` at the harness floor — 0.5887, 0/3 — is rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D13 | **A deferred turn must be filled DURING the session.** Waiting until the user presses stop is a failure, on the same reasoning as D8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Session-end force-assignment is not an acceptable horizon.** And `settle()` cannot be the filler: it re-clusters from scratch and enforces `k_max` via `fcluster(maxclust)`, which the code comments describe as merging the closest clusters — the unrecoverable error M10 rejected it for. A different, weaker mechanism is required: **re-score pending turns against the current centroids**, which never merges clusters and never renumbers an assigned turn. Unmeasured — see open question 8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Why the inherited count bar is degenerate at N=2

`COUNT_ERROR_MAX = 1.0` (`run_session.py:54`) was written for N=3 and N=5. At
N=2 it is not merely loose, it is **wrong in the dangerous direction**: a session
that collapses both people into **one** cluster scores `|dN| = 1` and **passes**.
The worst possible product outcome — a two-person conversation rendered as one
person talking to themselves — clears the bar.

`SessionScore.speaker_count_error` is computed as `clusters - true_speakers`
(`online.py:330`) and `run_session.py:200` discards the sign with `abs()`.
So the repo cannot currently distinguish over-split from merge, and **the repair
strategies for the two are opposite**. P1 reports the signed error and an
exact-count rate instead.

## What P1 can and cannot decide

P1 runs on corpus audio: **acoustically conservative** (synthetic far-field,
image-source shoebox, RT60 0.507s, stacked on already-processed audio) but
**channel-optimistic** (no NS/AGC/EC, no 48→16k path).

- P1 **may cut in the negative direction.** If N=2 cold fails on the friendlier
  channel, stop before recording anyone.
- P1 **may never skip P2 or shrink P3/P4 on a pass.** The flag is off _because_
  of the channel; a corpus pass does not touch that reason.
- Any P1 result within **3 points** of its bar is **undetermined until P2**.
- **P1-M1 runs before everything, including environment restoration.** It needs
  no corpus and it _selects_ the bench's `TURN_S`. Running the bench first risks
  measuring the wrong duration cell a second time.

## What P2 can and cannot decide

Unchanged by the premise reversal — it measures the microphone, not the
algorithm. `run_channel_delta.py:14-19` states a one-session fixture shares one
room and one microphone, so its absolute EER is optimistic and not comparable to
the corpus screen; `:52-56` states the corpus numbers are **"NOT a baseline to
subtract from — different corpus, different pairing rules, different room."**

**The session can invalidate corpus thresholds; it cannot adjust them.** P2's
output is a **verdict**, never an offset.

## The Hungarian remap — the position this plan takes

`score_session` calls `linear_sum_assignment` (`online.py:387`) on the
cluster×speaker contingency table _after seeing ground truth_. It does two
separable things, and they have different legitimacy for an anonymous-ordinal
product:

- **Choosing which cluster is ordinal 1.** _Legitimate._ The numbering is
  arbitrary and asserts no identity; `nextSpeakerNumber` already assigns in
  creation order. This is the half the earlier plan's blanket withdrawal got
  wrong for _this_ product.
- **Using ground truth to pick the correspondence that maximises hits.** _Not
  legitimate._ The product never has ground truth, live or offline.

Two consequences, both operational rather than rhetorical:

1. The count metric is **untouched by the remap** — `clusters` is counted at
   `online.py:205` before `linear_sum_assignment` runs at `:387`. **The one bar
   that fails is the one the oracle does not flatter.**
2. Published cold accuracies remain **upper bounds even for the anonymous
   product**. P1-M4 adds a prefix-locked scorer (cluster → ordinal fixed at
   creation, no ground truth) and **the ship decision uses that number**. The gap
   between the two is the size of the oracle, and it has never been computed.

The earlier plan's rule survives intact: _an oracle number is a ceiling, never a
result._

## Goals

| #   | Goal                                                                                                                                    | Priority |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Measure the product's real turn duration, then the N=2 cold cell, in that order                                                         | P1       |
| 2   | Measure whether anything arrests the within-session cold decay (`centroid_cap`, deferred mint)                                          | P1       |
| 3   | Measure the browser-DSP channel delta; return a verdict                                                                                 | P1       |
| 4   | Make attribution authority explicit; permit machine renumbering, forbid touching human edits                                            | P1       |
| 5   | Ship bounded-K auto-attribution with ordinal labels; every turn ends carrying one, deferred and back-filled rather than left blank (D8) | P1       |
| 6   | Close the "add a model" axis on measurement                                                                                             | P3       |
| 7   | Flip the flag only against production evidence                                                                                          | P2       |

## Phases

| #   | Phase                                                                                                       | Status                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | [Phase 1: Measure the auto-attribution mechanism](./phase-01-measure-target-cells.md)                       | **Measured — cold arm FAILS at the real 1.0s turn length, every arm**               |
| 2   | [Phase 2: Channel delta gate](./phase-02-channel-delta-gate.md)                                             | Pending                                                                             |
| 3   | [Phase 3: Attribution authority state machine](./phase-03-attribution-authority-state-machine.md)           | **Implemented 2026-09-01** — `pending` origin, rendered-is-final                    |
| 4   | [Phase 4: Bounded-K auto-attribution and settle pass](./phase-04-bounded-k-auto-attribution.md)             | **Implemented 2026-09-01** — settle pass dropped by OQ2; defer+backfill             |
| 5   | [Phase 5: Bounded model screen](./phase-05-bounded-model-screen.md)                                         | **Completed** — axis closed, campplus stays                                         |
| 6   | [Phase 6: Ship decision](./phase-06-ship-decision.md)                                                       | Pending — **fork rule pre-registered 2026-09-01**                                   |
| 7   | [Phase 7: Bench instrument correction and rescores](./phase-07-bench-instrument-correction-and-rescores.md) | **M11 + M11b measured 2026-09-01 — instrument SOUND, OQ11 closed. M12-M14 not run** |
| 8   | [Phase 8: Speaker step off the audio path](./phase-08-speaker-step-off-the-audio-path.md)                   | Pending — independent, `dependencies: []`                                           |

**Execution order (numbers are identifiers, not sequence):**

```
P1 ✓  P5 ✓  ->  P7  ->  P8  ->  P2  ->  P3  ->  P4  ->  P6
```

P2 declares `dependencies: [1, 7]`; P7 declares `[1]`; P8 declares `[]`. P5
already ran in parallel with P1 and completed before P2 started, so out-of-order
numbering is this plan's existing norm — **`dependencies:` frontmatter is the
machine-readable truth, not the phase number.**

**P7 before P2 is not a preference.** P2 is a one-shot human recording session.
P7-M11 decides whether the instrument its protocol would be calibrated against is
sound. Spending the fixture first risks learning nothing.

## Constraints

1. **CPU only.** Production is `ssh.quanganh208.dev`: i7-11700K, 8C/16T,
   AVX-512+VNNI, 31 GiB RAM, Linux Mint 22.3, Docker. Dev and prod stacks share
   those 16 threads — prod defaults to 4 speech threads
   (`docker-compose.prod.yml:222`), dev to 8 (`docker-compose.yml:66`).
2. **Latency.** campplus at `contended-stt8`, `extractor_threads=2`: p95
   **124.6 ms @2s**, **183.5 ms @3s**, **300.9 ms @5s**
   (`results/latency-container-2decode.csv`). Budget ~200ms, so 3s is the
   governing cell and 5s already blows it. eres2netv2 at the same cell is
   555.8 ms @2s. Any design embedding twice per turn spends this twice.
3. **The browser cannot reach `/embed`.** Loopback-bound to `apps/api`
   (`docker-compose.prod.yml:217-218`). Every vector arrives via
   `server.turn.embedding`, emitted _after_ `server.transcript.final`
   (`translation-session.service.ts:336`, then `:349-357`).
4. **Session embeddings already accumulate client-side.**
   `turn-keyed-transcript.ts:402-405` stores every `{vector, audioMs}` additively
   and never evicts. **A whole-session settle pass therefore needs no
   persistence, no server call, and no new privacy decision.** This is what makes
   P4's settle pass cheap.
5. **Privacy contract, shipped.** Vectors and labels are session-scoped and live
   in the browser; nothing is persisted; no name is stored beside a voice
   (`attribution-stats.ts`, `speaker-roster.ts:10-15`). This plan does not reopen
   it — but P2 records real voices, so see its consent and retention criteria.
   The person embedded is usually the **counterpart**, who never touches the
   product and cannot consent.
6. **`AttributionOrigin` is a compile-time public contract.**
   `speaker-roster.ts:33`, barrel-exported, consumed by an exhaustive
   `Record<AttributionOrigin, string>` at `speaker-chip.tsx:52-58`. Widening it
   breaks `apps/web` at build time — a forcing function, provided both land
   together.
7. **`MAX_SPEAKERS = 8`** (`speaker-roster.ts:78`, enforced `:96`). A roster
   ceiling already exists. `K_max` must be reconciled with it, not layered on top.
8. **Non-atomic deploys.** `apps/api` and `apps/web` do not deploy together — any
   wire change uses the existing per-client opt-in pattern.
9. **The flag flip is 0→100%.** `cascade-panel.tsx:128` sends
   `embedSpeaker: true` unconditionally, so `SPEAKER_EMBEDDING_ENABLED`
   (`env.schema.ts:165`) is the only switch and it turns the feature on for every
   cascade session at once. There is no ramp today; P6 either builds one or
   records the all-at-once flip as an accepted decision.
10. **Licence — resolved (D7).** Chatofy is a non-commercial graduation project,
    so `cc-by-nc-4.0` corpora (VoxVietnam) are usable for evaluation without
    reservation. Training, fine-tuning and shipping a derivative remain out of
    scope for reasons of effort and corpus availability, not licence.
11. **Provenance.** `SPEAKER_BENCH_REQUIRE_PARITY=1` is read in exactly one
    place, `tests/test_segment_parity.py:54`. **No run script reads it**, so
    prefixing it to a measurement command changes nothing. The real requirement:
    run `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest` immediately before each
    official measurement and **record its exit code in the report**. Every
    measurement reports per-turn CSV, not only aggregates. `run_channel_delta.py`
    returns 0 on every path (`:123`, `:164`, `:197`) and documents itself
    "Diagnostic, never a gate" — P2 changes that contract explicitly or stops
    calling itself a hard gate.
12. **No fitted-on-scored-speakers numbers.** Held-out speaker splits mandatory.
    Transfer loss on the **current** run (`session-summary.csv`,
    `CALIBRATION_MARGIN = 0.14`) is mean +3.5pt, p90 +10.4pt, max +17.3pt over
    40 calibrations (`results/session.log`). The +5.1/+13.8/+19.6 over 48 figure
    comes from `session-summary-margin08.csv`, the **superseded** margin-0.08 run
    — and `CALIBRATION_MARGIN` was itself set from that p90, so it cannot be
    cited as independent evidence for the margin.
13. **The evidence base is 30 speakers.** `results/session.log`:
    _"policy spread: 30 speakers with >=8 gap-separated clips, 3 independent
    splits"_, `speakers_evaluated = 15` per row. 400 evaluation meetings are
    drawn from 15 voices, and the three "independent" splits are shuffles of the
    same 30 people. This bounds confidence **in both directions**: cold looks
    bad, and the evidence that it is bad is thin.
14. `docs/design-guidelines.md`: exactly **one `bg-primary` accent-filled
    control** per app screen. Auto-chips stay ghost/outline.

15. **A production metrics sink was enabled for M1 and its output is committed.**
    `TURN_METRICS_PATH` was set on `chatofy_prod_api` on 2026-08-31
    (`turn-metrics.recorder.ts:119`, `env.schema.ts:171`). The resulting file
    `results/turn-metrics-m1.jsonl` is **git-tracked** (commit `9c64d5ec`) and its
    client rows carry `sessionId` plus `speechStartedAt` / `speechEndedAt` as
    **epoch wall-clock**, not durations (`ws-events.ts:242,244`). The bench
    `.gitignore` covers `results/**/*.png|wav|npz` only — there is no `*.jsonl`
    rule, so it was tracked by default. **P1 carried no consent, retention or
    teardown criterion**, while P2 carries five for a smaller exposure. Open
    items: confirm the sink is unset on prod and record the date; decide
    retention for the committed file acknowledging git history cannot be
    retracted after push; add a `*.jsonl` ignore rule; coarsen the epoch
    timestamps to relative offsets before any future commit. This is a live
    item, not a documentation defect.

    **RESOLVED 2026-09-01.** Verified on `ssh.quanganh208.dev` and closed:

    - **The sink was still armed.** `TURN_METRICS_PATH=/metrics/turn-metrics.jsonl`
      was live on `chatofy_prod_api`, backed by a bind mount
      `/home/quanganh208/chatofy-metrics -> /metrics` that survives container
      recreation and redeploys. It was enabled via `prod.env` (the volume came
      from a separate `turn-metrics.override.yml` kept outside the CI checkout).
    - **Exposure was bounded and static:** 12,078 bytes, 43 rows, **22 distinct
      sessionIds**, last written 2026-08-31 12:19 — no growth in ~12h. The
      committed file was byte-identical to the live one. Whether all 22 sessions
      were the maintainer's own is **not determinable from the data** — the sink
      records no user id.
    - **Sink disabled.** `prod.env` backed up (`prod.env.bak-20260831T175233Z`,
      following the existing backup convention), the variable commented rather
      than deleted so the change is reversible and auditable, and
      `chatofy_prod_api` recreated. Verified `TURN_METRICS_PATH` absent from the
      container env; healthy; the existing 43 rows untouched. The edit lives
      outside the CI checkout, so a redeploy will not silently re-enable it.
    - **Git:** `results/**/*.jsonl` added to `benchmarks/speaker-id/.gitignore`
      with the reason recorded, and `turn-metrics-m1.jsonl` untracked
      (`git rm --cached`). The file remains on disk locally. **History is not
      retracted and cannot be** — the rows are still reachable in commit
      `9c64d5ec`. Deciding whether that warrants a history rewrite is a separate
      call; the repo is private, which bounds it.
    - **Consequence for reproducibility:** M1's raw artifact is now local-only,
      like the `.npz` caches. `measurement-260831-2200-*` cites it by path; a
      fresh clone will not have it. Commit a coarsened derivative (hashed
      sessionId, relative offsets) if M1 ever needs to be reproducible.

## Non-goals

- Overlapping-speech separation; within-turn speaker-change detection. One turn
  = one speaker stays an assumption with no detector behind it — `speech-gate.ts`
  segments on silence only and no diarization library exists in the repo. Named
  because it **is** a real failure mode, not because it is absorbed.
- **History persistence itself.** Greenfield: `apps/api/prisma/schema.prisma` has
  exactly one model, `User`. The user deferred it ("sau này"). This delivery must
  be _compatible_ with it — labels revisable, human correction terminal — but
  builds none of it.
- **Cross-session voiceprints, including the account owner's.** P1-M6 _measures_
  what one seeded centroid would buy; it does not build it. If that measurement
  says the value is large, the persistence and consent question goes to the user
  as a decision, with a price attached. It is not smuggled in under "zero manual".
- Server-side vector storage; names stored beside voices.
- Attribution on the Gemini Live path (`live-panel.tsx` never asks).
- Fine-tuning or shipping weights trained on VoxVietnam / Vietnam-Celeb /
  VoxBlink2.
- Replacing the hand-written RMS gate with a learned VAD.
- Multi-device rooms (per-participant channels). Highest accuracy ceiling that
  exists, but a new product surface — `translate.gateway.ts` has no room concept
  and `grep roomId` returns zero matches. Parked.
- Re-tuning `EMBED_THREADS`.
- **Speaker attribution in `apps/extension`.** It consumes the same reducer
  (`meeting-transcript.ts:38-41`, two `TurnKeyedTranscript` instances, one per
  direction), has no roster UI, and never sends `embedSpeaker`. P3/P4 state lands
  there regardless, so **each phase states the extension's behaviour explicitly**
  rather than leaving it to a default.
- **Per-turn language as a speaker prior.** Checked and unavailable on the
  cascade path: `TranslationDirection` is `'en_to_vi' | 'vi_to_en'`, fixed at
  session start (`cascade-panel.tsx:110`), identical for every turn in a session.
  Recorded so nobody re-proposes it.

## Success Criteria

- [ ] Real per-turn speech duration measured from production `audioMs`; the
      bench's `TURN_S` selected from it, not assumed (P1)
- [ ] N=2 cold measured for the first time, at the selected duration, with
      accuracy ≥ 0.85 and exact-count rate ≥ 0.90 on ≥2 of 3 held-out splits (P1)
      — **RAN AND MISSED.** 0/3 splits on all seven arms at the measured 1.0s.
      This is a closed historical record, not an open checkbox; see
      `reports/measurement-260831-2200-*`. P7 audits whether the instrument that
      produced it was sound
- [x] Full-length control cell run; the flat clean EER curve (21.22 / 20.50 /
      20.49% at 1s/2s/3s) resolved as either a real ceiling or a broken
      instrument, with the kill rule applied in writing either way (P7-M11) —
      **RAN 2026-09-01, and the rule returned UNDETERMINED in writing.** The
      curve above is void as a duration measurement: its populations differ, and
      on a fixed population the same span reads 24.00 -> 18.25% (1.32x) instead
      of 21.22 -> 20.50% (1.04x). R over the full 1-8s span is **1.40x**, inside
      the pre-registered escalation band. **The user decides.** See
      `reports/measurement-260901-0740-m11-duration-control.md`
- [ ] Settled-label accuracy measured for the settle pass — the cell
      `1s-m10-settle.csv` never contained, having no accuracy column at all
      (P7-M13)
- [ ] Cross-language fraction of real turns measured, so D9's break-even is
      checked against a number rather than an intuition (P2)
- [ ] Prefix-locked (non-oracle) accuracy reported beside every Hungarian number;
      the gap stated (P1)
- [ ] Signed count error and exact-count rate reported, replacing bare `|dN|` (P1)
- [ ] `centroid_cap` swept; whether anything arrests the cold decay answered
      either way — "nothing does" is a valid finding (P1)
- [ ] Channel delta measured on ≥3 (prefer 5) real speakers through production
      `getUserMedia` constraints; reported as a **verdict**, not an offset (P2)
- [ ] Consent recorded and a retention decision with a date, both **before**
      capture; destruction executed and logged (P2)
- [ ] Authority state machine specified and unit-tested before any lever code; no
      path writes over a human edit (P3)
- [ ] Ordinal renumbering is monotone: an ordinal may merge into a lower one; a
      turn's ordinal may never be reassigned to a different person (P3)
- [ ] `K_max` enforced: a session never renders more than `K_max` distinct
      ordinals, asserted against an adversarial embedding sequence (P4)
- [x] ~~Above `K_max`, turns render **no chip** — never an invented one (P4)~~
      **SUPERSEDED by D8** — a chip that never resolves to a person is a failure.
      Note the reason recorded here previously ("unimplementable — `K_max` guards
      `_create` while the assign branch runs first") was itself **false**; see
      correction C1. Suppression above the cap _is_ implemented (`abstain`,
      `raise_tau`). D8, not implementability, is why this criterion is gone
- [ ] **Every turn ends the session carrying an ordinal.** Rows pending at settle
      or session end are force-assigned; the count of rows ending unattributed is
      **0** (P4, D8)
- [ ] A row a human touches while its ordinal is still pending becomes terminal
      immediately; the back-fill never renumbers it (P3/P4, D2+D8)
- [ ] Zero-norm vectors and sub-duration-floor turns can never mint a speaker (P4)
- [ ] Zero user interactions after pressing start produce two labelled chips in a
      two-person session (P4)
- [ ] Model axis closed on a measured number (P5)
- [ ] `SPEAKER_EMBEDDING_ENABLED` flipped only against production evidence, with
      a defined minimum sample and the 0→100% flip answered (P6)

## Risks

| Risk                                                            | Signal it broke                                                                                 | Pre-decided response                                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N=2 cold fails on the friendlier corpus channel                 | P1-M2 misses accuracy 0.85 or exact-count 0.90 on ≥2 splits                                     | Stop before the recording session. Fall to the ladder in P6; do not relax the bar to manufacture a pass                                                                                                                                     |
| Real turns are much shorter than 2.0s                           | P1-M1 p50 well under 2.0s                                                                       | Rebuild the cache at the measured duration and re-read every cell. Every published cold number is then conditional and must be requoted, not reused                                                                                         |
| Browser DSP eats the separation                                 | P2 Δ EER > +6 points                                                                            | Stop the delivery. Feature stays off. A valid documented outcome, not a retry trigger                                                                                                                                                       |
| A delta from an easy fixture is used to adjust a hard threshold | Anyone proposes adding Δ to a corpus threshold                                                  | Forbidden — see "What P2 can and cannot decide"                                                                                                                                                                                             |
| The cold decay is unarrestable                                  | P1-M3: no `centroid_cap` flattens the curve                                                     | Report it. The settle pass (P4) does not fold forward and is structurally immune, so the decay bounds the _live_ label only, not the settled one                                                                                            |
| `K_max` binds in a real 3-person conversation                   | Labels vanish mid-conversation                                                                  | Accepted by D5, and it is the _quiet_ failure. But the third-voice detector is weak — 36.5% at 5% false alarm, AUC 0.774 (`session-guest-detection.csv`) — so the disable fires late and sometimes not at all. UI copy must not overpromise |
| The settle pass merges two people                               | Post-settle exact-count rate worse than pre-settle                                              | Merge error is reported **separately** from split error and never netted. A merge is unrecoverable without user action; a split is visible and correctable                                                                                  |
| Renumbering churn makes labels untrustworthy                    | P6 churn signal exceeds ~1 change per 10 turns                                                  | Demote the settle pass to end-of-session only, where the user is reading history and churn is invisible                                                                                                                                     |
| A public-contract change slips out unannounced                  | `AttributionOrigin`, `canRemoveSpeaker`, `TAU_SUGGEST`, `suggestSpeaker` are all barrel exports | P3 names each explicitly; the exhaustive `Record` is the compile-time forcing function                                                                                                                                                      |
| A provenance claim nobody can cash                              | A report says "run under `SPEAKER_BENCH_REQUIRE_PARITY=1`" with no pytest exit code beside it   | Constraint 11's restated form: the pytest run and its exit code, or no provenance claim                                                                                                                                                     |

## Provenance

- **Premise reversal:** user decision, 2026-08-30, recorded verbatim in Overview.
- **Accepted contract:** `reports/brainstorm-260830-2144-zero-manual-speaker-attribution.md`
  — `/ak:brainstorm --ultra`, five independent candidates over one immutable
  evidence packet, winner selected unchanged by a strongest-model verifier
  (73/80 over a tie at 71). Its ranking appendix records the strongest idea in
  each non-winning candidate; several are folded into P1 and P4 here as
  deliberate amendments, and the appendix says which.
- **Six evidence-packet defects** (two controller factual errors, two omissions,
  two overstatements) are recorded in that report and were corrected before this
  plan was written.
- **Prior red team:** 4 hostile reviewers, 37 raw findings → 15 accepted. See
  `## Red Team Review` below. **All 15 remain applied**; the premise reversal
  invalidates none of them, though findings 3 and 8 now bind different phases.
- Existing harness: `benchmarks/speaker-id/` — gate port verified exact against
  the real TypeScript `SpeechGate` on 35 fixtures at two ceiling configurations.

## Open questions

Referenced by D8 and by Phase 4. Open means **no phase may decide it silently**.

**Decision authority for 1-6 and 10.** The user delegated these on 2026-09-01:
_"bạn tự đo, tự chọn, cứ chọn theo recommend của bạn, không cần hỏi lại tôi …
làm xong hoàn toàn tôi test thì có data thật."_ Build it fully; their real
session is the acceptance test. Each answer below records the evidence it rests
on, so a wrong call is visible rather than buried.

1. ~~**What happens to a third speaker under `K_max = 2`?**~~ **DECIDED
   2026-09-01 — keep `K_max = 2`, above-cap policy `assign`.** This is OQ1's
   "accept a wrong ordinal for the third voice" option, and the measured cost of
   the alternative is why. campplus, cold, `assign`, from `1s-m9-k2-assign.csv`
   and `1s-m9-k3-assign.csv`:

   | cap     | N   | prefix-locked acc | exact count | merge      | over-split |
   | ------- | --- | ----------------- | ----------- | ---------- | ---------- |
   | **k=2** | 2   | 0.7849            | **0.9967**  | 0.0033     | 0.0000     |
   | k=2     | 3   | 0.5042            | 0.0000      | **1.0000** | 0.0000     |
   | k=3     | 2   | 0.7637            | **0.2300**  | 0.0058     | **0.7642** |
   | k=3     | 3   | 0.7196            | 0.9942      | 0.0058     | 0.0000     |

   Raising the cap to 3 fixes N=3 and **breaks N=2**: it shows a phantom third
   participant in **76% of two-person conversations**, and exact-count collapses
   from 0.9967 to 0.2300. This product is one device between two people (D10).
   Paying a constant, visible defect in the case that always happens, to improve
   a case that is out of scope, is the wrong trade.

   At N=3 under k=2 the third voice lands on whichever existing chip is closer.
   That is a real failure and it is named: one person's lines end up split across
   two chips. It degrades readably rather than catastrophically, and it is
   exactly what the user's real-data test can expose.

2. ~~**May a rendered ordinal change?**~~ **DECIDED 2026-09-01 — no. A rendered
   ordinal is final.** New evidence may only fill an _empty_ chip; it may never
   renumber one a person has already seen.

   Three reasons, in order of weight. The user's stated failure mode is a chip
   that **never resolves**, not a chip that is wrong — so stability is the
   property being bought. A chip that renumbers itself mid-conversation is
   unverifiable by the person reading it, and the premise of the design is that
   in a live conversation nobody is checking. And it makes P3's monotone merge
   invariant and the settle pass satisfiable together, by giving up the half that
   was never wanted: `settle()` may still run, but only to fill pendings, never
   to renumber. Consistent with M10's rejection of the settle pass as a display
   mechanism.

3. ~~**What ordinal does a turn with no vector at all get?**~~ **DECIDED
   2026-09-01 — carry forward the nearest preceding turn's ordinal; ordinal 1 if
   there is none.** Deterministic, satisfies D8, and invents nothing.

   The alternative worth naming is "assign the _other_ speaker", which is the
   maximum-likelihood guess under an alternation prior — and OQ9 established that
   **the real turn-switch rate is unknown and the bench structurally cannot
   measure it** (only p~0.5 or p=1.0). Choosing alternation would be choosing a
   prior we have no number for. Carry-forward is the guess that assumes least.
   It is recorded as a guess in telemetry so the real-data test can score it.

4. ~~**Is `pending` an `AttributionOrigin`, a field, or the absence of a row?**~~
   **DECIDED 2026-09-01 — a fourth `AttributionOrigin` member, `'pending'`.**

   `speaker-roster.ts`'s own docstring gives the argument: three values rather
   than a boolean, because collapsing states is how a suggestion silently becomes
   an authority. The same holds here. A field or an absent row would make
   `pending` invisible to precisely the nine sites that compare string literals —
   and auditing those nine **is the work**, not an obstacle to it.

5. ~~**Can a human touch a pending row at all?**~~ **DECIDED 2026-09-01 — yes.
   The chip stays interactive for every origin, `pending` included.** A tap
   settles the row immediately and terminally.

   P4 asked for a non-interactive placeholder _and_ a tested "human edit while
   pending is terminal" rule; the plan already noted those contradict, and that
   non-interactivity makes the rule vacuous. Resolved in the direction that keeps
   human authority, which is this plan's oldest invariant.

6. **D9's arithmetic.** Still open, and **no longer blocking.** It matters only if
   LID is adopted, and D10 keeps LID out of this slice.
7. ~~**Constraint 15's live items.**~~ **CLOSED 2026-09-01** — sink disabled on
   prod, file untracked, `*.jsonl` ignored. See Constraint 15.
8. ~~**Does in-session re-scoring actually resolve pending turns?**~~ **ANSWERED
   2026-09-01: no, and the failure is structural.** Measured at 10 / 20 / 40 turns
   per meeting (abstain, floor 0.65, thresholds re-calibrated at each length):

   | turns | immediate | resolved | **unresolved** | acc imm | acc res | exact |
   | ----- | --------- | -------- | -------------- | ------- | ------- | ----- |
   | 10    | 0.597     | 0.094    | **0.310**      | 0.9185  | 0.7336  | 0.942 |
   | 20    | 0.581     | 0.068    | **0.351**      | 0.9379  | 0.7637  | 0.964 |
   | 40    | 0.588     | 0.064    | **0.348**      | 0.9374  | 0.7838  | 0.974 |

   **The unresolved tail does not shrink with meeting length** — it rises slightly
   and plateaus at ~35%. The resolve rate _falls_ (9.4% → 6.4%). Waits do scale
   with length (mean 2.84 → 8.60, max 8 → 38), which confirms they were bounded by
   meeting length — but that only means the turns that never resolve wait longer.
   Resolution within 3 turns drops 69% → 31%.

   **So ~35% of turns are structurally unreachable by re-scoring**, and under
   D8+D13 they must be force-assigned. Honest overall accuracy with that tail in
   the denominator is **0.77 (blind-guess tail) to 0.86 (tail as accurate as
   resolved turns)** against a 0.85 bar — and the upper bracket is not credible,
   because the tail is precisely what the mechanism could not resolve.

   **Two findings retired.** The self-reinforcement decay risk did not appear
   (`acc imm` rose with length). And the speaker-count problem is solved: exact
   rate 0.942 → 0.974, well clear of the 0.90 bar. **What fails is labelling, not
   counting.**

   **Consequence — this is the strongest argument in the plan for reopening D10.**
   The tail is turns whose _voice_ is not separable at any accumulated evidence.
   No acoustic lever reaches them. But an ambiguous-voiced turn still has a
   language, so per-turn LID is the only known mechanism that touches this tail.
   D13 cannot be satisfied by the acoustic layer alone.

9. **What fills the ~35% tail?** **ANSWERED IN PART, 2026-09-01** — see
   `reports/debate-synthesis-260901-oq9.md` (three independent planners on a
   shared evidence packet, plus two measurements run during the debate).

   **The acoustic channel is measured dead on the tail.** The nearest-centroid
   argmax that `online.py:265` already computes and discards scores
   **0.5191 / 0.5140 / 0.5261** at 10/20/40 turns — chance at N=2 is 0.50 —
   against a **required 0.7532 / 0.7211 / 0.7144**. It falls ~20 points short,
   below the pre-registered kill threshold of 0.55. Those turns carry no usable
   discriminative signal in campplus's representation at 1.0s, so **any mechanism
   that reads the embedding will coin-flip.**

   **`D8 all-turns = 0.7775 / 0.7773 / 0.7846` is now measured**, not bracketed.
   The earlier 0.77-0.86 range collapses to its lower end.

   **So the answer must be a non-acoustic channel** — the turn-taking prior or
   per-turn LID. **And the number that decides between them does not exist:** the
   bench cannot represent a realistic turn-switch rate (only p~0.5 or p=1.0), and
   the corpus is Vietnamese-only so it can measure at most half the VI/EN
   confusion matrix. M1 cannot help either — it is a solo voice-off sitting.

   **Both roads lead to P2**, whose protocol now additionally needs turn-switch
   ground truth. Sequence: **P7-M11 -> P2 -> choose the channel against measured
   numbers.**

   **Say plainly before the fixture is spent:** the gap from 0.78 to the 0.85 bar
   is ~7 points and must come entirely from a non-acoustic channel on ~35% of
   turns. It is possible no available channel closes it, in which case lowering
   the bar or not shipping auto-attribution remain legitimate outcomes.

10. ~~**Does the user accept ~0.78 if no channel closes the gap?**~~ **ANSWERED
    2026-09-01 by the user, in the form of an instruction:** build it completely,
    ship it behind the existing off-by-default flag, and their own real session
    is the acceptance test. _"làm xong hoàn toàn tôi test thì có data thật."_

    **What must be said plainly alongside that.** On the bench, auto-attribution
    **does not reach the 0.85 bar** in any cell: campplus / cold / `assign` /
    k=2 reads prefix-locked **0.7849 clean** and **0.5887 far-field** at N=2, and
    D8 all-turns reads **0.7775-0.7846**. The feature is being built to be
    measured on real audio, not because the bench says it works. It stays behind
    `SPEAKER_EMBEDDING_ENABLED`, default off.

11. **Is the bench instrument sound?** **MEASURED AND ESCALATED, 2026-09-01** —
    `reports/measurement-260901-0740-m11-duration-control.md`. M11 held the trial
    population fixed and scored the same 3266 pairs at three lengths:

    | condition | 8.0s   | 3.0s   | 1.0s   | ratio     |
    | --------- | ------ | ------ | ------ | --------- |
    | clean     | 17.15% | 18.25% | 24.00% | **1.40x** |
    | far-field | 18.68% | 22.29% | 30.13% | 1.61x     |

    R = 1.40x lands inside the pre-registered undetermined band (1.25, 2.00), and
    the pre-registered response is to escalate rather than pick a branch. Both
    readings are supported by the same table: the response is real, monotone and
    ordered in both conditions (toward sound), yet it is **1.32x over the
    literature's own 1-3s span against a quoted 2-4x**, and 8 seconds of clean
    audio still leaves **17.15% EER** on a model published near 1% on its own
    domain (toward suspect).

    The most likely explanation is a **domain gap that duration cannot close** —
    which would leave P1's FAIL standing as a statement about this model on this
    corpus, and would predict the OQ9 result rather than merely coexisting with
    it. **That is a hypothesis this run did not test**, and adopting it silently
    is the exact move the pre-registration exists to block.

    **CLOSED SOUND, 2026-09-01, by M11b** —
    `reports/measurement-260901-0830-m11b-known-good-control.md`. The escalation
    was resolved by measurement rather than by judgement. The exact checkpoint
    publishes **1.16% EER on VoxCeleb1-O**, and Oxford's official trial list is
    still ungated, so the harness was scored against somebody else's number on
    somebody else's pairs:

    | arm                                | what it isolates                          | result                                     |
    | ---------------------------------- | ----------------------------------------- | ------------------------------------------ |
    | A — official pairs, full length    | embedder + EER routine                    | **1.35%** vs published 1.16%, 0.19pt apart |
    | B — our `build_trials`, same audio | our pair construction                     | **1.69%**, +0.35pt over arm A              |
    | A1 — official pairs at 1.0s        | the duration axis, on a corpus that works | **15.65%**, R = **11.64x**                 |

    Apparatus sound, pair construction sound, and the harness resolves duration
    enormously where the model works. **M11's flat Vietnamese curve is a fact
    about Vietnamese, not about the instrument. P1's FAIL stands.**

12. **Turn length, not language, is the dominant error term** [measured
    2026-09-01, M11b arm A1]. Not a question — a finding that reframes the
    plan's search, recorded here because it arrived with OQ11's answer.

    |                                    | full length | 1.0s       |
    | ---------------------------------- | ----------- | ---------- |
    | VoxCeleb1-O (English, studio)      | 1.35%       | **15.65%** |
    | VoxVietnam (Vietnamese, broadcast) | 17.15% @ 8s | **24.00%** |

    Full length -> one second costs **+14.3 points on English**. English ->
    Vietnamese at one second costs **+8.4 more**. This plan has treated the
    corpus and the channel as the problem throughout; they are the _second_
    problem.

    **Three consequences.**

    - **The largest measured lever cannot be pulled.** `TURN_S = 1.0` came from
      M1's measured production median of 1065ms — how people talk to an
      interpreter, not a parameter. (And M1 was a solo voice-off sitting, so
      even that number is unverified — which makes it now the single most
      expensive unverified number in the plan.)
    - **What is already carrying the feature is evidence accumulation across
      turns.** It is why session prefix-locked accuracy reads 0.78 while the
      one-second pairwise cell reads 24% EER. Everything else is second order.
    - **P2 can no longer be the explanation.** It stays the only real-channel
      measurement and is still worth running, but 15.65% of the error appears on
      clean English studio audio with no channel effect at all. Its remaining
      value is the turn-switch rate and the language mix (OQ9) — not the channel
      delta it was designed around.

13. **A person's rejection is terminal against the machine.** **DECIDED
    2026-09-01**, during code review, because the implementation had it wrong.

    `unattributeTurn` records "nobody here said this". That row is **not
    rendered**, so the rendered-is-final rule of OQ2 did not protect it, and the
    acoustic layer re-applied the label the person had just thrown away — on the
    next embedding, and again at settle. Rejecting a suggestion is also the only
    evidence this design collects that suggestions are _not_ working, so the bug
    deleted the measurement as well as the choice.

    Two changes: `unattributeTurn` now always writes an explicit row (a missing
    row means nobody decided; an explicit `fallback` row means somebody did), and
    a second predicate `isHumanTouched` guards every automatic write. This is the
    question `phase-03` raised as "`origin !== 'confirmed'` is necessary and
    **not sufficient**" and left open.

14. **M12, M13 and M14 were not run, and here is the reasoning rather than a
    silent omission.**

    - **M13 — settled-label accuracy.** Its subject, the settle pass, is not
      shipped (OQ2). Its _governing metric_ — accuracy over all turns under
      defer-then-backfill — is already measured: **D8 all-turns
      0.7775 / 0.7773 / 0.7846** at 10/20/40 turns, with the tail filled by the
      nearest-centroid argmax, which is exactly the mechanism that shipped.
      Re-running it would re-measure an answered question.
    - **M12 — same-channel imposter EER.** It existed to produce evidence about
      instrument health and the channel. M11b settled instrument health
      decisively, and M11b arm A1 showed the channel is **not** the dominant
      term: 15.65% EER appears on clean English studio audio with no channel
      effect at all. It would now buy a number with no decision attached.
    - **M14 — AS-norm.** The one with a live decision, and the reason it is
      deferred rather than dismissed: M11b showed threshold transfer is severe
      across duration (clean threshold 0.335 -> 0.264 -> 0.192 over 8s / 3s /
      1s), which is what AS-norm is aimed at. But adopting it in the client means
      shipping an impostor cohort to the browser — a payload and a design that
      belong to their own slice, not to a rescore. **It is the strongest
      candidate for the next measurement slice**, and it cannot change what
      ships today.

    If the real-data test says the thresholds are wrong, M14 is where to start.

## Validation Log

### Session 1 — 2026-08-30 (post red-team round 2)

**Questions asked:** 6. **Verification pass:** skipped per the workflow guard —
`## Red Team Review` already carries file:line evidence from two sessions, and no
`[UNVERIFIED]` tags remain. **Failed: 0.**

| #   | Decision                                                                                                                  | Consequence                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V1  | **`suggestSpeaker` / `buildCentroids` / `TAU_SUGGEST` do NOT survive.** `OnlineAttributor` is the sole attribution writer | P3 shrinks from ~3d to ~1d: authority table, tombstone, and the `attribution-stats` roster guard only. The three symbols become dead code and leave the barrel. **The confirmed-only centroid rule goes with them, so P3 must re-argue self-reinforcement for machine ordinals rather than inherit the old proof** |
| V2  | **Rename moves to the chip.** `SpeakerRoster` leaves the live flow entirely                                               | The chip already owns a picker; rename joins it. P3's commit-on-blur debounce relocates from `speaker-roster.tsx:75-77` to the chip. P6-S2 gets a real denominator                                                                                                                                                 |
| V3  | **`K_max` binds the machine mint path only.** The human "add speaker" action is not capped by it                          | A person knows how many people are in the room; the machine does not. D5's count guarantee is scoped to machine-generated ordinals and asserted that way                                                                                                                                                           |
| V4  | **NO-CONFIG at N=2 reads UNDETERMINED, not FAIL.** Re-run with a loosened count constraint and report both                | NO-CONFIG means the grid found no point satisfying both calibration constraints — not that the mechanism failed. D6 does the judging at evaluation time, where it belongs                                                                                                                                          |
| V5  | **Decouple `MIN_CLIPS` from `MEETING_TURNS`.** Sample turns with replacement from a fixed pool, `MIN_CLIPS = 8`           | M8 becomes comparable to M2/M9 because the 30-speaker pool stops moving. Cost: repeated clips within a session, so the drift curve may read optimistic — stated beside every M8 number                                                                                                                             |
| V6  | **Delete the `cascade-panel` stats readout** (`:194-211`) and its two i18n keys                                           | It was written for a product with taps. Under zero-manual "đã đánh dấu" is 0 by design, so a successful 20-turn session would render as total failure on screen during P6's own observation window                                                                                                                 |

**Note on V1 and V3 together:** V1 makes P4's attributor the only machine writer,
and V3 keeps the human add path outside `K_max`. So the roster can still hold more
speakers than `K_max` — by human action only. P4 must assert that distinction
rather than treat the two ceilings as one.

### Whole-Plan Consistency Sweep — validation session 1

- **Files reread:** `plan.md` and all six `phase-*.md`
- **Decision deltas checked:** 6
- **Reconciled stale references:** 5 — P3 Step 0 resolved to V1 and its scope cut;
  P3's `TAU_SUGGEST` export question closed; P4's rename fork resolved to V2;
  P4's `K_max`-vs-human question resolved to V3; P1's M8 and NO-CONFIG items
  resolved to V5 and V4; P6's readout question resolved to V6
- **Unresolved contradictions:** 0

## Red Team Review

### Session — 2026-09-01 (against the 2026-09-01 amendment)

**Findings:** 38 raw → 15 after dedupe (0 rejected by the evidence filter — every
finding carried `file:line` citations)
**Severity:** 15 Critical, ~8 High folded into the corrections
**Reviewers:** Security Adversary (Fact Checker), Assumption Destroyer (Scope
Auditor), Failure Mode Analyst (Flow Tracer), Scope & Complexity Critic (Contract
Verifier)

**Outcome: the amendment's three load-bearing premises were all false.** They are
corrected in "Correction stratum" above, verified independently against the repo
before acceptance. This session found more in the _new_ material than in the old.

| #   | Finding                                                                                                                                        | Sev  | Disposition | Applied to           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------- | -------------------- |
| 1   | Production metrics sink enabled for M1; output git-tracked with `sessionId` + epoch timestamps; P1 has no consent/retention/teardown criterion | Crit | Accept      | Constraint 15        |
| 2   | Every `online.py` citation ~120 lines stale; "`K_max` cannot bound assignment" is false — `abstain`/`raise_tau` implemented and validated      | Crit | Accept      | C1, D5, P3, P4       |
| 3   | "Same-channel imposter cannot be constructed" false — one `RoomConfig()`, one RIR for all clips; far-field duration slope is confounded        | Crit | Accept      | C2, P2, P7           |
| 4   | P8 premise false — `embedSpeaker` starts eagerly beside the translation; no budget exists to free                                              | Crit | Accept      | C3, P8 withdrawn     |
| 5   | P8 also harmful — sequential per-clause TTS delays the vector by seconds; `registry.holds` drops it on stop-mid-delivery, breaking D8          | Crit | Accept      | P8 withdrawn         |
| 6   | P2 Step 2 instructs adding a 5s bucket that raises `KeyError` — after the one-shot fixture is spent                                            | Crit | Accept      | P2                   |
| 7   | All four new P2 protocol additions unrunnable — harness raises on any rate ≠ 16000; `Turn` has no `language` field                             | Crit | Accept      | P2                   |
| 8   | M13 is a re-run, not a rescore — `settle()` needs vectors, the M9 CSVs are aggregates; corpus absent on this host                              | Crit | Accept      | P7, effort 4d → 6d   |
| 9   | M13 bar mixed denominators — recorded accuracy is attributed-only, D8 forces coverage to 1.0                                                   | Crit | Accept      | P7                   |
| 10  | Settle pass was rejected on **merge**; M13's bar excluded merge, so it could reinstate the rejected component                                  | Crit | Accept      | P7 (conjunctive bar) |
| 11  | D8 back-fill has no trigger on socket drop, tab close, or the last 1-3 turns of every session                                                  | Crit | Accept      | P4                   |
| 12  | M11 kill rule compared different populations (80/76/74 speakers) and violated bench Rule 2 — likely to fire spuriously and stop the slice      | Crit | Accept      | P7 (3 outcomes)      |
| 13  | P6 fork rule keyed on a number no phase produces; `[0.80, 0.85)` unmapped where the measured values sit                                        | Crit | Accept      | P6                   |
| 14  | M9's `abstain`/`raise_tau` arms are `NO-CONFIG` on every split — P4 Step 0 has no input and P4's own stop rule already fired unrecorded        | Crit | Accept      | D5, P4               |
| 15  | P3 never amended for D8 — no pending state to arbitrate; the file predates the whole stratum                                                   | Crit | Accept      | P3                   |

**High findings folded into the corrections rather than tabled separately:**
`plan.md`'s Overview still stated the abstain design; the "Open questions" section
D8 referenced did not exist (now written, 7 entries); the R1-R5 labels used
throughout P7 were never defined (replaced with constraint numbers); D9's "85%"
had no derivation (downgraded to an open question); "0/3 on all seven arms" was
false (the clean cell PASSes); `AttributionOrigin`'s "compile-time forcing
function" covers 1 of 9 consumer sites; P5's sha256 criterion did not cover the
production downloader; the `ordinal`/`SessionSpeaker` consumer count was wrong and
omitted a `packages/realtime-client` spec.

**One finding is out of scope for this plan and should be filed separately:**
`LocalSpeechEmbeddingProvider.embed` has no timeout and no `AbortSignal`
(`local-speech-embedding-provider.ts:52`); a hung sidecar permanently leaks a
turn-registry slot, and six exhaust `MAX_CONCURRENT_TURNS_GLOBAL` on an
unauthenticated endpoint. Recorded in the withdrawn P8 file.

### Whole-Plan Consistency Sweep — 2026-09-01

Swept all 9 files. Reconciled: abstention promises (P4 criteria, P6 S4 prose and
success criterion, plan Goal 5), stale `online.py` anchors (P3 ×2, P4, plan ×4),
the 5s bucket instruction (P2 Step 2 + Related Code Files), the C2 claim (P2
second promotion, P7 requirements/steps/risk row), and the R1-R5 labels (P7 ×10).

**Unresolved contradictions: 2**, both now recorded as open questions rather than
hidden — the monotone merge invariant vs. a from-scratch settle pass (open
question 2), and non-interactive pending chips vs. a testable human-edit-while-
pending rule (open question 5). **The plan is not ready for `/ak:cook` until both
are decided.**

### Session — 2026-08-30 (pre-reversal; findings still binding)

**Findings:** 37 raw → 15 accepted (0 rejected on merit; 1 rejected by evidence filter)
**Severity:** 8 Critical, 7 High
**Reviewers:** Security Adversary (Fact Checker), Failure Mode Analyst (Flow Tracer), Assumption Destroyer (Scope Auditor), Scope & Complexity Critic (Contract Verifier)

| #   | Finding                                                                                                                                                                                               | Severity | Status after reversal                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Bench session arm mints, folds and post-hoc remaps — mechanisms the product forbids; product cold is silence, not 78.3%                                                                               | Critical | **Partly dissolved.** Minting and folding are now the requested product. The remap objection **survives** — see "The Hungarian remap" above |
| 2   | Δ-as-offset is the arithmetic `run_channel_delta.py:52-56` forbids                                                                                                                                    | Critical | Fully binding, unchanged                                                                                                                    |
| 3   | Enrollment has no wire path — `/embed` is loopback-bound                                                                                                                                              | Critical | Binding, **re-scoped**: now constrains any seeded-centroid design (P1-M6), not an enrollment UI                                             |
| 4   | `probe_enrollment_identification.py` re-embeds and is not a cache consumer; corpora/models/fixtures absent on this host                                                                               | Critical | Fully binding, unchanged                                                                                                                    |
| 5   | Consent and retention are prose, not success criteria                                                                                                                                                 | Critical | Fully binding, unchanged                                                                                                                    |
| 6   | `SPEAKER_BENCH_REQUIRE_PARITY=1` is read only by pytest; `run_channel_delta.py` always exits 0                                                                                                        | Critical | Fully binding, unchanged                                                                                                                    |
| 7   | Widening `MEETING_SIZES` shifts the shared RNG stream and the `min()` eligibility floor                                                                                                               | Critical | Fully binding, **now urgent** — P1 adds size 2                                                                                              |
| 8   | Enrollment-as-`confirmed` makes a speaker unremovable and inflates the tap-rate gate                                                                                                                  | Critical | **Re-scoped.** No enrollment ships; the tap-rate gate is void entirely (P6)                                                                 |
| 9   | Production enables three DSP stages; nothing pins 48 kHz                                                                                                                                              | High     | Fully binding, unchanged                                                                                                                    |
| 10  | Centroid growth does not saturate at 4 — it reverses at 5 on a shrinking sample                                                                                                                       | High     | Fully binding, unchanged                                                                                                                    |
| 11  | Transfer-loss figures come from the superseded margin-0.08 run and are circular                                                                                                                       | High     | Fully binding — Constraint 12                                                                                                               |
| 12  | Re-score trigger list omits `server.turn.embedding`, includes the inert `speakerRenamed`                                                                                                              | High     | Fully binding, unchanged                                                                                                                    |
| 13  | `Record<AttributionOrigin, string>` is exhaustive; `apps/extension` is a second reducer consumer                                                                                                      | High     | Fully binding — Constraints 6 and the extension non-goal                                                                                    |
| 14  | `canRemoveSpeaker` is public API; `removeSpeaker` cannot clear attributions; the ratio gate is undefined at a zero denominator                                                                        | High     | Binding; the zero-denominator half is now **certain**, not hypothetical (P6)                                                                |
| 15  | Phase 2/5 harness gaps: missing Δtop-1 and cosine-loss outputs, no 5s bucket, impossible constraint import, `CANDIDATES` registry omitted, no download checksum, licence absent from the adoption bar | High     | Fully binding; the licence sub-item relaxes under D7 but stays recorded                                                                     |

**Rejected by evidence filter:** the claim that `chatofy_prod-local-stt` is undefined — verified as the compose image name from `docker-compose.prod.yml:214` under project `chatofy_prod`.

### Session 2 — 2026-08-30 (post-reversal)

**Findings:** 39 raw → 15 accepted after dedup (0 rejected on merit; 0 failed the evidence filter)
**Severity:** 5 Critical, 10 High
**Reviewers:** Security Adversary (Fact Checker), Failure Mode Analyst (Flow Tracer), Assumption Destroyer (Scope Auditor), Scope & Complexity Critic (Contract Verifier)
**Convergence:** 4/4 reviewers independently found #1 and #3; 3/4 found #6, #7, #9, #10.

| #   | Finding                                                                                                                                                                                                                                                     | Severity | Disposition | Applied To             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------- | ---------------------- |
| 1   | `K_max` is measured by no arm, yet P1's go/no-go gates on the unbounded mechanism — and Step 10 recommends `K_max` _after_ the verdict                                                                                                                      | Critical | Accept      | Phase 1 (M9), Phase 4  |
| 2   | ~~`K_max` bounds creation only; `online.py:125` assigns first, so above the cap the product misattributes at 64.9%, not abstains~~ **RETRACTED 2026-09-01 (C1): false.** Citation was ~120 lines stale; `abstain`/`raise_tau` are implemented and validated |          | Critical    | Accept                 | plan.md D5, Phase 4 Mechanism |
| 3   | P3's safety argument is void under zero-manual (`buildCentroids` confirmed-only ⇒ empty map), and three writers share one map with no arbitration                                                                                                           | Critical | Accept      | Phase 3, Phase 4       |
| 4   | The "no chip" state is `fallback`, which renders a tappable "Ai đã nói?" — the manual flow the user rejected                                                                                                                                                | Critical | Accept      | Phase 4                |
| 5   | P6's S2 reproduces the zero-denominator defect that voided `TAP_RATE_FLOOR`: it counts renames, and P4 deletes the only rename UI                                                                                                                           | Critical | Accept      | Phase 4, Phase 6       |
| 6   | No ordinal exists in state — it is an interpolated string built in `apps/web`; renumbering is a public type change and the label ships as English "Speaker 1"                                                                                               | High     | Accept      | Phase 4                |
| 7   | Removing `SpeakerRoster` deletes the only rename surface — the human signal P3 protects and S2 reads                                                                                                                                                        | High     | Accept      | Phase 4                |
| 8   | The ported attributor's cluster state has no declared lifetime; `transcript.reset` fires on every `start()`, and the extension shares one module literal                                                                                                    | High     | Accept      | Phase 4                |
| 9   | M1 reads `audioMs` (whole buffer + 320ms pre-roll + swallowed pauses), needs the flag P6 must earn, and `capturedMs`/`heldMs` already ship unconditionally                                                                                                  | High     | Accept      | Phase 1                |
| 10  | M8 needs 23 clips/speaker against `MAX_CLIPS_PER_SPEAKER = 12`; `MIN_CLIPS` silently re-draws the speaker pool                                                                                                                                              | High     | Accept      | Phase 1                |
| 11  | `centroid_cap` **freezes** after k turns rather than tracking; P4 pre-committed to shipping non-`None` regardless of M3                                                                                                                                     | High     | Accept      | Phase 1, Phase 4       |
| 12  | The settle pass has no valid trigger (no pause exists; `server.session.ended` is per-turn) and is an unmeasured second clustering algorithm                                                                                                                 | High     | Accept      | Phase 1 (M10), Phase 4 |
| 13  | Embeddings arrive in completion order with `MAX_IN_FLIGHT = 3`, against a greedy order-dependent attributor                                                                                                                                                 | High     | Accept      | Phase 4                |
| 14  | The recorder commits device fingerprints and timestamps — `.gitignore` re-includes `fixtures/**/*.json`; the retention decision cannot reach git history                                                                                                    | High     | Accept      | Phase 2                |
| 15  | `COUNT_ERROR_MAX` also constrains `calibrate()`; the script's gate cell and exit code still point at warm N=5; P2's 5s bucket raises `KeyError` and the verdict is hardcoded to bucket 2.0                                                                  | High     | Accept      | Phase 1, Phase 2       |

**Over the 15-cap, accepted and applied anyway** (they were cheap and adjacent):
the RNG hazard was prescribed against `run_session.py`, which is safe — the hazard
is in `probe_enrollment_identification.py` only, and the byte-identical assertion
must run against the **existing** cache before any rebuild; P3's two ordinal
invariants ("1..k no gaps" and "no reuse of a retired number") are jointly
unsatisfiable; P6 under-enumerated `TAP_RATE_FLOOR`'s consumers (barrel, spec pin,
`AttributionStats` type, `cascade-panel.tsx:194-211`, both i18n dictionaries).

**Corrections to this plan's own claims, found by the reviewers:**

- "Auto-minting in the reducer reaches the extension regardless of whether it
  asks" — **false**. `grep embedSpeaker apps/extension/src` returns nothing, and
  the server emits `server.turn.embedding` only to clients that opt in
  (`translation-session.service.ts:294-295`). The extension is unreachable today;
  the real hazard is the shared module literal, which stands regardless.
- P2 cited `recorder/index.html:328` for `new AudioContext()`; the actual line is
  `:292`.
- P2's "Phase 1 measures `(2.0, 5.0)`" matches no Phase 1 cell — Phase 1 now runs
  at the single `TURN_S` M1 selects.
- P3's "every machine-assigned turn is attributed the instant its transcript
  lands" contradicts `turn-keyed-transcript.ts:435-449`, where the
  `server.transcript.final` case never touches `attributions`.

### Whole-Plan Consistency Sweep — session 2

- **Files reread:** `plan.md`, `phase-01-measure-target-cells.md`,
  `phase-02-channel-delta-gate.md`,
  `phase-03-attribution-authority-state-machine.md`,
  `phase-04-bounded-k-auto-attribution.md`, `phase-05-bounded-model-screen.md`,
  `phase-06-ship-decision.md`
- **Decision deltas checked:** 15 accepted findings + 3 over-cap + 4 self-corrections
- **Reconciled stale references:** 7 —
  the go/no-go moved from M2 to M9 (phase-01);
  P2's "Phase 1 measures `(2.0, 5.0)` / add a 5s bucket / ≥40 turns per bucket"
  block superseded, and the matching success criterion and recording requirement
  rewritten to match (phase-02, three places);
  P2's retention scope in Requirements widened to include git history, matching
  its success criterion (phase-02);
  the `new AudioContext()` citation corrected `:328` → `:292` (phase-02);
  P3's two contradictory ordinal criteria replaced by the identity/ordinal split
  (phase-03).
- **Unresolved contradictions:** 0

Note that several phases now carry explicit "an earlier draft said X — that is
withdrawn" blocks. These are intentional: the superseded claim is named so a
future reader can tell a correction from an omission.

### Amendment sweep — 2026-08-30 (premise reversal)

- Overview headline replaced: the withdrawn "78.3 → 92.5" note is superseded by
  the 4/12/8 cold tally, which is the honest version of the same warning.
- D4 struck (enrollment skippable → enrollment absent). D5, D6, D7 added.
- Non-goal "auto-minting stays a human act" **struck** — overturned by the user.
  The `tau_new` sweep that priced it (`results/guest.log`) is retained as a
  **cost** in P4, not as a prohibition.
- P4 renamed and rewritten: enrollment + roster closure → bounded-K
  auto-attribution + settle pass. Roster closure survives as `K_max` — the same
  idea with the human removed.
- P6's `TAP_RATE_FLOOR` gate voided (zero taps ⇒ zero denominator) and replaced.
- Constraints 4, 7, 9, 13 added; Constraint 10 (licence) resolved by D7.
- The Hungarian-remap position moved from a blanket withdrawal to a split ruling,
  with a prefix-locked scorer as the operational consequence.

<!-- slug: speaker-attribution-channel-gate-and-decision-layer -->
