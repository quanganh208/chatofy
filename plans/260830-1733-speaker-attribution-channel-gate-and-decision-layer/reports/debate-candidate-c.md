---
type: debate-candidate
candidate: C
date: 2026-09-01
question: 'OQ9 — what fills the ~35% of turns the acoustic layer cannot attribute?'
recommendation: 'Fill by deadline with a fused decision layer whose channels are ranked by cost: the acoustic margin already computed and discarded, then a turn-order prior that reads no audio, then LID only if a pre-registered independence check clears it.'
verdict-shape: 'Conditional. The plan reduces OQ9 to two numbers nobody has measured, both cheap, and says what to do on each branch.'
---

# Candidate C — fill the tail by deadline, from channels ranked by cost, and measure the free one first

## Recommendation

The tail is not a mystery to be solved with a new model; it is a **decision that
is currently being thrown away**. `OnlineAttributor.observe` computes the best
centroid match and its score for every turn (`online.py:242-244`) and then
discards both when the turn falls in the dead zone (`:265`) or above the cap
under `abstain` (`:263`). Nobody has ever measured what that discarded argmax
scores on the tail — §8 unknown 5 confirms it, and §2.5 brackets it between a
blind guess (0.50) and a figure the packet itself calls not credible (0.73).
I therefore recommend a **decision layer that force-commits every deferred turn
at a bounded per-turn deadline**, fed by channels admitted in strict cost order:
**(1)** the acoustic margin that already exists and costs nothing, **(2)** a
conversational turn-order prior anchored on the app's own TTS playback
boundaries — the one channel that is independent of the tail's failure mode _by
construction_ rather than by hypothesis, since it reads no audio at all — and
**(3)** per-turn LID, whose implementation is gated behind the §4.3 independence
check and behind (1) and (2) failing. This satisfies **D8** outright and **D13**
for every turn except those deferred inside the deadline window before the user
presses stop (§"D13, precisely"). The decisive contribution below is not the
mechanism, it is the arithmetic: I decompose the measured §2.4 numbers on the D8
denominator and derive that **the fill must reach ≈0.72–0.75 accuracy**, and
that under a first-order turn-order model the prior alone reaches that iff the
real turn-switch rate exceeds **≈0.78–0.85**. OQ9 collapses to one production
number that P2 can measure for free.

---

## Phase 0 — Fix the denominator and derive the bar (no code, ~2h)

### Overview

Every prior round of this plan argued about mechanisms without a target. The
target is computable in closed form from numbers already measured, and it is the
thing that prices every option in §6.

### The arithmetic [derived from measured]

Under D8 coverage is 1.0 by contract, so overall accuracy on all turns is the
mixture of three populations, all three measured in packet §2.4:

```
overall = imm·acc_imm + res·acc_res + tail·a
```

where `a` is the accuracy of whatever fills the tail.

| turns/meeting | imm    | acc_imm | res    | acc_res | **tail**   | fixed part | **required `a` for 0.85** |
| ------------- | ------ | ------- | ------ | ------- | ---------- | ---------- | ------------------------- |
| 10            | 0.5968 | 0.9185  | 0.0937 | 0.7336  | **0.3096** | 0.6169     | **0.753**                 |
| 20            | 0.5811 | 0.9379  | 0.0680 | 0.7637  | **0.3509** | 0.5969     | **0.721**                 |
| 40            | 0.5881 | 0.9374  | 0.0644 | 0.7838  | **0.3475** | 0.6018     | **0.714**                 |

**Validity check.** Substituting `a = 0.50` reproduces the packet's own D8@0.50
column to four decimals: 0.7717 / 0.7724 / 0.7755 versus the packet's 0.7716 /
0.7724 / 0.7755. The decomposition is exact, not an approximation.

**Sensitivity [derived]:** at 20 turns, every +0.05 on the fill buys +0.0175
overall. Getting from a coin flip to the bar requires **+22 accuracy points over
chance on the hardest turns in the session**. That is the actual problem
statement, and no prior round has stated it.

**The bar is not a constant, because the tail is not a constant [measured +
guess].** Both the tail size and the fixed part are properties of the _channel_,
measured only in the synthetic far-field cell (packet C2 correction: one shared
`RoomConfig()`, one RIR). If P2's real microphone lands nearer the clean cell,
a plausible [guess] cell of imm 0.70 @ 0.94, res 0.10 @ 0.78, tail 0.20 gives a
fixed part of 0.736 and a **required `a` of 0.57** — which a barely-better-than-
chance filler clears. **P2 can move the bar by 18 points. Nothing here should be
frozen before it runs.**

### Requirements

- R0.1 Pre-register the cell, the attribution floor, the above-cap policy and
  the deadline _before_ any fill number is read. The floor sweep's own Limit 1
  says selecting a floor after seeing results is fitting; the same trap is open
  here at twice the width.
- R0.2 Publish the required-`a` table as the acceptance target for Phases B–D.
- R0.3 Restate the formula, not the constants, as the durable artifact — the
  constants are void if P7-M11 fails.

### Related files

- `benchmarks/speaker-id/run_session.py:71` (`ATTRIBUTION_FLOOR = 0.80`), `:95`
  (`CALIBRATION_MARGIN = 0.14`) — the two constants that set the tail's size.
