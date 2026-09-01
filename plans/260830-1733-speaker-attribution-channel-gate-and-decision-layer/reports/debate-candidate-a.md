---
type: debate-candidate
candidate: A
date: 2026-09-01
question: 'OQ9 — what fills the ~35% of turns the acoustic layer cannot attribute?'
verdict: Fill it with a cheapest-first decision cascade — measured acoustic argmax, then a conversational-continuity prior the product already owns, then LID only if the first two miss a derived bar. Target the configuration in which no turn is ever pending.
---

# OQ9 — what fills the tail

## Recommendation

**Fill the tail with a decision cascade, built cheapest-first, in which every
layer must beat a measured baseline before it is allowed to exist — and aim
explicitly at the configuration where nothing is ever pending at all.** The tail
does not need a new evidence source before it needs an arithmetic: at the
measured shares, the tail must be labelled at **≥0.72 accuracy on the D8
denominator** for the system to clear 0.85, and _nobody has yet measured what the
free option scores_. The bench already carries, for every unattributed turn, the
cosine against every live centroid (`online.py:242-244`, exposed causally via
`OnlineAttributor.centroids`, `online.py:211-213`); force-assigning to the argmax
is the thing every shipped product does (§4.1), costs zero new milliseconds and
zero new CPU, and its score on the tail is **known unknown #5 in the packet, not
a known-bad number**. So Phase E1 measures it. If argmax-on-the-tail already
reaches 0.72, OQ9 is answered with no new mechanism, no new model, no wire
change, no pending state, and open questions 2/4/5 collapse. If it does not, the
next-cheapest channel is one the _product uniquely owns and the Turn-to-Diarize
paper had to learn_ (§4.2): this app knows exactly when it played TTS
(`conversation-session.ts:460`; `firstAudioPlayedAt`/`lastAudioPlayedAt` already
on the wire at `ws-events.ts:250-251`), and it runs full-duplex
(`use-streaming-translate.ts:300`), so "did the counterpart's translation finish
playing before this turn started" is a real, free, timbre-independent handover
cue. LID (D10) is sequenced **last and conditionally**, not because §4.3's
suspicion is accepted — it is not, and E3 runs the check the packet asks for —
but because its break-even arithmetic (derived below, supplying the derivation
D9 was downgraded for lacking) shows LID cannot carry the tail unless **more than
half of tail turns are language-identifying**, and that fraction is unmeasured
and only P2 can measure it. D8 and D13 are both satisfied as written. The residue
this mechanism leaves is not silence — it is **wrong labels**, plus four
structurally named classes (R2-R5 below), and the whole plan is the arithmetic
that keeps that residue under the bar.

---

## The governing number, derived

Every share and accuracy below is **[measured]** (packet §2.4). The arithmetic is
mine and is stated so it can be checked.

Let `a` = accuracy of whatever fills the tail. Settled-label accuracy on the D8
denominator (all turns) is:

```
A = share_imm · acc_imm  +  share_res · acc_res  +  share_tail · a
```

| turns/meeting | share·acc immediate      | share·acc resolved       | subtotal | tail share | **`a` needed for A ≥ 0.85** |
| ------------- | ------------------------ | ------------------------ | -------- | ---------- | --------------------------- |
| 10            | 0.5968 · 0.9185 = 0.5482 | 0.0937 · 0.7336 = 0.0687 | 0.6169   | 0.3096     | **0.753**                   |
| 20            | 0.5811 · 0.9379 = 0.5450 | 0.0680 · 0.7637 = 0.0519 | 0.5970   | 0.3509     | **0.721**                   |
| 40            | 0.5881 · 0.9374 = 0.5513 | 0.0644 · 0.7838 = 0.0505 | 0.6018   | 0.3475     | **0.714**                   |

**The tail must be labelled at 0.71-0.75. Chance at N=2 is 0.50.** Every option
in §6 of the packet is judged against that one number, on that one denominator.

Two caveats carried forward rather than hidden:

- The packet's addendum limit 3 records that its `acc imm` uses a prefix-locked
  mapping keyed on the first _committed_ turn, which is not
  `scoring.score_prefix_locked` (`scoring.py:38-98`). So this table's inputs are
  internally consistent but not yet comparable to the floor sweep's 0.8809.
  **E1 recomputes all three shares under one scorer** and this table is
  provisional until it does. `[measured, with a stated scorer mismatch]`
- `a` is not independent of the deadline. A turn filled at deadline W was denied
  the chance to resolve at W+1. E1 sweeps W and reports the whole curve.

---

## Design rule that makes the whole thing safe

**A filled label never folds into a centroid.** `online.py:16-22` records why
forcing every turn into the nearest cluster "silently poisons centroids"; the
measured `acc imm` _rising_ with session length (0.9185 → 0.9379 → 0.9374) is a
property of the abstaining attributor and must be preserved.

Consequence, and it is the architectural backbone of this plan: **the fill layer
is a pure function over the attributor's output and cannot change it.** The
acoustic state machine runs exactly as measured; the fill decides only what is
rendered for turns the attributor left as `label=None`. Therefore:

- Every measured number in §2.4 stays valid under this mechanism.
- Rollback is a boolean: disable the fill and the system is byte-identical to the
  `abstain` baseline.
