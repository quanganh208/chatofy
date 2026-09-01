---
type: debate-candidate
candidate: B
date: 2026-09-01
question: 'OQ9 — what fills the ~35% of turns the acoustic layer cannot attribute?'
verification: every file:line below re-grepped in this session against working tree at feat/speaker-attribution-real-turn-length
---

# Candidate B — fill the tail from conversation structure the product already logs

## Recommendation

**Fill the tail with turn-linkage evidence the app already owns, not with a second
acoustic or language model.** The 35% tail is a _labelling_ residue (packet §2.6), and
a label can be reached two ways: by recognising the voice, or by knowing which
already-labelled turn this turn belongs with. The product logs the second kind of
evidence today and throws all of it away. Three facts, each re-verified: (a) every
number in the packet was measured on `order="shuffled"`, a uniformly random speaker
sequence — `run_session.py:487` sets that default, and `run_session.py:125-128` states
in the source that `alternating` "is what two-person dialogue actually does", so the
instrument discards turn-taking structure by construction; (b) the client already
holds `openedAt` / `closedAt` / `cutForced` per finished turn
(`packages/realtime-client/src/state/turn-keyed-transcript.ts:118-125`) and already
ships a conservative same-utterance continuation detector over them —
`continues()` at `packages/realtime-client/src/state/display-groups.ts:71-109`, whose
gap constant `MAX_CAPTURE_GAP_MS = 1200` (`display-groups.ts:47`) was calibrated on 22
real forced cuts (`display-groups.ts:36-41`) — used **for display only**
(`display-groups.ts:13`); (c) the server already stamps, per turn, when the translation
became available — `translatedAtMs: fallback - this.endpointAt`
(`apps/api/src/modules/translate/session/turn-timeline.ts:108`) — and in a mediated
interpreter a counterpart cannot be _replying_ to a translation that has not been
delivered. That last is a Must-Link constraint with a causal justification, and
Must-Link/Cannot-Link injection into speaker clustering is exactly the published
mechanism that cut DER 41% relative on 2-speaker calls (packet §4.2, Turn-to-Diarize).
The paper had to _learn_ its boundaries; here they fall out of the event log. Cost:
pure arithmetic on state already in the browser — microseconds, $0/month, **no wire
change** (so constraint C8's opt-in machinery is not touched), no server call, no new
privacy decision (constraint C4). D13 is satisfied structurally, because the link is
known at turn close, _before_ the embedding arrives
(`apps/api/src/modules/translate/services/translation-session.service.ts:349-358` emits
`server.turn.embedding` only after `server.transcript.final`). D8 is satisfied by a
bounded-deadline terminal rule in phase L4.

**Where this is weak, stated up front.** I checked the link predicate against the only
production telemetry on disk, `benchmarks/speaker-id/results/turn-metrics-m1.jsonl` (21
client rows, 22 server rows), and the naive version dies there: **`cutForced` is true on
0 of 21 turns**, so the shipped `continues()` predicate would fire never. The
delivery-gated version survives — **13 of 20 consecutive turn pairs opened before the
previous turn's translation was ready** — but that file is one capture run with every
row `outcome:"error"`, almost certainly one person talking, so it measures the
predicate's _firing rate_ and says nothing about its _precision_. My honest D8-denominator
projection is **0.80–0.85**, clearing the 0.85 bar only if the link fires on ≳60% of turn
pairs at ≳95% precision. Both numbers are unmeasured, both are cheap to measure, and
phase L3 is where they get measured. I am not claiming this clears the bar. I am
claiming it is the only candidate whose evidence channel is free, already logged,
CPU-trivial, and orthogonal to the duration/SNR regime that makes both SV _and_ LID fail
(packet §4.3).

---

## D8 and D13 — satisfied, and the price named

| Decision                                         | Status                                                           | How                                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D8** — every turn ends carrying an ordinal     | **Satisfied**                                                    | L4's terminal rule fires at a bounded deadline; coverage is 1.0 by construction, not by hope                                                                                                                                                                              |
| **D13** — filled _during_ the session            | **Satisfied**                                                    | Link propagation resolves at the neighbour's resolution instant (often zero extra wait); the terminal rule's deadline is measured in turns, not in "session end"                                                                                                          |
| **D12** — fewer wrong labels beats faster labels | **Honoured within D8's ceiling, and it does not survive intact** | D8 forbids permanent abstention, so D12 cannot mean "never guess". It is honoured as: never guess _before_ the deadline, and spend every free evidence channel before guessing. This is a real narrowing of D12 and it belongs in front of the user — see Open Question 1 |
| **D2** — a human edit is terminal                | **Preserved for free**                                           | `continues()` already refuses to merge across two disagreeing _confirmed_ attributions (`display-groups.ts:102-106`); the link layer inherits that rule                                                                                                                   |
| Self-reinforcement                               | **Structurally blocked already**                                 | `buildCentroids` skips any attribution whose `origin !== 'confirmed'` (`packages/realtime-client/src/state/speaker-centroids.ts:67`). A propagated or forced label can never seed a profile. Nothing new is needed                                                        |

**No new `AttributionOrigin` member.** Constraint C6 says the union's forcing function
catches 1 of 9 consumer sites, so a fourth member fails open at eight of them. Propagated
and forced labels are written as `origin: 'suggested'`
(`packages/realtime-client/src/state/speaker-roster.ts:33`) — semantically exact ("proposed
by the machine, not by a person"), and it dodges C6 entirely. This is the KISS answer and
it is why the plan needs no type-union migration.

---

## The accuracy model, on the D8 denominator

All turns. Not attributed turns. The packet records this error recurring twice (§2.7); the
arithmetic below is written out so it can be checked rather than trusted.

Measured inputs, 20-turn row, `abstain` / k_max=2 / floor 0.65 / campplus / far-field / N=2
/ cold / 1.0s (packet §2.4) **[measured]**:

- immediate share 0.5811 at accuracy 0.9379
- re-scored share 0.0680 at accuracy 0.7637
- unresolved share 0.3509

Introduced parameters:

- `q` = share of consecutive turn pairs carrying a link edge **[unmeasured]**
- `p` = precision of that edge (edge asserts same-speaker and is right) **[unmeasured]**
- tail turns reachable through a link to a resolved neighbour on either side
  ≈ `1 − (1 − 0.65)² = 0.877` **[guess, assumes the two sides are independent — they are
  not, adjacent turns correlate, so this is an optimistic ceiling]**

Propagated share = `0.3509 × 0.877 × q`, correct at `p × 0.93` (neighbour's own accuracy).
Forced remainder = `1 − 0.5811 − 0.0680 − propagated`, correct at 0.50 (blind guess at N=2).

| `q`  | `p`  | propagated share | forced share | **D8-denominator accuracy**                                                             |
| ---- | ---- | ---------------- | ------------ | --------------------------------------------------------------------------------------- |
| 0.65 | 0.95 | 0.200            | 0.151        | **0.849**                                                                               |
| 0.65 | 0.80 | 0.200            | 0.151        | **0.821**                                                                               |
| 0.40 | 0.95 | 0.123            | 0.228        | **0.826**                                                                               |
| 0.20 | 0.95 | 0.062            | 0.289        | **0.796**                                                                               |
| 0.00 | —    | 0.000            | 0.351        | **0.772** (packet's lower bracket, reproduced — the model is calibrated) **[measured]** |

**[guess, built from measured inputs]** The row at `q=0` reproduces the packet's 0.77
exactly, which is the check that the model is not inventing headroom. The best plausible
row lands at 0.849 against a 0.85 bar — _at_ it, not clear of it. **This plan does not
promise to clear 0.85.** It promises to move 0.77 toward 0.85 using free evidence, and to
tell you within two phases exactly where on that table you actually are.

---

## Phases

Dependency graph:

```
L0 (gate, no code) ──┬── L1 (bench + telemetry composition)  ──┐
                     ├── LX (LID independence check, parallel) ├── L4 (decision layer)
                     └── L2 (client link layer) ── L3 (one-shot recording) ──┘
```

L1, LX and L2 are parallel and touch disjoint files. L3 blocks on L2 (it needs the
predicate implemented to log its firing). L4 blocks on L2 and consumes L1/L3 numbers.

---

### L0 — Gate: decide what is still true if the instrument is broken

**Overview.** P7-M11 has not run (constraint: packet §5). Every phase must state its
dependence on the synthetic corpus _before_ anyone spends a day on it.

**Requirements.** No code. One written classification, reviewed before L1 starts.

**Architecture.** Three evidence tiers, and each phase declares which it stands on:

| Tier | Source                                                                                                                                                                 | Survives a broken bench instrument?                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| T1   | Production telemetry (`benchmarks/speaker-id/results/turn-metrics-m1.jsonl`) and client state                                                                          | **Yes** — no embedding, no corpus, no trial construction |
| T2   | Real-microphone recording (the never-run Phase 2)                                                                                                                      | **Yes** — new audio, new ground truth                    |
| T3   | Synthetic corpus (`results/embedding-cache.npz`, 31 speakers, one shared `RoomConfig()` / one RIR at `benchmarks/speaker-id/scripts/build_embedding_cache.py:151-152`) | **No**                                                   |

**Steps.**

1. Run P7-M11 first if it is cheap. If it is not, proceed — L2 and L3 do not wait on it.
2. Record per phase: L1 is **T1 + T3** (split: the telemetry half survives, the bench half
   does not). L2 is **T1**. L3 is **T2**. LX is **T3**. L4's _design_ is T1; L4's
   _calibrated constants_ are T3.
3. Publish the tier table beside the plan so a later reader knows which numbers evaporated.

**Behaviour if the instrument turns out broken.** L2, L3 and the T1 half of L1 proceed
unchanged and still answer OQ9's central question (`q` and `p`). What dies is the fusion
weighting in L4 and the entire LX verdict — both then fall back to L3's real recording as
the sole calibration source, which makes L3 one-shot for _two_ purposes instead of one.
That coupling is the reason L0 exists as its own gate.

**Success criteria.** A written tier assignment for every phase, and an explicit
"if P7-M11 fails we do X" line for each. Observable: the table exists and every phase
row is filled.

**Risks.**

| Risk                                                                  | Signal                                                          | Pre-decided response                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| P7-M11 fails and the team re-runs everything before proceeding        | Weeks pass with no L2/L3 progress                               | Proceed with L2/L3 regardless; they are T1/T2 and do not read the corpus                     |
| The tier table is written and then ignored when a T3 number is quoted | A T3 number appears in a shipping decision after a failed audit | Any T3 number carries a `[corpus-conditional]` tag in the artifact itself, not only in prose |

---

### L1 — What is the tail actually made of, and how often does a link exist?

**Overview.** Nobody has asked what the 35% _is_. It has been described (§2.4) but never
decomposed. Two cheap decompositions decide whether the whole plan is worth building.

**Requirements.**

- **R1.1** For the unresolved subset, report the joint distribution over: clip duration
  bucket (`DURATION_BUCKETS_S` at `benchmarks/speaker-id/speaker_bench/trials.py:27`), best
  cosine score, and _whether the immediately preceding turn in the same meeting was
  resolved_. That last column is the one that decides L2's ceiling.
- **R1.2** Re-run the §2.4 re-scoring diagnostic at `--order alternating`
  (`run_session.py:487`) as well as `shuffled`. Report both. Not to pick a winner — the
  source itself says neither is the truth (`run_session.py:125-128`) — but to expose how
  much of the tail is an artifact of a speaker sequence real dialogue does not produce.
- **R1.3** From `turn-metrics-m1.jsonl`, report `cutForced` rate, the inter-turn gap
  distribution, and the delivery-gate firing rate, with the sample's contamination stated.
- **R1.4** State every number on the D8 denominator.

**Architecture.** `build_schedule` (`run_session.py:173-200`) already takes `order` and
already refuses an unknown one (`:188-189`). R1.2 needs no new generator. R1.1 needs the
diagnostic harness to emit per-turn rows rather than per-meeting aggregates — a reporting
change, not an algorithm change; `Assignment` already carries `score`
(`benchmarks/speaker-id/speaker_bench/online.py:73-75`), which is the only field missing
from today's aggregates.

**Related files.**

- read: `benchmarks/speaker-id/run_session.py`, `speaker_bench/online.py`,
  `speaker_bench/scoring.py`, `results/turn-metrics-m1.jsonl`
- new: `benchmarks/speaker-id/run_tail_composition.py`,
  `benchmarks/speaker-id/results/tail-composition.csv`
- **not modified:** `speaker_bench/online.py`, `speaker_bench/settle.py` — this phase
  measures, it does not change behaviour

**Steps.**

1. Reproduce §2.4's 20-turn row exactly before adding a column. If it does not reproduce
   bit-for-bit, stop: the harness has drifted and every downstream number is void.
2. Add per-turn emission (turn index, truth speaker, assignment label, `score`, duration
   bucket, previous-turn-resolved flag).
3. Run `shuffled` and `alternating`; write both to one CSV with the `order` column the
   existing CSVs already carry (verified present in
   `benchmarks/speaker-id/results/1s-m7-alternating.csv` header, field 8).
4. Analyse `turn-metrics-m1.jsonl` for R1.3. **Already run in this session, reported here
   so L1 can start from it rather than rediscovering it [measured, n=21 turns / 20 pairs,
   single contaminated capture run]:** `cutForced` 0/21; gaps 191/300/513/690/759 ms and
   1070–6120 ms plus one 46.6 s idle; delivery-gate fires 13/20.
5. Publish, with every claim tier-labelled per L0.

**Success criteria.**

- §2.4's 20-turn row reproduces to 4 decimal places. _(observable: diff of two CSVs)_
- `tail-composition.csv` exists with ≥6 columns including `prev_resolved`.
- One sentence answering: _of unresolved turns, what fraction have a resolved immediate
  neighbour?_ That number is L2's coverage ceiling and it is currently unknown.
- Every reported figure states its denominator in the column header.

**Risks.**

| Risk                                                                                           | Signal                                                                                  | Pre-decided response                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The tail turns out to be uniformly distributed across duration — i.e. not a short-turn problem | Duration is flat across resolved/unresolved                                             | Report it loudly. It would contradict §4.3's premise that the residue is the short/quiet regime, and it _strengthens_ L2 (structure helps regardless of duration) while weakening any duration-targeted fix including fine-tuning (D11)                                                                                                                                                 |
| Unresolved turns cluster after _other_ unresolved turns                                        | `prev_resolved` low in the tail                                                         | L2's ceiling collapses; the propagation must run over connected components, not pairs. Already the L2 design — this risk is why                                                                                                                                                                                                                                                         |
| `alternating` and `shuffled` give identical tails                                              | Δ < 1pt                                                                                 | Expected, and not a failure: the current attributor uses no temporal evidence, so order _should_ be inert to it. Verified in this session on the existing artifacts — `1s-m7-alternating.csv` vs `1s-m2-unbounded.csv`, campplus/far-field/N=2/cold, prefix-locked 0.313/0.775/0.224 vs 0.274/0.756/0.250 across the three splits. It confirms the structure is unexploited, not absent |
| Split variance swamps the effect                                                               | Prefix-locked spans 0.22–0.78 across three splits (**observed** in the artifacts above) | Report per split, never pooled. Any effect smaller than the split spread is not measurable on 31 speakers and must wait for L3                                                                                                                                                                                                                                                          |

---

### L2 — The link layer (client-side, no wire change)

**Overview.** Turn a display-only continuation detector into an attribution evidence
source, and add the delivery-gated edge the interpreter loop makes available.

**Requirements.**

- **R2.1** A pure function producing, for each adjacent turn pair, one of
  `must-link` / `cannot-link` / `none`, from `captures` + delivery instants +
  `attributions`.
- **R2.2** Ordinals propagate along `must-link` edges from any acoustically-resolved
  member of a connected component to every unresolved member, written as
  `origin: 'suggested'`.
- **R2.3** A `confirmed` attribution always wins and never propagates _out_ of a component
  against another `confirmed` — the existing rule at `display-groups.ts:102-106`.
- **R2.4** No wire-schema change. No server change. No persistence.
- **R2.5** `continues()` is not duplicated. The linkage module composes it (DRY).

**Architecture — data flow.**

```
server.transcript.final ─┐
onTurnCaptured ──────────┤→ captures[sessionId] = {cutForced, openedAt, closedAt, deliveredAt}
playback metrics ────────┘                                    │
                                                              ▼
server.turn.embedding → embeddings[sessionId] ──→ acoustic layer → attributions (suggested)
                                                              │
                                            turn-linkage.ts ◄─┘
                                       (captures + attributions)
                                                              │
                                    components → propagate ordinal → attributions (suggested)
```

The edge predicates:

- **Must-link A (utterance continuation, already shipped for display).**
  `previousCapture.cutForced && 0 ≤ gap ≤ MAX_CAPTURE_GAP_MS`, i.e. `continues()`
  (`display-groups.ts:71-109`). Firing rate on the one production sample: **0/21
  [measured, contaminated]**. Keep it anyway — it costs one function call, its false-merge
  rate is bounded by a shipped behaviour, and `maxUtteranceMs` is configurable
  (`packages/realtime-client/src/conversation/conversation-session.ts:450`) so the rate is
  a deployment property, not a constant.
- **Must-link B (delivery gate, new).** Turn _t_ opened before turn _t−1_'s translation
  reached the counterpart. Causal claim: the counterpart is responding to a translation
  they have not yet received. Firing rate: **13/20 [measured, contaminated —
  single-speaker sample]**. Precision: **unmeasured**, and L3 is where it is measured.
- **Cannot-link (deliberately NOT shipped in L2).** "TTS played in between, so the
  counterpart is replying" is the obvious symmetric edge and it is the dangerous one: a
  wrong cannot-link splits one person into two ordinals, which packet §2.6 says is the
  problem that is _already solved_ (exact-count 0.9642). Specified here, gated behind L3's
  precision number, shipped only if L3 measures its precision above 0.95. **Do not ship a
  cannot-link on a guess.**

**Lifetime check (per verification discipline).** `captures` lives in
`TurnKeyedTranscript`, reset wholesale by
`case 'transcript.reset': return initialTurnKeyedTranscript;`
(`packages/realtime-client/src/state/turn-keyed-transcript.ts:306-307`, initial value at
`:129-138`). Session-scoped, browser-local, never persisted — so adding a field creates no
cross-session leak and no new privacy surface (constraint C5 unchanged).

**Enumerated callers of the interface being widened.** `TurnCapture` gains
`deliveredAt: number | null`. Every site, complete list, 4 of 4:

1. `packages/realtime-client/src/state/turn-keyed-transcript.ts:118-125` — definition
2. `packages/realtime-client/src/state/turn-keyed-transcript.ts:318` — reducer writes it
3. `packages/realtime-client/src/conversation/conversation-session.ts:169-172` — listener
   payload type; emitted at `:612-621` (`reportTurnCapture`)
4. `apps/web/src/hooks/use-streaming-translate.ts:278` — the only consumer
   (`onTurnCaptured: ({ sessionId, cutForced, openedAt, closedAt }) => …`)

`display-groups.ts` reads `captures` but only `cutForced`/`openedAt`/`closedAt`
(`:77-96`), so widening the record does not touch it.

The delivery instant is already client-side and needs no wire field: playback timing comes
from `ordered.metricsFor(turnId)` → `firstAudioPlayedAt` / `lastAudioPlayedAt`
(`conversation-session.ts:642-644`), and for a voice-output-off session the delivery
instant is the arrival of `server.transcript.final`. **This is the single most important
architectural property of the plan: the whole evidence channel is free of C8.**

**Related files.**

- new: `packages/realtime-client/src/state/turn-linkage.ts`,
  `packages/realtime-client/src/state/turn-linkage.spec.ts`
- modified (owned by L2 alone): `turn-keyed-transcript.ts`, `conversation-session.ts`
  (payload only), `apps/web/src/hooks/use-streaming-translate.ts`,
  `packages/realtime-client/src/index.ts` (export)
- read-only: `display-groups.ts`, `speaker-roster.ts`, `speaker-centroids.ts`

**Steps.**

1. Add `deliveredAt` through the 4 sites above. Ship this alone, behind nothing — it is an
   inert field, and it makes L3's logging possible.
2. Write `turn-linkage.ts`: `linkEdges(turns, captures, attributions) → Edge[]`, then
   `components(edges) → sessionId[][]`, then
   `propagate(components, attributions) → AttributionsBySession`. Pure, no I/O.
3. `propagate` writes only where `attributionFor(...).origin === 'fallback'`
   (`speaker-roster.ts:220-225`). It never overwrites `confirmed` and never overwrites an
   existing `suggested` (first writer wins, so propagation is idempotent and monotone —
   the invariant §2.4 credits re-scoring with).
4. Unit tests: a component with zero resolved members yields no writes; a component with
   two _disagreeing_ confirmed members is split at the disagreement; a component with one
   resolved member labels all; propagation is order-independent; re-running is a no-op.
5. Ship **behind the existing feature flag that already keeps the acoustic layer off**
   (`speaker-centroids.ts:44-47` records that the feature ships switched off). No new flag.

**Success criteria.**

- `pnpm --filter @chatofy/realtime-client test` green; new spec ≥ the file's existing
  coverage shape (each of `display-groups.spec.ts`, `speaker-roster.spec.ts` runs
  200–300 lines for a ~200-line module — match that density).
- `turn-linkage.ts` under 200 lines (project modularization rule) and importing
  `continues()` rather than re-implementing it.
- Zero changes under `packages/types/src/events/` — verified by `git diff --stat`.
- Measured: propagation over the L1 CSV replayed offline raises D8-denominator coverage
  from 0.649 to the value L1's `prev_resolved` column predicts, ±2pt.

**Risks.**

| Risk                                                                                | Signal                                                                                  | Pre-decided response                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Must-link B is wrong and merges two people**                                      | L3 measures precision < 0.90                                                            | Do not ship B. Fall back to A alone (0/21 firing → the plan degrades to L4's terminal rule and the honest answer becomes 0.77). This is the plan's kill condition and it is checked before L4                                               |
| `deliveredAt` is null for most turns (voice output off, synthesis failed)           | High null rate in L3 logs                                                               | Fall back to `server.transcript.final` arrival as the delivery instant; it is always present. Encode as a two-source field with a `source` tag, not a silent coalesce                                                                       |
| Barge-in: counterpart interrupts mid-TTS                                            | A turn opens while `playback.isPlaying`                                                 | Suppress must-link B whenever the new turn opened _during_ playback — that is precisely the barge-in case and the edge's causal premise fails. Cheap: `playback.isPlaying` is already wired at `conversation-session.ts:460`                |
| Clock skew between `openedAt` (client epoch ms) and server-derived `translatedAtMs` | Negative gaps                                                                           | `translatedAtMs` is a _duration_ relative to `endpointAt` (`turn-timeline.ts:108`), so it is added to a client-side instant and never compared across clocks. `continues()` already rejects `gap < 0` (`display-groups.ts:96`); mirror that |
| Two parallel turns in flight reorder                                                | Group ordering already known-hard (`display-groups.ts:114-134` documents the exact bug) | Reuse that module's slot-preserving sort verbatim rather than writing a second one                                                                                                                                                          |

**Rollback.** The feature flag is already off. Reverting is: stop calling `propagate`.
`deliveredAt` stays as an inert field — it is additive, optional, and read by nothing else.
No data migration exists to undo (nothing is persisted, C5).

---

### L3 — The one-shot real recording, re-specified to answer `q` and `p`

**Overview.** The real-microphone recording (the never-run Phase 2, packet §5) is one-shot
and currently specified to answer _one_ question: does the real channel resemble the clean
cell or the synthetic far-field cell (known unknown 7). **It must be re-specified to also
capture link-predicate ground truth in the same session, because there is no second
chance and the marginal cost is a log file.**

**Requirements.**

- **R3.1** Two speakers, one phone, one microphone, real conversation, ground truth by
  independent close-mic per speaker or by contemporaneous human annotation.
- **R3.2** Log, per turn: `openedAt`, `closedAt`, `cutForced`, `deliveredAt`,
  `playback.isPlaying at open`, true speaker.
- **R3.3** From that: measure `q` (edge firing rate) and `p` (edge precision) directly.
- **R3.4** Capture the near/far cue in the same pass (option 3, known unknown 4): log
  per-turn RMS and whether `autoGainControl` was enabled, and run a second short pass with
  AGC off. Costs minutes; it is the only chance to answer whether the cue survives AGC.
- **R3.5** ≥ 60 turns of genuine two-party dialogue, ≥ 2 sessions, so `p` has a confidence
  interval rather than a point.

**Architecture.** No new capture path. `reportTurnCapture`
(`conversation-session.ts:612-621`) already emits everything except `deliveredAt` (added
in L2) and the AGC/RMS fields. The recorder scaffolding exists at
`benchmarks/speaker-id/recorder/`.

**Related files.**

- read: `benchmarks/speaker-id/recorder/`, `packages/realtime-client/src/audio/capture-pump.ts`
- new: `benchmarks/speaker-id/results/real-channel-session-*.jsonl`,
  `benchmarks/speaker-id/run_link_precision.py`
- **not modified:** anything L2 owns. L3 consumes L2's shipped field; it does not edit it

**Steps.**

1. Write the annotation protocol _before_ recording. A one-shot session with ambiguous
   ground truth is a wasted one-shot session.
2. Dry-run the logging end-to-end on a solo session and confirm every field lands. The
   existing `turn-metrics-m1.jsonl` shows what a botched run looks like: 21 rows, every one
   `outcome:"error"` **[measured]** — evidence that a dry run is not optional.
3. Record. Both AGC states. Both directions of the toggle.
4. Compute `q`, `p`, and the cannot-link edge's precision separately.
5. Re-score the L1 tail composition against the real vectors.

**Success criteria.**

- `p` reported with a 95% interval on ≥ 60 turns.
- A go/no-go on must-link B stated as a single sentence with a number in it.
- The near/far RMS separation reported with and without AGC, as an effect size.
- The original Phase 2 question (clean vs far-field cell) answered unchanged — the
  additions must not have displaced it.

**Risks.**

| Risk                                                                              | Signal                                    | Pre-decided response                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adding scope to a one-shot recording causes it to fail at its original purpose    | The channel question comes back ambiguous | Ordering: the channel measurement is captured first and completely; the link fields are _additional columns on the same rows_, so they cannot displace it. If the session must be cut short, it is cut after the channel pass   |
| Two speakers who are both the developer's household are not the target population | n/a — it is certain                       | State it. It bounds `p`'s external validity, and it is still infinitely better than zero real-channel data                                                                                                                      |
| Ground truth annotation disagrees with itself                                     | Two annotators disagree > 5%              | Discard disputed turns from `p`'s denominator and report the discard rate. Do not adjudicate                                                                                                                                    |
| Real `cutForced` rate is again ~0                                                 | 0 forced cuts in 60 turns                 | Must-link A is dead in this deployment. Report it and rely on B alone; also check whether `maxUtteranceMs` is set high enough that the ceiling never fires, which would make A recoverable by configuration rather than by code |

---

### LX — The LID independence check (parallel, cheap, does not block)

**Overview.** Packet §4.3 says D10's load-bearing assumption is unverified and the indirect
signal leans against it, and that it is testable on data in hand. This plan does **not**
build on LID — but it would be unjustified to discard it without the check, so the check
runs in parallel and its result changes L4's evidence set if it passes.

**Requirements.**

- **RX.1** Run an LID model over exactly the turns the SV layer left unattributed in L1's
  run, and over the attributed ones, and report LID error **conditioned on SV outcome**.
  The number that matters is `P(LID wrong | SV unresolved) / P(LID wrong | SV resolved)`.
- **RX.2** Report on the D8 denominator: if LID were fused, what share of _all_ turns
  change label and how many change _correctly_.
- **RX.3** Price it: CPU ms per turn on the production box (i7-11700K, 4 speech threads —
  constraint C1) against the ~200ms speaker budget (constraint C2). No published CPU
  number exists for ~1s VI/EN clips (packet §4.4), so this must be measured, not cited.
- **RX.4** Licence gate: `langid_ambernet` ships under NGC Terms, not OSS (packet §4.4).
  Screen candidates for licence first, as the model screen already did
  (`plans/.../reports/measurement-260831-1730-phase-05-model-screen.md`).

**Architecture.** The corpus is Vietnamese speakers only. **That is the blocking problem
nobody has stated: a VI-only corpus cannot measure a binary VI/EN discriminator's error on
English turns.** So RX.1 measures only the VI half of the confusion matrix, and the EN half
is unmeasurable until L3 provides real bilingual audio. Say so rather than reporting half a
matrix as a result.

**A second, nearly-free channel worth one hour.** On the cascade path the server already
has `translated.sourceText` per turn
(`apps/api/src/modules/translate/services/translation-session.service.ts:334`), so _text_
LID is available at zero audio cost and is far stronger than audio LID at 1s. It is
confounded — the STT is direction-locked (`session.direction` at
`apps/api/src/modules/translate/session/turn-session.ts:111`, `FINAL_MODELS` at
`translation-session.service.ts:311`), so the transcript's language partly reflects a
_toggle setting_ rather than the speaker. Worth exactly one confusion matrix on L3's real
bilingual recording, and no more until that says something.

**Related files.** New: `benchmarks/speaker-id/run_lid_conditional.py`,
`results/lid-conditional.csv`. Modifies nothing.

**Success criteria.** One number: the conditional error ratio, with the VI-only caveat in
the same sentence. A stated verdict on D10: _viable / dead / undecidable on this corpus_.

**Risks.**

| Risk                                                                                      | Signal                        | Pre-decided response                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LID error on the SV-unresolved subset ≈ error on the resolved subset (independence holds) | Ratio ≈ 1.0                   | D10 becomes a live option and returns to the user with a measured basis — but it still costs CPU inside a 200ms budget and still needs the EN half of the matrix. Do not fold it into L4 without RX.3 |
| Ratio ≫ 1.0 (errors coincide, as §4.3 predicts)                                           | Ratio > 1.5                   | D10 is dead for the tail. Record it as a retired option with a number, which is worth more than the current unresolved state                                                                          |
| The check is undecidable on a VI-only corpus                                              | Cannot construct EN negatives | Report `undecidable`, defer to L3, and do not let anyone read "undecidable" as "promising"                                                                                                            |

---

### L4 — The decision layer: prior, fusion, and the terminal rule that closes D8

**Overview.** After L2, some tail turns still have no link and no acoustic answer. L4 is
what happens to them, and it is where D8 is actually discharged.

**Requirements.**

- **R4.1** A per-session turn-taking prior estimated **online from the confident subset**:
  over turns the acoustic layer resolved (65%, at 0.9379 accuracy **[measured]**), count
  hold-vs-switch transitions and maintain a Beta-smoothed switch probability. No external
  statistic needed, no ground truth needed, self-calibrating to the actual conversation.
- **R4.2** Log-likelihood-ratio fusion of the acoustic score with the prior (packet §4.5:
  standard and low-risk to implement, but no measured gain exists — so the gain must be
  established here, on L1's CSV, before it ships).
- **R4.3** **The terminal rule.** A turn still unresolved after `D` subsequent turns is
  assigned by `argmax` of the fused posterior and written `origin: 'suggested'`. `D` is a
  turn count, not a wall clock, and not "session end" — this is what makes D13 true.
  Starting value `D = 6`: the p90 wait for a _resolvable_ turn at 20-turn sessions is 11
  turns and at 10-turn sessions is 6 (packet §2.4), and D12 says prefer correctness, so `D`
  sits at the shorter session's p90 and is swept in L1's replay.
- **R4.4** Coverage is 1.0 at all times after the deadline. Assert it in a test.
- **R4.5** Every accuracy number produced by this phase carries the all-turns denominator
  in its column header.

**Architecture — the residue of this mechanism, named.**

| Layer                | What it resolves                                                    | What it leaves                                                                               |
| -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Acoustic (existing)  | 0.5811 immediate + 0.0680 re-scored **[measured]**                  | 0.3509 **[measured]**                                                                        |
| L2 link propagation  | `0.3509 × 0.877 × q` **[model; q unmeasured]**                      | tail turns in components with no resolved member                                             |
| L4 prior + fusion    | turns where the prior is decisive (switch probability far from 0.5) | turns where the prior is near-uniform **and** acoustics are ambiguous **and** no link exists |
| **L4 terminal rule** | **all of it, by force**                                             | **wrong labels — not missing ones**                                                          |

**The final residue is a wrong-label rate, and it is roughly `forced_share × 0.5`** — 7.5pt
of overall accuracy at `q=0.65`, 14.5pt at `q=0.20` (table above). It does not shrink with
session length; §2.4 measured that the tail _rises_ with length, and nothing in L4 changes
that. **This plan leaves a residue and the residue is permanent.** The only levers on it are
`q` (L3), `p` (L3), and the terminal rule's own accuracy — which is 0.50 only if the prior
is uninformative. If the estimated switch probability is, say, 0.75, the terminal rule's
accuracy on the residue is 0.75, not 0.50, and the two low rows of the table move up ~4pt.
That is the single cheapest remaining improvement and it needs no new model.

**Related files.**

- new: `packages/realtime-client/src/state/turn-ordinal-decision.ts` + spec
- modified (L4 alone, after L2 lands): `turn-keyed-transcript.ts` (one reducer action for
  the deadline sweep)
- read-only: `turn-linkage.ts` (L2's), `speaker-centroids.ts`, `speaker-roster.ts`

**Steps.**

1. Replay L1's per-turn CSV offline through candidate rules and sweep `D` ∈ {3, 6, 10, ∞}
   and fusion weight. Pick on the D8 denominator. Offline first — this is free and the
   client change is not.
2. Implement the prior as a two-state transition count over `suggested`+`confirmed` turns,
   excluding link-propagated turns from the count (they are not independent evidence —
   counting them would let the link layer vote twice).
3. Implement the deadline sweep as a reducer action fired on each new final transcript, not
   a timer — no wall clock, no `setInterval`, deterministic and testable.
4. Assert coverage 1.0 in a test that runs a synthetic 40-turn session with every embedding
   deliberately ambiguous.
5. Re-verify: nothing written by this layer has `origin: 'confirmed'`, so
   `buildCentroids` (`speaker-centroids.ts:67`) still cannot be poisoned.

**Success criteria.**

- Offline replay reports D8-denominator accuracy at the chosen `D`, with the packet's
  `q=0` row (0.772) reproduced as the control.
- Coverage test passes: zero turns end a session with `origin: 'fallback'`.
- No turn's ordinal changes after it was written (monotonicity test) — the invariant §2.4
  credits re-scoring with, preserved.
- `D` justified by a swept number in the artifact, not by a comment.

**Risks.**

| Risk                                                                                                                   | Signal                                                                                                                                   | Pre-decided response                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fusion gain is zero** (no published gain exists — §4.5)                                                              | Offline replay shows < 1pt over prior-alone argmax                                                                                       | Ship prior-alone argmax. It is simpler, and LLR fusion with no measured gain is exactly the kind of machinery this repo's bench exists to refuse                                                                                                                        |
| The online prior is estimated from a biased subset — confidently-resolved turns may be systematically the _hold_ turns | Estimated switch rate differs sharply from the rate on L3's ground-truth session                                                         | Compare the two in L3. If they differ > 0.1, the prior is biased and must be corrected against L3's rate or dropped                                                                                                                                                     |
| The terminal rule ships a wrong label a user reads as fact                                                             | Cannot be detected in-product — nothing is logged (`attribution-stats.ts` is derived, never accumulated, and nothing leaves the browser) | Render `suggested` at reduced weight, distinguishable from `confirmed`. That is a UI requirement, and it collides with the project's one-accent-control rule (`.claude/rules/development-rules.md`) — it must be a weight/opacity distinction, not a second accent fill |
| D12 is materially narrowed and the user never agreed to the narrowing                                                  | n/a — it is certain                                                                                                                      | Open Question 1. This goes back to the user before L4 ships, not after                                                                                                                                                                                                  |
| `D=6` leaves a turn visibly blank for six turns on a phone screen                                                      | UX review                                                                                                                                | The chip's `fallback` state already exists and already renders as "nobody attributed this" (`speaker-roster.ts:27-32`). Six turns of that is the _current_ behaviour for 35% of turns, permanently. L4 strictly improves it                                             |

**Rollback.** L4 is the last writer in the chain and writes only `suggested` over
`fallback`. Reverting it returns the product to L2's behaviour, which returns to today's
behaviour if L2 is also reverted. No cascade: nothing downstream branches on a value only
L4 produces, because L4 produces no new value — only more `suggested` rows.

---

## What I would kill it with

Cheapest experiment per major claim, and the result that kills it.

| #   | Claim                                                                                        | Label                                                          | Cheapest experiment                                                                                                                                                                            | Kills it                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | **Must-link B (delivery gate) is high-precision** — the load-bearing claim of the whole plan | **[guess]**; firing rate 13/20 is **[measured, contaminated]** | L3: 60 turns of real two-party dialogue with ground truth, already-logged fields plus `deliveredAt`                                                                                            | `p < 0.90`. The plan collapses to L4-alone and the honest answer to OQ9 becomes "force-assign at 0.77 and tell the user the bar is not met"                                                                                                                                            |
| K2  | Tail turns have resolved neighbours often enough to propagate to                             | **[guess]**                                                    | L1 R1.1: one extra column, `prev_resolved`, on a run that is already being made                                                                                                                | `prev_resolved` < 0.4 in the tail. Propagation ceiling falls below 15% of the tail and L2 is not worth its 4-site interface change                                                                                                                                                     |
| K3  | Turn-taking structure is exploitable at all                                                  | **[published]** (Turn-to-Diarize, 41% relative at N=2)         | L1 R1.2: `--order alternating`, a flag that already exists (`run_session.py:487`)                                                                                                              | Nothing — this one _cannot_ be killed by the bench, because the current attributor has no temporal input, so order is inert to it by construction. Verified in this session on the existing artifacts. Anyone reporting "no order effect" as a refutation has measured the wrong thing |
| K4  | LID does not rescue the tail                                                                 | **[published, indirect]** (§4.3)                               | LX: LID conditioned on SV outcome, on the corpus in hand                                                                                                                                       | Conditional error ratio ≈ 1.0 → D10 is live again and this plan should be re-run with LID as a fourth layer                                                                                                                                                                            |
| K5  | The residue force-assign scores ~0.50                                                        | **[guess]** — packet §5 known unknown 5, never measured        | L4 step 1: offline replay, free                                                                                                                                                                | If it scores 0.65+ (a decisive prior), the whole table moves up ~5pt and L2's `q` matters much less. **This is the cheapest experiment in the entire plan and it should run first**                                                                                                    |
| K6  | This all runs inside 200ms on CPU                                                            | **[measured, by construction]**                                | Nothing to run — L2 and L4 are integer/float arithmetic over ≤ 40 turns of already-resident client state, executed in the browser, not on the i7-11700K at all. Zero added server ms, $0/month | A profile showing > 1ms. If it somehow does, cache the component structure incrementally                                                                                                                                                                                               |

**If I had one day, I would run K5 and K2 — both are offline replays of a run that already
exists — and only then decide whether L3 is worth its one shot.**

---

## What happens if P7-M11 says the instrument is broken

- **L2 is unaffected.** It reads no corpus and no embedding cache; it is arithmetic on
  `captures`. Its correctness is decided by unit tests and by L3.
- **L3 is unaffected.** It is new audio with new ground truth. It becomes _more_ important,
  because it is then the only surviving evidence source.
- **L1's telemetry half survives** (`turn-metrics-m1.jsonl` is production, not corpus);
  its bench half (tail composition, `prev_resolved`) dies and must be re-derived from L3.
- **LX dies entirely.** It is corpus-only.
- **L4's design survives; its constants do not.** `D`, the fusion weight, and every row of
  the accuracy table above are corpus-conditional. They would be re-swept on L3's data,
  which means L3 needs enough turns to sweep on — a reason to record more than the 60-turn
  minimum if the audit is still pending when L3 runs.
- **The 0.77–0.85 bracket becomes unquotable.** Its inputs (0.5811 / 0.9379 / 0.3509) are
  all corpus numbers. The plan would then have _no_ accuracy estimate until L3 lands, and
  saying so is better than carrying a number whose instrument failed.

---

## Open questions

1. **D12 is narrowed by D8 and the user has not agreed to the narrowing.** D8 forbids
   permanent abstention; D12 says fewer wrong labels beats faster labels. Together they can
   only mean "delay the guess, then guess anyway". The user chose D12 when shown
   "6 of 10 labelled with ~0.7 wrong" versus "10 of 10 with ~4 wrong". This plan delivers
   roughly _10 of 10 labelled with ~1.5–2.3 wrong_. That is a third option the user has
   never been shown, and it is materially better than the one they rejected — but it is not
   the one they chose. **It should go back to them as a number before L4 ships.**
2. **Is `voiceOutput` on in the real deployment?** Must-link B's causal premise is
   "the counterpart heard the translation". If voice output is off and the counterpart
   reads the screen, the delivery instant is much earlier and the edge fires far less.
   `voiceOutput` defaults true (`turn-session.ts:114`) but is per-session and settable.
   Unresolved; L3 must record it.
3. **What is `maxUtteranceMs` in the shipped deployment?** `cutForced` fired 0/21 in the
   only production sample. If the ceiling is set so high it never fires, must-link A is
   recoverable by configuration; if it fires and the sample is unrepresentative, A is fine.
   `runtime.maxUtteranceMs` is caller-supplied (`conversation-session.ts:450`) and I could
   not find a shipped default in `apps/web`. **[UNVERIFIED]**
4. **Does the acoustic layer actually run in production yet?** `speaker-centroids.ts:44-47`
   says the feature ships switched off, and `TAU_SUGGEST = 0.35` (`:54`) was calibrated on
   a channel the product does not use. Whether the 65% resolved share exists in the real
   product, or only in the bench, is not established anywhere I could find.
5. **Cannot-link is specified but not scheduled.** It is the natural symmetric edge and it
   is the one that can create splits — the failure mode packet §2.6 says is already solved.
   Should it be measured in L3 (nearly free) even though L2 will not ship it?
6. **Three speakers (D3).** Everything above is reasoned at N=2. A binary hold/switch prior
   does not generalise to N=3; the link edges do. At N=3 the prior degrades to "switch to
   _someone_", which is worth 0.5 not 1.0 on the residue. Unaddressed, and the plan should
   say what N=3 costs before it ships.
7. **`prev_resolved` in L1 is measured on shuffled meetings**, where "previous turn" has no
   conversational meaning. Its value under `alternating` will differ. Which one predicts the
   real product is unknown until L3 — the same known unknown 7 the channel question has.

---

Status: DONE
Summary: Recommends filling the tail by propagating ordinals along Must-Link edges derived
from turn timing the client already logs (`cutForced` + a new delivery-gate edge), then a
self-calibrating turn-taking prior, then a bounded-deadline terminal assign that discharges
D8 in-session; projects 0.80–0.85 on the all-turns denominator and does not claim to clear
the bar.
Concerns/Blockers: The load-bearing edge's precision is unmeasured and its firing rate was
measured on a contaminated single-speaker sample (`cutForced` 0/21, delivery gate 13/20);
the one-shot real recording must be re-specified to measure it, and D12 is narrowed enough
by D8 that it should go back to the user with a number.