- `plans/.../reports/measurement-260901-0110-above-cap-floor-sweep.md` — source
  of every number above.

### Success criteria

- A one-page pre-registration exists naming: cell, floor, `above_cap`, deadline
  `T`, and the required-`a` table, dated before Phase B runs.

### Risks

| Risk                                               | Signal                                                                        | Pre-decided response                                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| The 0.85 bar itself is the wrong bar (§6 option 6) | Required `a` lands above 0.85, i.e. the fill must be better than the _system_ | Escalate to user as a product decision, with this table as the evidence. Do not quietly lower it                                           |
| P7-M11 voids the constants                         | Instrument audit fails                                                        | The formula survives; re-run Phase 0 against the corrected numbers. Phases B–E are unchanged in shape (see §"If the instrument is broken") |

---

## Phase A — Gate on the instrument (blocking, no new work)

**P7-M11 must run before any number produced by Phases B–D is treated as a
verdict.** This phase is a dependency edge, not a work item: it exists so no
later phase can quietly proceed without it.

If M11 has not returned when Phase B is ready, Phase B still runs — it is a
_diagnostic_ under the same convention the floor sweep used (its Limit 5), it
writes nothing to `results/`, and its output is labelled provisional. What is
blocked is the **ship decision** and the **freezing of any threshold**, not the
measurement.

---

## Phase B — Measure the free baseline: force-assign the tail by acoustic argmax

### Overview

The cheapest experiment in the entire packet, and it can end the question. The
tail is defined as turns whose best centroid score failed to clear `tau_assign`.
But at N=2 with two centroids, "failed to clear a threshold" is not "carries no
information": `np.argmax(scores)` at `online.py:243` still ranks the two
speakers, and that rank is thrown away at `:263` and `:265`. Filling the tail
with that rank costs **zero new models, zero added milliseconds, zero new
dependencies, zero new privacy decisions**.

### Requirements

- RB.1 `Assignment` must carry the discarded candidate. Add one optional field;
  do not change `label`, since `Assignment.undecided` (`online.py:77-79`) and
  every scorer key off `label is None`.
- RB.2 The fill must be scored **prefix-locked, on the D8 denominator** —
  attributed = total, coverage = 1.0.
- RB.3 The fill must not create clusters (see the invariant below).
- RB.4 Report the _duration distribution_ of tail versus non-tail turns in the
  same run. Free, and it is the only cheap probe of constraint C13.

### Architecture

**The invariant that makes this safe, and it is provable from the code:**

> **The fill layer may only choose among clusters that already exist. It never
> creates one, and never renumbers a committed turn.**

Three consequences, each grounded:

1. **Speaker count cannot change.** `score_prefix_locked` counts clusters as
   `len({a.label for a in assignments if a.label is not None})`
   (`scoring.py:91`), and creation always emits a label (`online.py:280`), so
   every existing cluster already contributes. Filling adds no new label value.
   The measured exact-count of 0.9417→0.9742 is preserved **by construction**.
2. **The prefix lock is untouched.** `score_prefix_locked` fixes the
   cluster→speaker correspondence only on turns where `assignment.created` is
   true (`scoring.py:69`). A fill is never `created`, so it can never move a
   lock point.
3. **P3's monotone merge invariant holds**, for the same reason the packet
   credits the re-scoring mechanism with (§2.4): no merges, no renumbering.

This is why the fill layer is _not_ `settle()`. `settle` re-clusters from
scratch and re-imposes `k_max` via `fcluster(..., criterion="maxclust")`
(`settle.py:59-62`), which is exactly the merge M10 rejected.

**Deferral, and why it is not zero.** A pending turn waits for a deadline `T`
before being force-filled. `T = 0` (fill instantly) fully satisfies D13 with no
boundary case at all, and Phase B's number decides whether it is affordable:
deferral only buys the tier-2 resolution population (6.4–9.4% of turns at
`acc_res` 0.73–0.78). **If the argmax fill scores ≥ ~0.76, deferral buys
literally nothing** and `T = 0` is strictly better on D13 and on latency. The
reason to keep `T > 0` is not acoustic — it is that the turn-order prior in
Phase C needs the _right_ neighbour, which only exists one turn later.
Pre-registered default: **`T` = 1 committed turn or 4s wall-clock, whichever
first.**

### Related files

- `benchmarks/speaker-id/speaker_bench/online.py:62-79` (`Assignment`),
  `:242-265` (the decision branches that compute and discard the rank).
- `benchmarks/speaker-id/speaker_bench/scoring.py:38-98`
  (`score_prefix_locked`) — the scorer the fill must be reported through.
- `benchmarks/speaker-id/run_session.py:286` — where assignments are collected.

### Steps

1. Add `candidate: int | None = None` to `Assignment`. Populate it with `best`
   on the two undecided returns (`online.py:263`, `:265`). Default `None` keeps
   every existing call site byte-identical, matching the module's own stated
   discipline (`online.py:30-33`).
2. Extend the in-session re-scoring harness used for the §2.4 addendum with a
   deadline-fill step: at deadline, commit `candidate`.
3. Re-run the §2.4 cell (campplus / far-field / N=2 / cold / 1.0s, 400 meetings
   × 3 splits, 10/20/40 turns) and report **overall prefix-locked accuracy on
   all turns**, plus `a` for the tail alone.