- No wire change, no server change, no persistence, no new privacy decision —
  vectors already accumulate client-side and never evict
  (`turn-keyed-transcript.ts:87`, `:401-405`), and playback timing is already
  computed client-side to populate `client.turn.metrics`
  (`ws-events.ts:237-259`).

---

## The cascade

Applied only to turns the attributor left unlabelled, only when **at least one
machine cluster exists**, in this order. First rule that fires, wins.

| #   | Rule                                                                                                                                                                 | Cost                                                                                                    | Available when   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| C0  | **Continuation** — the previous turn started/ended with no completed playback in between and the inter-turn gap < `G` → _same ordinal as the previous turn_          | 2 timestamp comparisons                                                                                 | always           |
| C1  | **Handover** — a translation playback completed between the previous turn and this one, and exactly 2 clusters exist → _the ordinal that is not the previous turn's_ | 2 timestamp comparisons                                                                                 | always           |
| C2  | **Acoustic argmax** — `argmax_k cos(v, c_k)` over live centroids                                                                                                     | one dot product per cluster, dim ~192, already implemented client-side (`speaker-centroids.ts:115-132`) | a vector arrived |
| C3  | **Ordinal 1** — the only cluster that exists                                                                                                                         | free                                                                                                    | always           |

A **cascade, not a log-likelihood-ratio fusion**, deliberately. §4.5 is explicit
that no published work fuses these channels and no measured gain exists, so
weights would be fitted on nothing. The cascade has exactly one free parameter
(`G`) plus a boolean predicate. LLR fusion is the documented upgrade path once
E2 supplies real labelled dialogue to calibrate on; it is not this delivery.

**C0 before C1 before C2** because the failure mode that most threatens the
alternation prior is a _split utterance_: `speech-gate.ts:29` ends a turn after
`SPEECH_HANGOVER_MS = 500` of silence (`:212-214`), so one person pausing
mid-sentence produces two consecutive turns from the same speaker, and a naive
alternation rule gets both of them wrong. C0 is the detector for exactly that,
and the product's full-duplex playback (`use-streaming-translate.ts:300`,
`capture-pump.ts:157-181`) is what makes it detectable.

### Why the alternation channel is bounded, in advance

If `p` = the real same-speaker-repeat rate at turn boundaries and `q` = the
probability the previous turn's label is right, a pure alternation rule scores
`a = q(1-p) + (1-q)p`. Needing `a ≥ 0.72`:

| `q`                          | max tolerable `p` |
| ---------------------------- | ----------------- |
| 0.93 (`acc imm` at 20 turns) | **0.244**         |
| 0.85 (system-wide bar)       | **0.186**         |

**So the alternation channel carries the tail only if fewer than ~1 turn
boundary in 5 is a same-speaker repeat.** `p` is unmeasured. C0 exists precisely
to shrink the effective `p` seen by C1 by catching continuations first.

### What M1 can and cannot say about `p` — new, computed this session

From `results/turn-metrics-m1.jsonl` (21 client rows, local-only artifact per
Constraint 15), inter-turn gaps `next.speechStartedAt − prev.speechEndedAt`:

```
191, 300, 513, 690, 759, 1070, 1220, 1320, 1340, 1430,
1731, 1770, 1860, 2051, 2370, 3289, 3480, 3910, 6120, 46642   (ms)
```

`[measured, this session]` — 3 of 20 boundaries are under 550ms and 5 under
800ms, i.e. resumptions faster than the gate's own hangover. **Short-gap
continuations exist and are not rare.**

And the disqualifying detail: **all 21 turns carry `reason: "voice_off"` and not
one row has `firstAudioPlayedAt`.** No translated audio played in that sitting,
so M1 is a dictation-shaped sitting, not an interpreted two-party conversation.
`[measured, this session]` Two consequences: the C0/C1 timing features have
**zero real data today**, and M1's p50 of 1065ms is itself drawn from a sitting
with no counterpart and no playback rhythm. E2 is therefore load-bearing, not
optional.

### Why LID is last — the D9 arithmetic, supplied

D9 was downgraded to an open question for having no derivation (plan.md:202).
Here it is. Let `c` = the fraction of tail turns whose language identifies its
speaker (the two parties habitually speak different languages), `L` = binary
VI/EN LID accuracy at ~1s. LID alone scores `c·L + 0.5(1−c)`. Needing 0.72:

```
c ≥ 0.22 / (L − 0.5)
```

| `L`  | minimum cross-language fraction `c` |
| ---- | ----------------------------------- |
| 0.95 | **0.489**                           |
| 0.90 | **0.550**                           |
| 0.85 | **0.629**                           |
| 0.75 | **0.880**                           |

**LID cannot carry the tail unless more than half of tail turns are
language-identifying**, and no binary VI/EN number at ~1s exists anywhere
(§4.4), and `c` is unmeasured — P2 is the only thing that can measure it
(plan.md:202). This is not a reason to discard D10; it is the reason to sequence
it after two free channels and behind a measurement it does not control.

### Correction to the packet's §4.3

> "This is testable on data already in hand."

**Partly false.** The embedding cache is built from the **VoxVietnam test split**
(`corpus.py:1`), and the only two corpora the bench fetches are VoxVietnam and
Vietnam-Celeb — **both Vietnamese** (`fetch_corpora.py:7-17`). There is no
English speech in hand. What is testable today is whether LID _confidence_
degrades on the SV-unattributable subset — a necessary condition. Measuring a
binary VI/EN _error rate_ needs an English corpus added (LibriSpeech dev-clean,
CC-BY-4.0, ~340MB) and a cache rebuild. E3 scopes both parts and says which is
which.

