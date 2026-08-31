---
title: 'Speaker attribution: bounded-K auto-detect, channel gate and decision layer'
description: "Deliver zero-manual speaker attribution with anonymous ordinal labels, bounded by a measured speaker-count ceiling and honest abstention above it. Gated on measuring the product's real turn duration, the N=2 cell, and the browser-DSP channel — in that order, before any product code."
status: pending
priority: P1
effort: '~9-11d + one recording session (P3 −2d by V1, P4 +2d by red team)'
tags: [speaker-attribution, benchmarks, realtime-client, cpu, zero-manual]
created: 2026-08-30
updated: 2026-08-30
---

# Speaker attribution: bounded-K auto-detect, channel gate and decision layer

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
3. **`centroid_cap` was never swept.** It exists (`online.py:91`), is honoured
   (`:126`), and its docstring calls the right value _"an empirical question the
   session bench answers."_ `run_session.py` never passes it. Every published
   cold number, including the 83%→71% within-session decay, is the **uncapped**
   baseline.

And one design change removes the failing metric by construction rather than
tuning against it: **bound the cluster count.** Above `K_max`, stop minting and
abstain. At `K_max = 2` a two-person conversation cannot render four chips — that
is arithmetic, not statistics.

## Decisions (settled — do not relitigate)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Consequence                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| D1  | The channel-delta recording session **is runnable**; 3-5 people available                                                                                                                                                                                                                                                                                                                                                                                        | P2 stays the hard gate                                                                  |
| D2  | A human edit is **terminal**. The machine may renumber or merge non-confirmed rows; it may never touch a row the user has touched                                                                                                                                                                                                                                                                                                                                | P3's authority table; enables the settle pass                                           |
| D3  | Real meeting size is **2-3 people**, not 5                                                                                                                                                                                                                                                                                                                                                                                                                       | **Now the gate.** N=2 is the primary cell; N=5 is reported, never gated                 |
| D4  | ~~Explicit enrollment must be skippable~~ — **SUPERSEDED.** Enrollment is **absent** from the live flow                                                                                                                                                                                                                                                                                                                                                          | P4 no longer ships an enrollment ritual. `seed` survives only as a measured arm (P1-M6) |
| D5  | **Bounded speaker count.** `K_max` set to the largest N the measurement supports. **Restated after red team:** `K_max` bounds the chip _count_, not the _error_. It can only guard cluster creation — `online.py:125` runs the assign branch first — so above the cap a turn is folded into the nearest existing ordinal at a measured **64.9%** theft rate (`guest-summary.csv`), not left blank. The above-cap policy is **P1-M9's output**, not an assumption | P4's core mechanism below the cap; above it, see P4 "Mechanism"                         |
| D6  | **Bars tightened at N=2.** accuracy ≥ **0.85** (chance is 0.50 at N=2, and a swapped chip in a _translation_ app puts the counterpart's words in the user's mouth); **exact-count rate ≥ 0.90** replaces `\|dN\| ≤ 1.0`                                                                                                                                                                                                                                          | P1's bars. See "Why the inherited count bar is degenerate at N=2"                       |
| D7  | **Chatofy is a non-commercial graduation project.** `cc-by-nc-4.0` corpora are usable for evaluation without reservation                                                                                                                                                                                                                                                                                                                                         | Unblocks the measurement program. P5's licence condition relaxes to "NC permitted"      |

## Why the inherited count bar is degenerate at N=2

`COUNT_ERROR_MAX = 1.0` (`run_session.py:54`) was written for N=3 and N=5. At
N=2 it is not merely loose, it is **wrong in the dangerous direction**: a session
that collapses both people into **one** cluster scores `|dN| = 1` and **passes**.
The worst possible product outcome — a two-person conversation rendered as one
person talking to themselves — clears the bar.

`SessionScore.speaker_count_error` is computed as `clusters - true_speakers`
(`online.py:163-164`) and `run_session.py:200` discards the sign with `abs()`.
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

`score_session` calls `linear_sum_assignment` (`online.py:199`) on the
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
   `online.py:187` before `linear_sum_assignment` runs at `:199`. **The one bar
   that fails is the one the oracle does not flatter.**
2. Published cold accuracies remain **upper bounds even for the anonymous
   product**. P1-M4 adds a prefix-locked scorer (cluster → ordinal fixed at
   creation, no ground truth) and **the ship decision uses that number**. The gap
   between the two is the size of the oracle, and it has never been computed.

The earlier plan's rule survives intact: _an oracle number is a ceiling, never a
result._

## Goals