4. Sweep `T ∈ {0, 1, 3, 6}` committed turns; report the D8-denominator accuracy
   at each. This turns the deadline from a guess into a measurement.
5. Emit tail-vs-non-tail duration percentiles.

### Success criteria

- `a_argmax` is measured, on all turns, at three session lengths — the number
  §8 unknown 5 says nobody has.
- The `T` sweep shows whether deferral pays at all.
- Duration split reported.

### The three branches, pre-decided

| Result                   | Meaning                                                     | Response                                                                                       |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `a_argmax ≥ 0.75`        | The tail is fillable from information already in the system | **Stop. Ship this.** No prior, no LID, no new model, no new cost. Phases C and D are cancelled |
| `0.60 ≤ a_argmax < 0.75` | Acoustic rank carries real but insufficient signal          | Proceed to Phase C; the prior is fused _on top of_ this, not instead of it                     |
| `a_argmax < 0.60`        | The acoustic channel is exhausted in the tail               | Proceed to Phase C, and promote Phase D's check to run in parallel rather than after           |

### Risks

| Risk                                                           | Likelihood × impact | Signal                                                                | Pre-decided response                                                                                                                                                                                                    |
| -------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tail is dominated by _long_ turns, not short ones          | Low × High          | Step 5's duration split shows tail p50 ≥ non-tail p50                 | C13 ("one turn = one speaker") is likely violated: long turns are carrying two voices and producing blended embeddings. That is a **segmentation** bug, not an attribution one, and it changes the whole plan. Escalate |
| `candidate` leaks into a consumer that treats it as a decision | Med × High          | A scorer's `attributed` count rises without a fill step               | `Assignment.undecided` stays keyed on `label` only (`online.py:77-79`); assert it in a test                                                                                                                             |
| Diagnostic mistaken for a measurement                          | Med × Med           | Constraint 11 (`SPEAKER_BENCH_REQUIRE_PARITY=1 pytest`) not run first | Run parity first, or stamp the output `diagnostic` as the floor sweep did                                                                                                                                               |

---

## Phase C — The turn-order prior, measured as a curve over the one unknown that governs it

### Overview

The prior's entire value is set by one number: **`p_switch`, the probability
that consecutive turns come from different speakers.** It is unmeasured in
production. This phase makes the dependence explicit rather than picking a value,
and identifies a zero-marginal-cost way to measure it.

**Why this channel and not LID first.** §4.3's objection to LID is that it reads
the _same audio_ under the _same duration and SNR degradation_ that made the
turn unattributable, so its errors may coincide with SV's. The turn-order prior
**reads no audio at all** — it reads other turns' committed decisions and the
clock. It is independent of the tail's failure mode by construction, where LID
is independent only by hypothesis. That is the ordering argument, and it does
not require any new evidence to make.

### The bench cannot currently measure this, and that is a finding

`run_session.py:128` offers exactly two orders: `shuffled` and `alternating`.
`build_schedule` (`:173-200`) implements the first as `rng.shuffle` over a flat
list (`:198-199`) — effectively `p_switch = 0.5` at N=2 — and the second as
strict round-robin `zip` (`:194-197`) — `p_switch = 1.0`. Both defaults are
`"shuffled"` (`:179`, `:218`), so **every number in the packet was measured with
no turn-order structure at all.**

Consequences, both of which would mislead a careless test:

- Testing the prior on `shuffled` scores it at **chance**, because there is no
  structure to exploit. It would look worthless.
- Testing it on `alternating` scores it near **perfect**. It would look magical.

Neither is the truth. The bench needs a third order: a first-order Markov chain
with a `p_switch` parameter.

### The closed form, before any code is written [derived from guess]

At N=2, with a MAP rule over a first-order Markov chain, and with both
neighbours of a pending turn committed:

- **Neighbours agree** (`A _ A`) — implies the other speaker with posterior
  `p²/(p² + (1−p)²)`. Strong.
- **Neighbours differ** (`A _ B`) — posterior 0.5. **Uninformative at N=2**, and
  this is not obvious: high alternation says "differs from both", which two
  speakers cannot satisfy.
- **One neighbour only** — posterior `p`.

The population-weighted accuracy given both neighbours works out to exactly `p`.
With committed-neighbour availability ≈ 0.65 (= imm + res, stable across all
three measured lengths) and independence, ≈12% of tail turns have no committed
neighbour and fall back to Phase B's argmax. That gives

```
a_prior  ≈  0.88 · p_eff  +  0.06 · (2 · a_argmax)      simplified: ≈ 0.88·p_eff + 0.06
```

| `p_switch` | prior-alone tail fill | clears required `a` (0.72–0.75)?   |
| ---------- | --------------------- | ---------------------------------- |
| 0.50       | 0.500                 | no (this is chance, as it must be) |
| 0.60       | 0.586                 | no                                 |
| 0.70       | 0.674                 | no                                 |
| 0.80       | 0.761                 | **yes**                            |
| 0.85       | 0.805                 | yes                                |
| 0.90       | 0.849                 | yes                                |
| 0.95       | 0.892                 | yes                                |