---

## How this plan behaves if P7-M11 finds the instrument broken

Everything is conditional on the instrument audit that has not run. Stated per
layer rather than as a blanket disclaimer:

| Layer                                | If P7-M11 invalidates trial construction                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| The governing arithmetic (0.71-0.75) | **Void.** Its inputs are §2.4. Recompute from the corrected shares; the _form_ of the arithmetic survives                                      |
| E1 (argmax baseline)                 | **Re-run.** It is a diagnostic over the same cache, so it costs one re-run after the cache is rebuilt — not a redesign                         |
| E2 (turn-taking)                     | **Unaffected.** `p`, `G` and the playback predicate come from a real recording session, not from the bench. A broken bench does not touch them |
| E3 (LID screen)                      | **Re-run**, same as E1                                                                                                                         |
| E4/E5 (product code)                 | **Not started.** Hard rule: no product code lands before P7-M11 returns                                                                        |
| The cascade's shape                  | **Unaffected.** Cheapest-first ordering is a cost argument, not a measurement claim                                                            |

**Hard gate:** if P7-M11 reports the instrument unsound, E1 and E3 are marked
`VOID — re-run` in place, the bench is corrected under P7, and this plan resumes
at E1. E2 may proceed in parallel throughout, because it depends on no bench
number.

---

## Phases

Dependency graph. `→` is a hard blocker.

```
P7-M11 ──┬─→ E1 (argmax baseline)  ─┬─→ E4 (fill layer) ─→ E5 (chip + i18n)
         └─→ E3 (LID screen)  ──────┤
P2 ──────────→ E2 (turn-taking) ────┘
```

E1, E2, E3 own disjoint files and run in parallel. E4 starts only when all three
have returned a verdict. E5 starts only when E4 is merged.

---

### E1 — Measure what the free option scores

**Overview.** The one measurement that could end OQ9 without building anything.
Nobody has ever asked what nearest-centroid force-assignment scores on the tail;
the packet lists it as known unknown 5 and §2.5 brackets it as a guess between
0.50 and 0.73. Measure it instead.

**Requirements.**

- Report every number on the **D8 denominator** — correct ordinals ÷ all turns —
  and never on attributed turns.
- Recompute `share_imm / acc_imm / share_res / acc_res / share_tail` under one
  scorer, resolving the addendum's limit-3 mismatch, so the governing table above
  becomes a measurement rather than a derivation.
- Causal only: the argmax must be taken against the centroids that existed
  **before** the turn was observed. No lookahead, no oracle.
- Held-out speaker splits, thresholds calibrated on calibration speakers only
  (Constraint 12).
- Sweep the deadline `W ∈ {1, 2, 3, 5, 8, ∞}` turns, where `W=1` means "fill
  immediately, no pending state ever".

**Architecture.** A diagnostic wrapper, **not a change to `online.py`**. For each
scheduled turn: read `attributor.centroids` (`online.py:211-213`), call
`attributor.observe(v)` (`online.py:232`), and when `Assignment.label is None`
(`online.py:263`, `:265`) record the argmax over the centroids captured a moment
earlier, plus the score gap. Then replay the recorded per-turn stream under each
`W` and score with `scoring.score_prefix_locked` (`scoring.py:38-98`) extended to
count filled turns in the denominator. Zero modification to any module a
published number was measured on preserves provenance under Constraint 11/12.

**Related files.**

- New: `benchmarks/speaker-id/run_tail_fill.py`, `speaker_bench/tail.py`,
  `results/1s-e1-tail-fill.csv`, `results/1s-e1-tail-fill-curve.csv`
- Read-only: `speaker_bench/online.py`, `speaker_bench/scoring.py`,
  `run_session.py`, `results/embedding-cache.npz`

**Steps.**

1. Run `SPEAKER_BENCH_REQUIRE_PARITY=1 uv run pytest`; record the exit code in
   the report (Constraint 11 — a provenance claim with no exit code beside it is
   not a provenance claim).
2. Build the causal per-turn record: `(turn_index, truth, label, created, score,
nearest_before, second_score, n_clusters_before)`.
3. Reproduce the packet's §2.4 row at 20 turns to within noise. **If it does not
   reproduce, stop and report** — the diagnostic is wrong, not the packet.
4. Score `A` on the D8 denominator for each `W`, cell campplus / far-field / N=2 /
   cold / 1.0s, `abstain`, floor 0.65, 3 splits × 400 meetings.