| #   | Goal                                                                                           | Priority |
| --- | ---------------------------------------------------------------------------------------------- | -------- |
| 1   | Measure the product's real turn duration, then the N=2 cold cell, in that order                | P1       |
| 2   | Measure whether anything arrests the within-session cold decay (`centroid_cap`, deferred mint) | P1       |
| 3   | Measure the browser-DSP channel delta; return a verdict                                        | P1       |
| 4   | Make attribution authority explicit; permit machine renumbering, forbid touching human edits   | P1       |
| 5   | Ship bounded-K auto-attribution with ordinal labels and honest abstention above the cap        | P1       |
| 6   | Close the "add a model" axis on measurement                                                    | P3       |
| 7   | Flip the flag only against production evidence                                                 | P2       |

## Phases

| #   | Phase                                                                                             | Status                                                                |
| --- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | [Phase 1: Measure the auto-attribution mechanism](./phase-01-measure-target-cells.md)             | **Measured — cold arm FAILS at the real 1.0s turn length, every arm** |
| 2   | [Phase 2: Channel delta gate](./phase-02-channel-delta-gate.md)                                   | Pending                                                               |
| 3   | [Phase 3: Attribution authority state machine](./phase-03-attribution-authority-state-machine.md) | Pending                                                               |
| 4   | [Phase 4: Bounded-K auto-attribution and settle pass](./phase-04-bounded-k-auto-attribution.md)   | Pending                                                               |
| 5   | [Phase 5: Bounded model screen](./phase-05-bounded-model-screen.md)                               | **Completed** — axis closed, campplus stays                           |
| 6   | [Phase 6: Ship decision](./phase-06-ship-decision.md)                                             | Pending                                                               |

Dependencies: P1 → P2 → P3 → P4 → P6. **P5 runs in parallel with P1-P2 and is
abandonable at any point.**

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
- [ ] Above `K_max`, turns render **no chip** — never an invented one (P4)
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

| #   | Finding                                                                                                                                                                                    | Severity | Disposition | Applied To                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------- | ----------------------------- |
| 1   | `K_max` is measured by no arm, yet P1's go/no-go gates on the unbounded mechanism — and Step 10 recommends `K_max` _after_ the verdict                                                     | Critical | Accept      | Phase 1 (M9), Phase 4         |
| 2   | `K_max` bounds creation only; `online.py:125` assigns first, so above the cap the product misattributes at 64.9%, not abstains                                                             | Critical | Accept      | plan.md D5, Phase 4 Mechanism |
| 3   | P3's safety argument is void under zero-manual (`buildCentroids` confirmed-only ⇒ empty map), and three writers share one map with no arbitration                                          | Critical | Accept      | Phase 3, Phase 4              |
| 4   | The "no chip" state is `fallback`, which renders a tappable "Ai đã nói?" — the manual flow the user rejected                                                                               | Critical | Accept      | Phase 4                       |
| 5   | P6's S2 reproduces the zero-denominator defect that voided `TAP_RATE_FLOOR`: it counts renames, and P4 deletes the only rename UI                                                          | Critical | Accept      | Phase 4, Phase 6              |
| 6   | No ordinal exists in state — it is an interpolated string built in `apps/web`; renumbering is a public type change and the label ships as English "Speaker 1"                              | High     | Accept      | Phase 4                       |
| 7   | Removing `SpeakerRoster` deletes the only rename surface — the human signal P3 protects and S2 reads                                                                                       | High     | Accept      | Phase 4                       |
| 8   | The ported attributor's cluster state has no declared lifetime; `transcript.reset` fires on every `start()`, and the extension shares one module literal                                   | High     | Accept      | Phase 4                       |
| 9   | M1 reads `audioMs` (whole buffer + 320ms pre-roll + swallowed pauses), needs the flag P6 must earn, and `capturedMs`/`heldMs` already ship unconditionally                                 | High     | Accept      | Phase 1                       |
| 10  | M8 needs 23 clips/speaker against `MAX_CLIPS_PER_SPEAKER = 12`; `MIN_CLIPS` silently re-draws the speaker pool                                                                             | High     | Accept      | Phase 1                       |
| 11  | `centroid_cap` **freezes** after k turns rather than tracking; P4 pre-committed to shipping non-`None` regardless of M3                                                                    | High     | Accept      | Phase 1, Phase 4              |
| 12  | The settle pass has no valid trigger (no pause exists; `server.session.ended` is per-turn) and is an unmeasured second clustering algorithm                                                | High     | Accept      | Phase 1 (M10), Phase 4        |
| 13  | Embeddings arrive in completion order with `MAX_IN_FLIGHT = 3`, against a greedy order-dependent attributor                                                                                | High     | Accept      | Phase 4                       |
| 14  | The recorder commits device fingerprints and timestamps — `.gitignore` re-includes `fixtures/**/*.json`; the retention decision cannot reach git history                                   | High     | Accept      | Phase 2                       |
| 15  | `COUNT_ERROR_MAX` also constrains `calibrate()`; the script's gate cell and exit code still point at warm N=5; P2's 5s bucket raises `KeyError` and the verdict is hardcoded to bucket 2.0 | High     | Accept      | Phase 1, Phase 2              |

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