**Neighbour error correction.** Committed neighbours are themselves wrong ~6–7%
of the time (`acc_imm` 0.9185–0.9379). Effective `p_eff = p(1−e) + (1−p)e`; at
`e = 0.07` this costs ~4–5 points, moving the crossing point up.

**The single number OQ9 reduces to: the fill clears the bar iff real
`p_switch ≳ 0.78, and ≳0.82–0.85 once neighbour error is charged.** Fusion with
the acoustic margin only adds on top, so this is a conservative requirement.

Label discipline: the table is **[derived from guess]** — it assumes a
first-order chain, N=2, and independence between "is this turn in the tail" and
"do its neighbours happen to be committed". That last assumption is optimistic:
hard speakers plausibly produce _runs_ of pending turns, which raises the
no-neighbour fraction above 12%. Phase C measures the real figure and replaces
the estimate.

### How `p_switch` gets measured, at zero marginal cost

Three sources, in order of cost:

1. **P2's real-microphone recording — free.** P2 is already planned, one-shot,
   and will carry ground-truth speaker labels. Turn ordering is a byproduct of
   the labels it must produce anyway. **Add `p_switch` to P2's output schedule
   and it costs nothing.** This is the strongest sequencing argument in this
   plan.
2. **The in-session estimator — free and is what the product actually runs.**
   Estimate `p_switch` from consecutive _committed_ pairs within the live
   session, shrunk toward the pre-registered prior via a Beta prior. Needs no
   corpus, no logging, no persistence, no new privacy decision (C4, C5). At 20
   turns with 65% committed, ~7 adjacent committed pairs exist — thin, hence the
   shrinkage.
3. **Production turn-metrics — partial.** `TurnMetrics`
   (`apps/api/src/modules/translate/services/turn-metrics.recorder.ts:12`)
   already records per-turn `direction` (`:14`) and the TTS playback window
   (`translatedAtMs` `:62`, `firstAudioAtMs` `:64`, `lastAudioAtMs` `:66`), and
   the sink was already enabled once in production for M1. It gives inter-turn
   gaps and playback boundaries but **no speaker truth**, so it can characterise
   the _timing_ prior, not `p_switch` itself.

### The TTS-boundary channel

The app knows exactly when it played translated audio
(`packages/realtime-client/src/conversation/conversation-session.ts:460`,
`sounding: runtime.ownsEchoMeasurement ? undefined : () => playback.isPlaying`
— citation verified). In an interpreted dialogue the TTS _is_ the handover
signal: a turn beginning shortly after playback of a translation ends is far more
likely to be the party the translation was for. This is the app-specific asset
§4.2 identifies — Turn-to-Diarize had to _learn_ turn boundaries; here some are
given. It enters as a per-turn adjustment to `p_switch` (post-playback turns get
a higher switch prior), calibrated from the same P2 recording.

### Requirements

- RC.1 Add a parameterised Markov order to the bench. Default unchanged.
- RC.2 Report fill accuracy as a **curve over `p_switch`**, never a point.
- RC.3 The fused score must be a bounded log-odds sum, so the prior can never
  override a strong acoustic margin.
- RC.4 The prior must be **self-limiting**: monitor in-session agreement between
  the prior's prediction and _committed_ turns; if disagreement exceeds a
  pre-registered rate, shrink the prior's weight to zero for the rest of the
  session.
- RC.5 State the N=3 degradation explicitly (D3 says 2–3 people).

### Architecture

Per pending turn `t`, per candidate speaker `s`:

```
score(s) = w_a · (cos(v_t, c_s) − max_{s'≠s} cos(v_t, c_s'))   # Phase B's margin
         + clamp(w_p · logodds_prior(s | neighbours, p̂, TTS), ±L)