5. Report `a_argmax` (tail-only accuracy) separately from `A`, plus the count of
   tail turns arriving while only one cluster existed (R3's size).
6. Repeat the whole sweep on `clean` as a channel-sensitivity read, reported and
   never gated on.

**Success criteria** (observable):

- [ ] `a_argmax` reported with a 95% interval, on held-out speakers, per `W`
- [ ] `A` reported on the D8 denominator for every `W`, beside the 0.85 bar
- [ ] The five shares recomputed under one scorer; the governing table above
      either confirmed or replaced
- [ ] Count and share of tail turns with `n_clusters_before == 1` (R3)
- [ ] pytest exit code recorded
- [ ] Per-turn CSV committed, not only aggregates

**Decision this phase makes.**

- `a_argmax ≥ 0.75` → **OQ9 is answered.** Ship C2+C3 only. E2 and E3 become
  reported context, not blockers. Go straight to E4 with `W=1`.
- `0.60 ≤ a_argmax < 0.75` → the cascade needs C0/C1. Proceed to E2 as a blocker.
- `a_argmax < 0.60` → the acoustic channel is worthless on the tail; the tail is
  a _different population_, not a noisy version of the same one. C2 is demoted
  below C0/C1 in the cascade and E2 becomes the entire answer.
- `a_argmax ≈ 0.50 and a_alternation-free bound also ≈ 0.50` → escalate to the
  user: the bar, not the mechanism, is the open item.

**Risks.**

| Risk                                             | Signal                                  | Pre-decided response                                                                                                                       |
| ------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| The diagnostic silently uses post-fold centroids | `a_argmax` implausibly high (> 0.90)    | Assert in code that centroids are captured before `observe`; a unit test with a two-turn fixture where folding would change the argmax     |
| `W` sweep confounds deadline with threshold      | Accuracy moves non-monotonically in `W` | Thresholds are re-calibrated per `W`, exactly as §2.4 did per length; report both calibrated and fixed-threshold arms                      |
| Reproduction of §2.4 fails                       | Step 3 mismatch                         | **Stop.** Report the mismatch as the finding. Do not proceed on a diagnostic that cannot reproduce a measured row                          |
| Fitting `W` after seeing results                 | Anyone picks `W` from the curve         | `W` is **pre-registered before E4** in a written line in the report, exactly as the floor-sweep report demanded of the floor (its limit 1) |

**Rollback.** Nothing to roll back; new files only, no harness constant touched.

---

### E2 — Measure the turn-taking channel on real dialogue

**Overview.** The alternation prior's value is a single unmeasured scalar `p`,
and the continuation detector's value is a single unmeasured threshold `G`. The
bench cannot supply either: `build_schedule` offers only `shuffled` (`p ≈ 0.44`
at N=2) and `alternating` (`p = 0`) (`run_session.py:128`, `:190-200`). **Scoring
an alternation prior against the `alternating` arm would be circular and would
report ~1.00.** That trap is named here so no later phase falls into it.

**Requirements.**

- Ride on P2's existing one-shot recording session. **No additional fixture, no
  additional consent scope beyond what P2 already carries** — P2 already records
  real people through production `getUserMedia` and already commits to labelling
  the language of every turn (plan.md:202).
- Add exactly two things to P2's protocol: **who spoke each turn**, and **voice
  output ON** so playback timestamps exist.
- Report `p` with its interval; report the gap distribution split by
  same-speaker/different-speaker; report the fraction of turns for which a
  playback completed in the preceding gap.
- Report `c`, the cross-language fraction, as E3's input.

**Architecture.** Read-only on app code. The web client already computes and
sends `speechStartedAt`, `speechEndedAt`, `firstAudioPlayedAt`,
`lastAudioPlayedAt`, `cutForced`, `echoEvents`
(`ws-events.ts:237-259`), and the sink that writes them exists and is currently
disabled by design (Constraint 15). E2 re-arms it **for the recording session
only**, under P2's consent and retention criteria, and disarms it in the same
session — the re-arm/teardown is part of P2's checklist, not a standing change.
Speaker truth is recorded by the session operator against `sessionId`, offline.

**Related files.**

- New: `benchmarks/speaker-id/run_turn_taking.py`,
  `results/p2-turn-taking.csv`, `results/p2-speaker-truth.csv`
- Modified: `plans/.../phase-02-channel-delta-gate.md` (protocol addendum only)
- Read-only: `packages/types/src/events/ws-events.ts`,
  `apps/web/src/hooks/use-streaming-translate.ts`

**Steps.**

1. Amend P2's protocol: voice output ON; a scripted stretch containing at least
   one deliberate split utterance per speaker; a three-person stretch (P2 already
   plans one); the operator logs speaker per `sessionId` live.
2. Re-arm the metrics sink with the retention date written down **before**
   capture, per Constraint 15's resolution.
3. Compute `p`, the gap distribution by class, the playback-completed rate, and
   `c`.
4. Choose `G` as the gap threshold maximising continuation F1 on the _first_ of
   the recorded stretches, and report its value on the _held-out_ remaining
   stretches. Fitting and reporting on the same stretch is the same circularity
   Constraint 12 forbids for speakers.
5. Replay E1's per-turn stream through the cascade with the measured `p`, `G` and
   playback rate substituted for the bench's synthetic ordering, and report `A`.
6. Disarm the sink; log the teardown date.

**Success criteria.**

- [ ] `p` measured on ≥3 real speakers with a stated interval
- [ ] `G` chosen on one stretch, reported on held-out stretches
- [ ] Playback-completed-in-gap rate reported (how often C1 can fire at all)
- [ ] `c` reported, feeding E3's break-even table
- [ ] Consent, retention date and executed teardown all logged (P2's criteria)
- [ ] Sink verified disarmed after capture, with a date

**Decision this phase makes.**

- `p ≤ 0.19` → the alternation channel alone clears the tail bar. C0/C1 ship.
- `0.19 < p ≤ 0.35` **and** C0 catches most of the excess (continuation F1 ≥ 0.8)
  → the cascade clears it. C0/C1 ship with `G` as measured.
- `p > 0.35` with weak C0 → the turn-taking channel does not carry the tail
  alone. E3 becomes the last option, and if E3 also fails the plan escalates to
  the user with the bar as the open item.

**Risks.**

| Risk                                                                   | Signal                                    | Pre-decided response                                                                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| One fixture, one room, 3-5 speakers → `p` is not the population's `p`  | Interval on `p` spans a decision boundary | Report it as a range and pre-decide both sides. Do **not** re-run the fixture to get a tighter number — it is one-shot                     |
| Scripted dialogue is more alternating than real dialogue               | `p` implausibly low (< 0.05)              | The script must contain unscripted stretches; report scripted and unscripted `p` separately and gate on the unscripted one                 |
| Re-arming the sink re-opens the privacy item Constraint 15 just closed | Sink still armed after the session        | Teardown is a named checklist item with a logged date, matching the resolution already executed on 2026-08-31                              |
| Full-duplex echo pollutes the playback predicate                       | `echoEvents > 0` on many turns            | `echoEvents` is already recorded per turn (`ws-events.ts:258`); exclude high-echo turns from `G` fitting and report how many were excluded |

**Rollback.** Protocol addendum only; no code ships. Reverting is deleting a
section from a phase file.

---

### E3 — Run the check §4.3 asks for, and price LID honestly

**Overview.** The packet is right that D10 may be neither adopted nor discarded
without the correlation check. E3 runs it, and additionally prices LID against
constraints C1 and C2 so the decision is not taken on accuracy alone.

**Requirements.**

- Part A **(data in hand)**: on the exact turns E1 marks as tail, measure whether
  an LID model's confidence degrades relative to the attributed turns. All clips
  are Vietnamese, so this measures **unreliability correlation**, not error rate.
  Say so in the report.
- Part B **(needs one download)**: add an English corpus, build a matched cache
  at 1.0s, and measure binary VI/EN accuracy `L` at the product's real turn
  length — a number §4.4 says does not exist anywhere.
- Price the CPU cost against Constraint 2's ~200ms budget and the 4 shared speech
  threads (Constraint 1), or price the GPU alternative in $/month.
- Report `L` against the break-even table above, with `c` from E2.

**Architecture.** Server-side, mirroring the shipped embedding path: an LID call
started **eagerly beside the translation** exactly as `embedSpeaker` is
(`translation-session.service.ts:293-300`), awaited after the transcript is out
(`:349`). That placement is the one C3 already proved is the only one available —
moving it later loses the result when the socket closes
(`registry.holds`, `:350`). Bench-side, a screen script parallel to
`run_pairwise.py`.

**Related files.**

- New: `benchmarks/speaker-id/run_lid_screen.py`, `results/1s-e3-lid.csv`
- Modified: `benchmarks/speaker-id/scripts/download_models.py`,
  `scripts/fetch_corpora.py` (Part B only)
- Read-only: `speaker_bench/embed.py`, `run_latency.py`

**Steps.**

1. Part A: score LID posterior entropy on E1's tail subset vs its attributed
   subset. Report the difference with an interval.
2. Latency: measure LID p95 on 1.0s clips at `contended-stt8`, the same cell
   Constraint 2's campplus numbers come from, so the two are comparable.
3. Part B (only if Part A does not kill it): fetch LibriSpeech dev-clean
   (CC-BY-4.0), build a 1.0s cache with the identical pipeline, measure `L`.
4. Compare `L` against `c` from E2 in the break-even table.
5. Record the licence of whatever model is screened. `langid_ambernet` ships
   under NGC Terms of Use, not an OSS licence (§4.4) — a screened model with an
   unusable licence is a measured dead end and must be labelled one.

**Success criteria.**

- [ ] Part A reported with an interval, and explicitly labelled as an
      unreliability-correlation result, not an error rate
- [ ] LID p95 latency measured at the same contention cell as campplus
- [ ] `L` measured at 1.0s, or Part B recorded as not run and why
- [ ] Break-even table instantiated with measured `L` and measured `c`
- [ ] Licence recorded per screened model

**Decision this phase makes.**

- Part A shows LID confidence degrades on the tail **at the same rate as SV**
  → §4.3's suspicion is confirmed. **D10 stays closed for this slice**, recorded
  with the number. Report and stop.
- Part A shows LID confidence holds on the tail, **and** `c·L + 0.5(1−c)` beats
  what the cascade already achieves, **and** LID p95 fits beside campplus in the
  4-thread budget → propose reopening D10 to the user with the price attached.
  It is a user decision, not a plan decision (D10 is binding).
- LID p95 pushes the speaker step past ~200ms or measurably slows STT → **reject
  on cost regardless of accuracy.** The GPU alternative is a standing
  ~$250-400/month for a small always-on cloud GPU `[guess, reasoned from
on-demand small-GPU pricing]` on a non-commercial student project, which
  Constraint 1 already refuses.

**Risks.**

| Risk                                                       | Signal                                                    | Pre-decided response                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Part A is run and read as if it were Part B                | The report quotes an error rate from Vietnamese-only data | The report template states the limitation in the same table as the number                                               |
| Whisper-family 30s padding distorts 1s results             | `L` far below the 107-way published figures               | Use the sherpa-onnx SLID variant, which pads to `min(frames+1000, 3000)` (§4.4), and report the padding used beside `L` |
| Language mismatch is itself degrading the embeddings       | Not visible from this screen                              | Recorded as an open question (§4.4's Misra & Hansen second-order risk); E3 does not attempt to answer it                |
| LID adds a second sidecar and doubles Constraint 2's spend | Measured STT p95 regression                               | Reject. Constraint 2 already warns "any design embedding twice per turn spends this twice"                              |

**Rollback.** Bench-only until a user decision reopens D10. No product code.

---

### E4 — The fill layer

**Overview.** Client-side only, pure over the attributor's output, one new module
plus one reducer case. Starts only after E1/E2/E3 return.

**Requirements — D8 and D13, as written.**

- **D8 is satisfied.** Every turn ends carrying an ordinal. The cascade is total:
  C3 always fires when nothing else does, and there is always at least one
  cluster after turn 1 because the first observation unconditionally creates
  cluster 0 (`online.py:234-240`, `:279-280`). The only state in which no ordinal
  can be produced is "no cluster exists at all", which is turn 1 of a session
  before its own vector arrives — and that turn creates cluster 0 the instant it
  does.
- **D13 is satisfied at `W=1` and only conditionally at `W>1`, and this must be
  said out loud.** At `W=1` every turn is decided on arrival: nothing is ever
  pending, so "during the session" is trivially true. At `W>1` a pending turn is
  filled at `min(W turns, T ms)` — a wall-clock timer, not session end, which is
  what keeps D13 satisfied for the last turns of a session. **Residual class:** a
  turn whose timer would expire after the user presses stop is filled at stop.
  That is a boundary case, not the general behaviour D13 rejects, but it is real
  and it is named. If E1's curve shows `W=1` costs nothing, take `W=1` and the
  residual class disappears.
- **D12 is not overturned.** D12 chose fewer wrong labels over faster labels.
  `W=1` is adopted only if measured tail accuracy ≥ the resolved bucket's
  accuracy — i.e. only when it is _both_ fewer wrong labels and faster, which
  strictly dominates the option D12 chose. If it is not dominant, `W` is
  pre-registered from E1's curve and the trade goes back to the user in the same
  concrete form D12 was decided in.

**Architecture.**

```
server.turn.embedding ─→ reducer ─→ OnlineAttributor-equivalent (unchanged)
                                          │ label | null
                                          ▼
                       fillOrdinal(state, sessionId) ── pure ──→ ordinal
                            ▲          ▲          ▲
                        timing     centroids   cluster count
                     (local only)  (existing)   (existing)
```

- The filled ordinal is stored as `{ speakerId, origin: 'suggested',
suggestedSpeakerId }`, reusing the existing shape
  (`speaker-roster.ts:42-58`). **No new `AttributionOrigin` member.** Constraint 6
  is explicit that the exhaustive `Record` catches exactly one of nine consumers
  (`speaker-chip.tsx:52-58`) and the other eight fail open, so adding a union
  member would be a silent-failure surface for a distinction the product does not
  need at `W=1`.
- `turn-keyed-transcript.ts:410` currently returns early whenever any attribution
  exists, which is what makes attribution write-once. E4 relaxes it to
  `origin !== 'confirmed'` **only for turns whose label is machine-written**, so a
  human edit stays terminal (D2). This is the change P3's authority table must
  arbitrate, and E4 does not land before P3 records it.
- **The extension is unaffected by construction.** `apps/extension` never sends
  `embedSpeaker`, so no vector arrives, no cluster exists, and the "at least one
  machine cluster" guard means `fillOrdinal` never fires there. Its turns stay
  `fallback`, exactly as today.
- **`fallback` becomes unreachable on a finished web turn** under D8. The union
  member stays (it is the state before a vector arrives) and the invariant is
  asserted in a spec rather than encoded in a type.

**Related files.**

- New: `packages/realtime-client/src/state/turn-fill.ts`,
  `turn-fill.spec.ts`
- Modified: `packages/realtime-client/src/state/turn-keyed-transcript.ts`
  (the `server.turn.embedding` case, `:401-433`),
  `speaker-roster.ts` (the `speakerId`-null doc at `:44` only),
  `attribution-stats.ts` (a filled-turn counter, derived not accumulated)
- Read-only: `speaker-centroids.ts`, `conversation-session.ts`
- **Owned exclusively by E4.** E5 owns no file in this list.

**Steps.**

1. Land P3's pending/authority amendment first (it is already a declared blocker).
2. Write `fillOrdinal` as a pure function of `(speakers, attributions,
embeddings, turnTimings, sessionId)` with the cascade and the pre-registered
   `G`, `W`, `T` as named constants carrying their measurement provenance in the
   docstring.
3. Thread turn timings into the reducer. They are already local — the client
   computes them to populate `client.turn.metrics` — so this is a state field,
   not a wire change (Constraint 8 untouched).
4. Relax `:410` to the authority rule, guarded by a spec that a `confirmed` row
   is never rewritten.
5. Assert the D8 invariant in a spec: after a simulated session, zero finished
   turns carry `speakerId: null`.
6. Assert the no-poison invariant: `buildCentroids` (`speaker-centroids.ts:57`)
   must never see a filled turn. It already filters on `origin === 'confirmed'`
   (`:67`) — add a spec that pins that behaviour against a filled row, so a later
   refactor cannot loosen it silently.

**Success criteria.**

- [ ] Zero finished turns end a simulated session with `speakerId: null`, over an
      adversarial embedding sequence (D8)
- [ ] A turn with no vector at all still receives an ordinal (closes plan open
      question 3 with a concrete rule)
- [ ] A `confirmed` row is never rewritten by the fill, asserted (D2)
- [ ] No filled turn ever enters a centroid, asserted
- [ ] Distinct rendered ordinals ≤ `K_max` for machine-written labels, asserted
      against an adversarial sequence
- [ ] `apps/extension` behaviour unchanged, asserted in its own spec
- [ ] Zero wire-schema changes in the diff

**Risks.**

| Risk                                                     | Signal                                                     | Pre-decided response                                                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relaxing `:410` lets a suggestion overwrite a human edit | A spec asserting D2 fails                                  | The relaxation is `origin !== 'confirmed'` and is written as one predicate used in one place. DRY: `attributionFor` (`speaker-roster.ts:220-225`) stays the only reader |
| Filled labels churn on screen as clusters shift          | Churn > 1 change per 10 turns (the plan's existing signal) | At `W=1` a filled label is written once and never revisited — churn is zero by construction. At `W>1`, the plan's existing pre-decided response applies                 |
| The timing feature reads playback state that is stale    | C0/C1 fire on the wrong side of a boundary                 | Timings are captured at turn open/close from the same values `client.turn.metrics` reports, not read live at fill time                                                  |
| Three-speaker sessions under `K_max=2`                   | The third voice is labelled as one of two                  | **Not solved here.** See R4. E4 reports the rate; plan open question 1 owns the decision                                                                                |

**Rollback.** One boolean guard around `fillOrdinal`. Off = the shipped `abstain`
behaviour, byte-identical. No migration, nothing persisted, session-scoped state
only.

---

### E5 — What the chip says

**Overview.** The smallest possible surface. Under D8 there is no "Người ?" state
to design — the user rejected it — and at `W=1` there is no pending state either.

**Requirements.**

- A filled ordinal renders in the existing `suggested` tone
  (`speaker-chip.tsx:56`): dashed, italic, dimmed. It is a machine label that may
  be corrected, and the shipped vocabulary already says exactly that.
- No new accent-filled control. `docs/design-guidelines.md` allows one
  `bg-primary` per app screen and `/translate` already spends it (Constraint 14,
  and the project rule with no mechanical gate).
- No copy claiming certainty. The chip is a label, not a claim.

**Related files.**

- Modified: `apps/web/src/components/translate/speaker-chip.tsx`,
  `speaker-chip.spec.tsx`, the two i18n dictionaries
- **Owned exclusively by E5.** No overlap with E4.

**Steps.**

1. Confirm `CHIP_TONE` covers every origin the fill can produce — with no new
   union member, it does, unchanged.
2. Spec: a filled turn renders its ordinal, never `speakerUnknown`
   (`speaker-chip.tsx:95`).
3. Spec: the chip remains tappable for a filled turn, so a correction is possible
   (D2's terminal edit needs a surface).

**Success criteria.**

- [ ] A filled turn renders an ordinal in the `suggested` tone
- [ ] `speakerUnknown` unreachable for a finished web turn
- [ ] Accent budget unchanged on `/translate`
- [ ] Existing chip specs pass unmodified

**Risks.**

| Risk                                                          | Signal                                                          | Pre-decided response                                                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dimmed/italic reads as broken rather than provisional         | Observation during P6                                           | The vocabulary is already shipped for live lines; changing it is a design decision taken separately, not inside this delivery                      |
| Nobody ever corrects a wrong label, so the error is invisible | `corrected == 0` across sessions (`attribution-stats.ts:79-87`) | Already the designed reading of `unreviewed`: an absence of evidence, reported as one. Not a reason to add a prompt — that would reintroduce a tap |

**Rollback.** Revert one component file and two dictionary keys.

---

## What I would kill it with

Cheapest first. Each names the result that kills the claim.

| #   | Claim                                                                | Cheapest experiment                                                                  | Result that kills it                                                                                                                                                |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | **The tail needs ~0.72, not 0.50 or 0.86**                           | Recompute the three shares under one scorer in E1 step 3                             | The shares do not reproduce §2.4 → the whole arithmetic is void and this plan restarts                                                                              |
| K2  | **Acoustic argmax on the tail beats chance materially**              | E1 — a diagnostic over the existing cache, no new data, no new model, hours not days | `a_argmax ≤ 0.55` → the tail is a different population; C2 is worthless and the cascade loses its only always-available acoustic channel                            |
| K3  | **The turn-taking channel is worth having**                          | E2's `p` on the real recording session                                               | `p > 0.35` with continuation F1 < 0.8 → C0/C1 add nothing over chance and are deleted, saving a module                                                              |
| K4  | **The continuation detector is real, not an artifact of one script** | Report `p` split scripted vs unscripted in E2 step 4                                 | Unscripted `p` differs from scripted by more than its interval → `G` is fitted to a script and does not transfer; the channel ships only with the unscripted number |
| K5  | **LID is not simply SV wearing a hat**                               | E3 Part A, data in hand, one model download                                          | LID entropy on the tail degrades at the same rate as SV → §4.3 confirmed, D10 stays closed for this slice                                                           |
| K6  | **LID could ever carry the tail**                                    | E2's `c` against the break-even table — arithmetic, no experiment                    | `c < 0.49` → no achievable `L` reaches 0.72 and LID is dead as a standalone filler regardless of E3 Part A                                                          |
| K7  | **LID fits the budget**                                              | E3 step 2, one latency run at the existing contention cell                           | LID p95 pushes the speaker step past ~200ms or regresses STT p95 → rejected on cost regardless of accuracy                                                          |
| K8  | **The fill cannot degrade the acoustic layer**                       | E4 step 6 — one spec                                                                 | A filled turn reaches `buildCentroids` → the no-poison invariant is broken and the measured `acc imm` numbers no longer apply                                       |
| K9  | **`W=1` is safe**                                                    | E1's `W` sweep                                                                       | `A(W=1)` materially below `A(W=3)` → pending state is required after all, P3's amendment becomes a hard blocker, and open questions 2/4/5 reopen                    |
| K10 | **The bench can say anything at all**                                | P7-M11, already scheduled                                                            | Instrument unsound → E1 and E3 are void and re-run; E2 and the cascade's shape survive                                                                              |

---

## The residue this mechanism leaves

Every mechanism measured so far left one. Naming mine.

**R1 — wrong labels, and they are the point.** This mechanism converts abstention
into error by design. At the target it is ~1.5 wrong labels per 10 turns, and in a
_translation_ app a swapped chip puts the counterpart's words in the user's mouth
(D6's reasoning). Unlike the abstaining baseline, there is no visible signal that
a particular label is a guess beyond the `suggested` tone every machine label
carries. **This is the cost of D8 and it does not go away** — the residue moves
from missing labels to wrong ones, which is precisely the trade D8 chose.

**R2 — turns with no vector at all.** Sockets close before
`server.turn.embedding` for the last turns of a session: `MAX_IN_FLIGHT = 3`
(`use-streaming-translate.ts:30`) and the emit is guarded by `registry.holds`
(`translation-session.service.ts:350`). These turns reach C0/C1/C3 only — no
acoustic evidence ever. Size unmeasured; E4 must count them. This closes plan
open question 3 with a rule, not with a number.

**R3 — tail turns arriving while only one cluster exists.** C3 sends them to
ordinal 1, which is wrong exactly when the turn is speaker 2's debut. E1 measures
the size of this class. Unfixable within the cascade: with one cluster there is
no alternative ordinal to choose.

**R4 — the third speaker under `K_max = 2`.** Measured at exact-count 0.000 at
N=3 with `k_max=2`. The cascade cannot give a third person a third ordinal
because the ordinal does not exist. **Not solved here.** E4 reports the rate;
plan open question 1 owns the decision, and this plan's contribution is only that
the fill layer does not make it worse.

**R5 — the deadline's own residue.** At `W>1`, a turn that would have resolved at
`W+1` is force-assigned at `W` at lower accuracy. Priced by E1's sweep, not
assumed away. At `W=1` this residue is the entire resolved bucket — 6-9% of turns
at measured `acc res` 0.73-0.78 — which is exactly why `W=1` is adopted only when
tail accuracy meets or beats that.

**R6 — the recording fixture.** `p`, `G` and `c` come from one one-shot session
with 3-5 speakers in one room. Every threshold this plan ships carries that
provenance. The pre-decided response is to report ranges and decide both sides in
advance, never to re-run a one-shot fixture until it produces a convenient number.

---

## Open questions

1. **`W`, `G` and `T` must be pre-registered before E4, in writing.** The floor
   sweep's own limit 1 records what happens otherwise: selecting a parameter after
   seeing the curve is fitting. Who signs the registration is not specified here.
2. **Does `p` differ between the web page and the extension?** The extension
   captures meetings continuously with `MAX_IN_FLIGHT_INBOUND = 3` and no roster
   UI (`apps/extension/src/meeting-capture.ts:40-41`). E2 measures the web page
   only. The extension is unaffected today because it never asks for embeddings,
   but the question becomes live the moment it does.
3. **Is D12's operating point still the user's choice once the trade curve
   moves?** If E1 shows `W=1` is both faster and more accurate, the option D12
   rejected no longer exists in the form it was rejected in. This plan treats
   strict dominance as not requiring a new decision; that reading should be
   confirmed rather than assumed.
4. **What is the real `c` when the session is one-directional?** D10 keeps the
   session one-directional, so a counterpart speaking the other language is
   transcribed by an engine expecting the first. Whether real counterparts speak
   the other language at all — and therefore whether `c` is near 1 or near 0 — is
   a product-usage question M1 cannot answer and P2 only partly can.
5. **M1's turn-length distribution comes from a voice-off sitting.** All 21 turns
   carry `reason: "voice_off"` and none carries a playback timestamp. `TURN_S =
1.0s` — which every current bench number depends on — was selected from a
   sitting with no counterpart and no translated audio. That may still be the
   right value; it is not the same evidence it was read as.
6. **Does language mismatch degrade the centroids themselves?** §4.4's Misra &
   Hansen second-order risk. Nothing in this plan measures it, and if it is real
   it affects the acoustic layer this plan builds on rather than the fill layer
   this plan adds.