```

Commit `argmax_s score(s)` at deadline `T`. `w_a`, `w_p`, `L` are calibrated on
**calibration speakers only** and loaded as data, never hard-coded — so a
recalibration after P7-M11 or P2 is a config change, not a code change.

This is standard LLR fusion (§4.5), which the packet rates low-risk to
implement. What §4.5 says has no measured gain is fusing a _language posterior_;
fusing a _turn prior_ with acoustics is exactly what Turn-to-Diarize measured a
41% relative DER reduction for on the N=2 case (§4.2).

### Related files

- `benchmarks/speaker-id/run_session.py:173-200` (`build_schedule`), `:128`
  (`ORDERS`) — the only files needing a new order.
- `packages/realtime-client/src/conversation/conversation-session.ts:460` — the
  TTS boundary.
- `apps/api/src/modules/translate/services/turn-metrics.recorder.ts:12-66` — the
  timing instrument, already deployed.

### Steps

1. Add `order="markov"` with `p_switch` to `build_schedule`; keep `shuffled` the
   default so no existing number moves. Add a test asserting the realised switch
   rate matches `p_switch` within tolerance.
2. Implement the prior and the bounded fusion in the diagnostic harness.
3. Sweep `p_switch ∈ {0.5 … 0.95}` × `T ∈ {0,1,3}`; report D8-denominator
   accuracy and tail-only `a`.
4. Measure the realised no-committed-neighbour fraction (replaces the 12%
   estimate) and the pending-turn run-length distribution.
5. Implement the in-session `p̂` estimator; report the gap between using `p̂` and
   using the true `p_switch`. **That gap is the honest cost of not knowing `p`.**
6. Add `p_switch`, run-length, and post-TTS switch rate to P2's output schedule.

### Success criteria

- A published curve of D8-denominator accuracy versus `p_switch`.
- The measured crossing point where the fused fill reaches the Phase 0 bar.
- The in-session estimator's penalty versus an oracle `p`, measured.
- `p_switch` added to P2's schedule.

### Risks

| Risk                                    | Likelihood × impact | Signal                                         | Pre-decided response                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real `p_switch` is ≤0.70                | Med × High          | P2's labelled recording                        | The prior alone cannot reach the bar. Fall back to Phase B's number and escalate to Phase D / user                                                                                                                                                                                                  |
| Errors arrive in _runs_, not scattered  | **High × High**     | Consecutive filled turns sharing a wrong label | This is the prior's characteristic failure and it is worse UX than the same error rate scattered. Mitigated by RC.4's self-limiting monitor and RC.3's clamp `L`. Report block-error rate as a first-class metric, not just accuracy                                                                |
| Bench overstates the prior              | High × Med          | n/a — structural                               | `build_schedule` picks _which clip_ independently of order (`run_session.py:190-193`), so the bench has no correlation between position and turn content, which reality has (short backchannels follow long statements). Treat the bench curve as an **upper bound** and say so beside every number |
| N=3 breaks the inference                | Med × Med           | D3 admits 3 people                             | At N=3, "neighbours agree ⇒ the other one" is ambiguous between two others; the prior degrades toward the acoustic margin. Report the N=3 cell separately; do not average it into N=2                                                                                                               |
| A monologue stretch has locally low `p` | Med × Med           | Long same-speaker runs in committed turns      | The in-session estimator adapts but lags. Accept; report run-length sensitivity                                                                                                                                                                                                                     |

---

## Phase D — The LID independence check, before one line of LID code

### Overview

§4.3 states the shape this phase must have: the load-bearing assumption is
unverified, the indirect signal leans against it, and **neither assuming nor
discarding it is justified without the check**. This phase runs the check and
gates the implementation on it — and on Phases B and C failing, since LID is the
only option in §6 that costs a new model on a CPU box that is already
oversubscribed.

### What the check is, precisely

LID's value in production is a **product of two unmeasured factors**:

```
value(LID)  =  P(the two parties' languages differ)  ×  (1 − LID error on the tail)
```

- Factor 1 is §8 unknown 3. Unmeasured. If the parties often share a language,
  or code-switch (§4.4: no published Vietnamese code-switching rate for this
  population), LID names nobody.
- Factor 2 is §4.3's question. Measure LID error on **exactly the tail subset**
  versus the non-tail subset from the same run. The statistic is the **ratio**,
  not the absolute: if LID error on the tail is ≥ ~1.5× its error off the tail,
  the error surfaces coincide and LID guesses wrong in the same places.

**Methodological trap to avoid:** if the bench corpus is monolingual per speaker,
then language and speaker identity are trivially coupled and a naive "does LID
predict the speaker" test is circular. The valid question is only the **error
ratio**, which does not require language to be informative for speaker ID.

### A trap worth naming: the system looks like it already has language, and does not

`SttTranscriptResult` carries a `language` field
(`packages/ai-providers/src/interfaces/stt-provider.ts:12-14`). It is **not a
detection**. `local-speech-stt-provider.ts:75` returns
`{ text: json.text, language }` where `language` is the _request_ parameter
(`:42`), and the translate path resolves source language from a configured
`direction` defaulting to `'vi_to_en'`
(`apps/api/src/modules/translate/services/pipeline-translator.service.ts:219`,
`:247-248`). A planner reading the type would conclude LID is already free. It
is not. D10's cost is real.

### CPU cost, priced against the code

The local STT sidecar gives each recognizer 8 threads on an 8-core box
(`services/local-stt/app.py:15`, `engines/base.py:23-24`) and the speaker
embedder deliberately takes only 2 because "asking for 8 more oversubscribes and
slows the decode down" (`services/local-stt/speaker/embedder.py:20-25`, `:40`).
**A third ONNX model in that process contends against a budget the code already
documents as tight.** Two mitigations, both real:

- The sidecar is already sherpa-onnx, which is the runtime §4.4 says has an SLID
  variant that pads to `min(frames + 1000, 3000)` rather than a fixed 30s window.
  So LID adds a model, not a runtime.
- Priced alternative if CPU is exhausted: GPU rental is an ongoing cost on a
  non-commercial student project (constraint C1) and is not recommended.
  **No published CPU latency exists for these models on ~1s VI/EN clips (§4.4),
  so any latency claim before measurement is a guess.** Measure with the
  existing `run_latency.py` harness under full load before committing.

### Requirements

- RD.1 The check runs on the **tail subset defined by Phase B's run**, so the
  two are comparable.
- RD.2 Report the error **ratio** tail:non-tail with a confidence interval.
- RD.3 No LID code ships unless Phases B and C both fail the Phase 0 bar **and**
  the ratio clears.
- RD.4 If LID is admitted, measure latency under full load first (`run_latency.py`).

### Related files

- `packages/ai-providers/src/interfaces/stt-provider.ts:12-21`
- `packages/ai-providers/src/providers/local-speech/local-speech-stt-provider.ts:42,75`
- `services/local-stt/speaker/embedder.py:20-40`
- `benchmarks/speaker-id/run_latency.py`

### Steps

1. Emit the tail-turn row indices from Phase B's run.
2. Run a candidate LID (sherpa-onnx SLID; note `langid_ambernet` ships under NGC
   Terms of Use, not a standard OSS licence — §4.4 — so screen it the way P5
   screened SV models) over tail and non-tail clips.
3. Report the error ratio. Kill or admit.
4. If admitted and Phases B+C failed: measure latency under full load, then fuse
   the language posterior as a third bounded term in the Phase C architecture.
5. Independently, and cheaply: note the §4.4 second-order finding (Misra &
   Hansen — language mismatch degrades SV). If LID is admitted anyway, per-
   (speaker × language) sub-centroids would **shrink the tail** rather than fill
   it. Record as a follow-on, not scope here.

### Success criteria

- The error ratio is measured and published, ending §8 unknown 1 either way.
- A go/no-go on D10 that cites a number rather than an argument.

### Risks

| Risk                                          | Likelihood × impact  | Signal                            | Pre-decided response                                                                                                                |
| --------------------------------------------- | -------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Corpus lacks reliable language labels         | Med × High           | No per-clip language in the cache | The check cannot run on this corpus. Say so; do not substitute a proxy. Re-scope to P2's recording, which will have known languages |
| LID error ratio ≈ 1.0 (independent after all) | Med × High(positive) | Ratio measured                    | D10 is live. But it is still only admitted if B and C failed — it is not free                                                       |
| LID admitted, then blows the latency budget   | Med × High           | `run_latency.py` under full load  | Reject. C2's ~200ms speaker step and sub-2s end-to-end are not negotiable for a third model                                         |

---

## Phase E — The client decision layer

### Overview

Ships the mechanism Phases B–D calibrated. Client-only; no wire change, no
server call, no persistence — every `{vector, audioMs}` already accumulates
client-side and never evicts (constraint C4), and the browser holds them for the
session and nothing more (`speaker-centroids.ts:20-23`).

### Architecture

Three deliberate decisions, each answering a documented hazard:

**1. Do not add an `AttributionOrigin` member.** Constraint C6 records that the
union's forcing function catches 1 of 9 consumer sites; the other eight compare
string literals and **fail open** on a new member. A filled turn is a machine
suggestion, so it takes the existing `origin: 'suggested'`
(`speaker-roster.ts:33`), and the _mechanism_ goes in a new **optional** field
alongside `suggestedSpeakerId?` (`speaker-roster.ts:57`). Optional fields fail
_closed_ (`undefined`) at unaware consumers; union members fail _open_. That is
the whole rationale and it is the difference between a silent wrong label and a
missing annotation.

**2. Never let a fill seed a centroid.** `buildCentroids` already enforces
`attribution.origin !== 'confirmed'` → skip (`speaker-centroids.ts:67`), and the
module states why: a suggestion seeding the profile that produced the next
suggestion makes one early mistake permanent and self-reinforcing
(`:15-19`). Filled turns are the _lowest_-confidence turns in the session; they
are exactly what must never enter a centroid. The existing rule already covers
this — the requirement is to **not weaken it**.

**3. D2 is terminal.** A human-touched row is never renumbered by the fill layer
(`speaker-roster.ts:157-174` writes `confirmed`, and P3's state machine already
makes it terminal).

**New module rather than growth.** `turn-keyed-transcript.ts` is 476 lines and
CLAUDE.md asks for modularisation past 200. The fill decision goes in a new pure
module `packages/realtime-client/src/state/deferred-fill.ts`; the reducer gains
one action. Deadline state is data, not a timer: store `deferredAtTurn` and
`deferredAtMs` on the attribution, and expose a pure `dueForFill(state, now)`
that the session ticks with an injected clock.

`suggestSpeaker` (`speaker-centroids.ts:115-132`) computes `best` over all
centroids at `:128` and then discards it below `tau` at `:131` — the same
discard as `online.py:265`, in the other language. The fill layer needs the
candidate; add a sibling that returns `{ speakerId, score, margin }`
unconditionally and let `suggestSpeaker` keep its contract by calling it. DRY:
one scoring loop, two policies.

### Related files (owned exclusively by this phase)

- `packages/realtime-client/src/state/deferred-fill.ts` — **new**
- `packages/realtime-client/src/state/speaker-centroids.ts:115-132`
- `packages/realtime-client/src/state/speaker-roster.ts:33-58`
- `packages/realtime-client/src/state/turn-keyed-transcript.ts:242-264`
- `packages/realtime-client/src/conversation/conversation-session.ts:460`
- `packages/realtime-client/src/index.ts:96-108` (exports)

No file here is touched by Phases B–D, which are bench-only. Phases B/C/D and E
can run in parallel once Phase 0 is fixed, with E's thresholds loaded as data.

### Steps

1. `deferred-fill.ts`: `dueForFill`, `fillDecision`, the bounded LLR fusion, the
   in-session `p̂` estimator, and the RC.4 self-limiting monitor. Pure, injected
   clock, no timers.
2. Add `TurnFilled` to `TurnKeyedAction` (`turn-keyed-transcript.ts:254-264`)
   and a reducer case. **The reducer's `switch` has a `default:` at `:462`** —
   an unhandled action is silently swallowed, so the test must assert the action
   _changes state_, not merely that it does not throw.
3. Wire the session tick to `dueForFill`.
4. Thresholds loaded from a config object, not literals.
5. Ship behind the existing per-client opt-in (constraint C8; the feature
   already ships switched off — `speaker-centroids.ts:44-46`).

### Test matrix

| Level            | What                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit             | `dueForFill` boundary at `T` exactly; `fillDecision` clamp at ±`L`; `p̂` shrinkage at 0 and 1 observed pairs; self-limiting monitor trip and its irreversibility within a session |
| Unit (invariant) | A fill never adds a speaker to the roster; a fill never changes `origin` on a `confirmed` row (D2); a filled row never enters `buildCentroids`                                   |
| Integration      | Reducer: `TurnFilled` on an unknown `sessionId` is a no-op; on a `confirmed` row is a no-op; on a pending row commits. Assert _state change_, not absence of throw (see `:462`)  |
| Integration      | Session tick fills a pending turn with no further turns arriving — the D13 wall-clock path                                                                                       |
| E2E              | A scripted 20-turn session ends with **zero** `fallback` rows — the D8 contract, asserted                                                                                        |

### Success criteria

- **D8, mechanically asserted:** an E2E session ends with no `origin: 'fallback'`
  row. This is a test, not a claim.
- Every filled row carries its mechanism in the optional field.
- Flag off reproduces today's behaviour byte-for-byte.

### Rollback

Per phase, no cascade:

- Phases B–D write only new files under `benchmarks/speaker-id/results/`, which
  is append-only by the repo's own convention (94 result files, none
  overwritten). Rollback = delete the new CSV.
- The `Assignment.candidate` field defaults to `None`; reverting is one field.
- Phase E is behind the per-client opt-in. Rollback = flip the flag. No wire
  change, so constraint C8's non-atomic deploy has nothing to skew.

### Risks

| Risk                                   | Likelihood × impact             | Signal                                          | Pre-decided response                                                                                                                            |
| -------------------------------------- | ------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| New union member fails open at 8 sites | **High × High** if done naively | n/a — designed out                              | Optional field, not a union member. Rationale above                                                                                             |
| `TurnFilled` silently swallowed        | Med × High                      | `default:` at `turn-keyed-transcript.ts:462`    | State-change assertion in the test, per the matrix                                                                                              |
| A fill contaminates a centroid         | Low × Very High                 | `buildCentroids` sees a non-`confirmed` row     | Already guarded at `speaker-centroids.ts:67`; add a regression test naming the invariant                                                        |
| Client and bench fusion drift apart    | Med × High                      | Bench says 0.76, production behaves differently | One set of published constants, loaded as data in both. If they must diverge, the bench number stops being a prediction and must be re-labelled |

---

## D8 and D13, precisely

**D8 — satisfied as written.** Deadline-fill gives coverage 1.0. Every turn ends
the session carrying an ordinal. Asserted mechanically by the E2E test above, not
argued.

**D13 — satisfied as written for every turn except one bounded case, which needs
a user ruling.** A turn deferred fewer than `T` before the user presses stop
cannot be filled "during the session" by _any_ deferral mechanism. Precisely:

- With `T` as a wall-clock timer that runs independently of further turns, the
  violation set is "turns deferred within `T` seconds of stop" — at most the
  final turn or two of a session, and only when the user stops promptly.
- If Phase B shows `a_argmax` is high enough that deferral buys nothing, the
  right answer is **`T = 0`**, and D13 is satisfied with **no boundary case at
  all**. That is a real possible outcome, and Phase B decides it.
- Filling at stop for that residual turn would be exactly what D13 calls a
  failure. **I am not silently weakening it: I am flagging that a `T > 0` design
  has an irreducible final-turn case, and asking the user whether a fill `T`
  seconds after the last turn — with the session still open — counts as
  in-session.** My reading is that it does, since the user has not stopped; but
  it is their decision, not mine.

**D12 — respected but does not decide `T`.** D12's stated trade was
withhold-forever versus label-now. Under D8 withholding forever is out, so the
live trade is defer-then-fill versus fill-now — a trade D12 did not price.
Notably, tier-2 resolution scores 0.73–0.78, which is at or _below_ the required
fill accuracy, so waiting is not automatically the "fewer wrong" choice. `T` is
therefore set by measurement (Phase B step 4), not by re-reading D12.

---

## What this mechanism leaves behind — the residue, named and sized

Coverage residue is **zero by construction**. The residue is entirely converted
into error, and it is not uniform. Six populations, all named:

1. **Random fill error** — `tail × (1 − a)`. At `a = 0.76`, ≈8.4% of all turns
   wrong from the fill alone; ≈14% of all turns wrong system-wide. [derived]
2. **Correlated block error** — the prior's characteristic failure is a _run_ of
   consecutive wrong chips, not scattered ones. Worse UX at equal error rate.
   Mitigated by RC.3's clamp and RC.4's self-limiting monitor; measured as a
   first-class block-error metric, not folded into accuracy. [guess, measurable
   in Phase C step 4]
3. **No-neighbour residue** — pending turns with no committed neighbour fall
   back to acoustic argmax alone. Estimated at ~12% of the tail (≈4% of all
   turns); the estimate is optimistic because pending turns likely cluster.
   Phase C step 4 replaces the estimate with a measurement. [guess]
4. **D13 final-turn residue** — above.
5. **N=3 residue** — the turn-order inference is ambiguous at N=3 and degrades
   toward the acoustic margin. D3 admits 3 people. Reported as a separate cell.
6. **Segmentation residue** — C13 ("one turn = one speaker") has no detector. A
   turn containing two voices yields a blended embedding matching nobody, and
   _no_ fill rule can be right about it. Phase B step 5's duration split is the
   cheap probe; if the tail skews long, this is the real problem and this plan
   is answering the wrong question.

---

## If the instrument is broken (P7-M11)

Everything in Phases 0–D is conditional on the bench being sound. The plan's
behaviour if M11 finds trial construction broken:

- **The architecture survives unchanged.** The fill layer, the deadline, the
  ordering of channels by cost, the never-create invariant, and the C6-avoiding
  field design depend on _no number_ — only on the fact that a tail exists, which
  is observable in the client at runtime whether or not the bench is sound.
- **Every constant dies.** The required-`a` table, `a_argmax`, the `p_switch`
  crossing point, `w_a`/`w_p`/`L`, and `T` are all bench-derived. That is why
  RC/RE require them **loaded as data, not compiled in** — a recalibration is a
  config change.
- **Phase 0's formula survives; its constants do not.** Re-run Phase 0 against
  M11's corrected numbers; Phases B–E are unchanged in shape.
- **Nothing ships in the meantime.** Phase A blocks the ship decision and the
  freezing of any threshold, not the measurements. Phases B and C are cheap
  enough to run as labelled diagnostics either way, and their _relative_ results
  (does the prior beat argmax? does the fill improve with `p_switch`?) are more
  robust to an instrument fault than their absolute levels, because a systematic
  trial-construction error mostly shifts all arms together.

---

## What I would kill it with

Each choice, the cheapest experiment that kills it, and the killing result.

| Choice                               | Cheapest killing experiment                                   | Result that kills it                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fusion at all**                    | Phase B: force-assign the tail by the already-computed argmax | `a_argmax ≥ 0.75`. The tail is already fillable; the whole decision layer is unnecessary. _This is the happy kill and it is ~2 hours away_                        |
| **The whole approach**               | Phase B + Phase C at `p_switch = 0.9`                         | Fused fill `< 0.60` even at high alternation. No cheap channel reaches the bar; go back to the user on the 0.85 bar, on D8, or wait for P2 to shrink the tail     |
| **The turn-order prior**             | P2's labelled recording, zero marginal cost                   | Real `p_switch ≤ 0.70`. The prior carries too little information; §4.2's backing does not transfer to this conversation shape                                     |
| **The in-session `p̂` estimator**     | Phase C step 5                                                | `p̂` performs no better than a fixed pre-registered prior. Then drop the estimator and ship the constant — simpler, and KISS says take it                          |
| **LID / D10**                        | Phase D: LID error on the tail versus off it                  | Error ratio ≥ ~1.5. §4.3's suspicion confirmed; LID guesses wrong in the same places. _Or_: P(languages differ) is low, which kills it independently of the ratio |
| **Deferral (`T > 0`)**               | Phase B step 4's `T` sweep                                    | Accuracy at `T = 0` equals accuracy at `T = 3`. Then `T = 0`, which is also the clean D13 answer                                                                  |
| **The tail being the right problem** | Phase B step 5, free                                          | Tail turns are _longer_ than non-tail turns. Then C13 is violated, the tail is a segmentation failure, and this plan is answering the wrong question              |
| **Every number here**                | P7-M11                                                        | Trial construction broken. Constants void, architecture intact                                                                                                    |

---

## Open questions

1. **D13's final turn.** Does a fill `T` seconds after the last turn, with the
   session still open and the user not having pressed stop, count as
   in-session? My reading is yes; it is the user's call and it is the one place
   this plan touches a binding decision.
2. **What live attribution rate is acceptable** — carried forward unresolved
   from the floor sweep. My plan makes it less load-bearing (deferred turns get
   filled at `T`, not at stop) but does not answer it: the _pending chip_ UX
   between deferral and fill is still P6-S4b's question.
3. **What fraction of production turns are cross-language** (§8 unknown 3). Kills
   or saves LID independently of the §4.3 ratio, and is not measurable from
   turn-metrics as currently recorded.
4. **Does the bench corpus carry per-clip language labels?** Phase D cannot run
   without them, and I could not confirm from the cache builder alone.
5. **Thread budget discrepancy.** The packet's constraint C1 says "4 speech
   threads shared with STT"; the code says 8 per recognizer
   (`services/local-stt/app.py:15`) plus 2 for the embedder
   (`services/local-stt/speaker/embedder.py:40`). Phase D's CPU pricing depends
   on which is right.
6. **Should the attribution floor remain a calibration filter at all** — carried
   forward from the floor sweep. Under D8, accuracy on all turns is the single
   objective and the floor becomes a reported cost, which argues for removing it
   as a filter. Phase 0's pre-registration must settle this.
