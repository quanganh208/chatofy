---
title: 'Vietnamese display ITN and gemma removal'
description: 'Replace the late LLM display repair with a deterministic in-process ITN, and remove gemma-4-31b-it from the system. Digits appear when the line first paints, in one convention, and never change afterwards.'
status: complete — except A13b (needs a browser)
priority: P1
effort: '~5.5d'
tags: [stt, translate, ai-providers, benchmark, thesis]
created: 2026-08-29
blockedBy: []
blocks: []
supersedes: [260827-2150-vi-transcript-display-and-turn-merge#phase-04]
---

# Vietnamese display ITN and gemma removal

## Overview

The shipping Vietnamese recognizer emits no digits and no punctuation — 0/50 on
VIVOS (`benchmarks/stt/results/r1/sherpa-zipformer-vi.jsonl`), a vocabulary
limit, not a tuning gap. Phase 4 of
`plans/260827-2150-vi-transcript-display-and-turn-merge/` answered that with a
second Gemini request on `gemma-4-31b-it` that rewrote the line **after** it was
already on screen.

It works, and the user rejected it anyway, for reasons the measurements support:

- **It is too late to be a correction.** Measured over the 22-utterance corpus:
  median 25.1s, max 92.6s, and a **minimum of 10.0s**. Not one repair in 22
  landed inside 10 seconds. The reader has moved on.
- **It is not one convention.** Four independent sources of variation ship
  simultaneously — recall is 0.8810 not 1.0; the guard rejects ~9% of turns back
  to raw; a failed/over-ceiling turn does the same; and prompt rule 6 contradicts
  rule 2, which is what produced both guard rejections.

The accepted answer, decided in
`plans/reports/brainstorm-260828-1719-vi-display-deterministic-itn.md`
(ultra best-of-5, winner cand-a, plus user decisions D1-D5): **produce the digits
deterministically, in-process, before the line ever paints.** No model, no
network, no second event. `gemma-4-31b-it` leaves the system entirely.

This plan does not touch the recognizer, the audio path, or the WebSocket schema.

### The question that framed this, answered

> "Không thể nào nói phát text hiển thị đúng luôn mà không cần phải sửa sao?"

**The recognizer never can. The display can — with no model at all.** The decoder
is not the lever (the superseded plan's phase-06: greedy 5.38 WER vs beam
5.38, CER 0.04 pt worse).
Swapping to PhoWhisper is not either (RTF 0.3316 over the 0.3 gate, 971.5 MB peak
RSS, p50 20x worse — and still 0/50 digits). Digits must be produced _after_
recognition; the only real choice was a remote model at 10-92s or a local
function at <1 ms.

### Display convention — a constant in code, not a request to a model (D1)

`6:00 ngày 10/02/2026`

| element   | rule                                                                          |
| --------- | ----------------------------------------------------------------------------- |
| clock     | `H:MM`, 24-hour                                                               |
| date      | zero-padded `DD/MM`, four-digit year when spoken                              |
| `ngày`    | **kept** where spoken — this is what makes "change no words" satisfiable      |
| decimal   | comma (`0,4`)                                                                 |
| thousands | dot (`2.500`, `120.000`) — **D6**, added after red-team found D1 silent on it |
| units     | stay as spoken (`0,4 mét`, never `0,4 m`)                                     |

Keeping `ngày` is not cosmetic. Dropping it was prompt rule 6's instruction and
the sole cause of both divergence-guard rejections; keeping it dissolves the
contradiction instead of picking a side.

## Goals

| #   | Goal                                                                                                             | Priority |
| --- | ---------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | The **finished-turn** Vietnamese line appears once, already carrying digits, and never changes afterwards        | P1       |
| 2   | One convention, unreachable-by-construction alternatives: `17 giờ` cannot occur because no code path can emit it | P1       |
| 3   | `gemma-4-31b-it` removed from every model list, prompt, benchmark and doc                                        | P1       |
| 3b  | **Both** directions keep a typeset display: Vietnamese and English each get a deterministic ITN (D9)             | P1       |
| 4   | Zero numeral hallucinations, evidenced on utterances the implementation has never seen                           | P1       |
| 5   | Raw engine output stays canonical and is still the only input to WER                                             | P1       |
| 6   | The punctuation/capitalization regression published as a number, not dropped silently                            | P1       |

## Phases

| #   | Phase                                                                                                 | Status                     |
| --- | ----------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | [Phase 1: Re-baseline the corpus to the D1 convention](./phase-01-rebaseline-corpus-to-convention.md) | **Complete**               |
| 2   | [Phase 2: Deterministic ITN module and its evidence battery](./phase-02-deterministic-itn-module.md)  | **Complete — gate passed** |
| 3   | [Phase 3: Session-service swap](./phase-03-session-service-swap.md)                                   | **Complete**               |
| 4   | [Phase 4: Deletion sweep](./phase-04-deletion-sweep.md)                                               | **Complete**               |
| 5   | [Phase 5: Live verification and published record](./phase-05-verify-and-publish.md)                   | **Complete except A13b**   |

## Outcome — 2026-08-29

**Shipped.** Numeral recall **1.0000** (against the LLM's 0.8810), **0
hallucinations** in-sample and on both held-out negative sets, at **0.206 ms p95**
instead of a 25.1 s median. `gemma-4-31b-it` is gone from every model list,
prompt, benchmark and current doc. 2,423 lines deleted.

**The two costs, in the headline because they are real:** punctuation F1 and
proper-noun capitalization both fall to **0.0000** (`Phạm Văn Bạch` displays as
`phạm văn bạch`), and English has **no in-sample spoken recall figure at all** —
no such corpus exists, so its recall rests on a hand-written round-trip set.

**One criterion is not met: A13b.** The server half of the live check is done —
three real turns through the real WebSocket with real audio, each carrying its
digits on the transcript event with zero second events. The browser half needs a
person: proving a single commit with no words-form flash needs a screen
recording, and no live partial line was observed to record. Neither is claimed.

Open question 1 is answered below; question 2 is closed by D12.

**Dependencies and ordering hazards.**

- **Phase 1 must come first, for a mechanical reason.**
  `benchmarks/stt/stt_bench/display_fidelity.py` defines hallucination as a
  **multiset difference** and states that a _reformat_ costs both a recall miss and
  a hallucination. So a correct ITN `02/09/1945` scored against the current
  reference `2/9/1945` registers as a hallucination — **A2 is unmeasurable until
  the references carry the target convention.** Re-baselining needs no new
  recording: all 22 `.wav` files are present and transcription is deterministic.
- **Phase 2 is the abort point.** It lives entirely in `packages/ai-providers` and
  `benchmarks/`. If A2 = 0 proves unreachable, the plan stops with `main` untouched
  and nothing deleted. That is why no deletion precedes it.
- **Phase 3 is one file, and its swap-in and rip-out are inseparable** — they are
  the same function at `translation-session.service.ts:348`. Splitting them would
  leave two producers of `server.transcript.display` and violate A6. Its two repair
  specs are replaced in the same phase, or the suite is red between phases.
- **Phase 4 deletes only what Phase 3 stranded**, plus gemma — the same act, since
  gemma is a model nothing calls any more. Inside it, ordering matters: the
  prompt-injection `'repair'` arm and `repair_display_hypotheses.mjs` both call into
  the code being deleted, so they go first.
- `packages/ai-providers/src/index.ts` is edited in Phase 2 (add) and Phase 4
  (remove). Sequential — never parallelize those two.
- Phase 5 depends on Phase 1 as well as Phase 4: it publishes the comparison table
  Phase 1 produces half of.

## Constraints

- **`segment.sourceText` stays RAW** (`turn-keyed-transcript.ts:320`,
  `ws-events.ts`). WER, MT context history and `display_fidelity.py` all depend
  on it. The ITN result travels as `display`, never as the record.
- **`normalize_text` must never be applied on the display-fidelity path.** It
  erases exactly what this measures.
- **Reuse the DATA in `packages/ai-providers/src/text/repair-number-vocabulary.ts`
  (345 LOC, KEPT) — but not its tier semantics.** Do not restate a flat number
  list: that file documents, with measured scores, a flat list producing a perfect
  0.0000 while letting `tôi không đồng ý` -> `Tôi 0 đồng ý` through — a **reversed
  sentence** in the speaker's own words. Its `neverAlone` tier becomes the ITN's
  hard suppression.
  **However, guard tiers are not generator tiers (D7).** The guard asks "may this
  word appear on the repaired side?"; a generator asks "does this word belong
  INSIDE a numeral?". Those are different predicates, and `filler` conflates two
  disjoint kinds of word. The ITN defines its own mapping over the same data —
  see Phase 2. The data file itself is not edited.
- **`normalizeTranscript()` only; never `foldForMatch()`.** The latter is lossy by
  design and must never reach a screen.
- **Client contract changes ADDITIVELY only (D10).** `server.transcript.final`
  gains an **optional** `display?: string`, present only when the ITN changed
  something. Old tabs ignore an unknown optional field, so there is still no
  deploy-window "Unexpected event shape". This replaces the earlier
  "no schema change" constraint, which red-team showed could not deliver Goal 1:
  two separate events are two WS frames and two macrotasks, and React batches
  within a task, not across them — so a same-tick server emit still produced a
  one-frame flash of the words-form.
  `server.transcript.display` stays **declared** (an old client still handles it)
  but the server stops emitting it. The `repairDisplay` opt-in flag stays and keeps
  gating; its name becomes a misnomer, and renaming it is still a separate breaking
  decision, deliberately not taken.
- **Do not touch the audio path**, the VAD constants, or the recognizer.
- **Thesis integrity.** Displayed text must never reach the benchmark or the WER
  table. `data/display-repaired.jsonl` is the evidence record behind every number
  quoted in the brainstorm — **keep it, do not regenerate or delete it.** The ITN
  arm writes alongside it.
- Files >200 LOC modularize; kebab-case names.

## Non-goals

- Replacing or retuning the recognizer; promoting hotwords to the shipping engine.
- Phase 3 of the superseded plan (offline capture-vs-model diff) — still pending,
  not absorbed here.
- ~~Building an English ITN~~ — **reversed by D9.** Red-team showed `en_to_vi` was
  being deleted while listed as a non-goal: the repair it uses today is
  language-parametric and dies with everything else. Rather than let English
  display silently stop, both directions get a deterministic ITN. The English
  vocabulary already exists in `repair-number-vocabulary.ts` (61 counting, 17
  filler, 21 neighbour, 4 `neverAlone` with the measured `a`/`second`/`march`/`may`
  traps), which is why this is affordable.
- Typewriter / erase-and-retype animation. Rejected: it assumes the objection is
  that the swap is _invisible_. At p90 = 71.0s the animation fires three or four
  turns later, pulling the eye off the live turn onto stale content. Motion makes
  a late correction more intrusive, not less.
- Restoring punctuation or proper-noun capitalization by any means. That loss is
  accepted and published (Goal 6). Recovering it later from the English
  translation was prototyped on 2026-08-29 and measured **1 of 3 correct, 1
  actively wrong** (`bệnh viện bạch Mai`) — recorded as a candidate, not scope.
- Renaming the `repairDisplay` client flag.

## Success Criteria

| #   | Criterion                                                                                                                                                                                                                        | Evidence producer                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A1  | Numeral recall **>= max(re-baselined LLM figure, 0.8810)** — the bar never falls with the ruler change — with both LLM columns disclosed beside it                                                                               | `display_fidelity.py` over the re-baselined manifest             |
| A2  | **Numeral hallucinations = 0, on held-out utterances**                                                                                                                                                                           | Phase 2 tier-2 gate over `results/r1/sherpa-zipformer-vi.jsonl`  |
| A3  | Zero variance: same input -> byte-identical output, 100 runs                                                                                                                                                                     | unit test in `packages/ai-providers/src/text/`                   |
| A4  | Convention uniformity: 0 occurrences of `\d+\s*giờ`, `\d+\s*phút` in clock context, or `tháng\s+\d+\s+năm\s+\d` in displayed output                                                                                              | grep assertion in the same spec                                  |
| A5  | Displayed text differs from `segment.sourceText`; `turns[].sourceText` unchanged                                                                                                                                                 | existing `turn-keyed-transcript` assertion pattern               |
| A6  | At most one display value per turn, emitted in the same handler tick as `transcript.final`, **and only when the ITN actually changed the text**                                                                                  | `translation-session.service` spec                               |
| A7  | Added per-turn latency < 5 ms p95                                                                                                                                                                                                | micro-benchmark in the package's tests                           |
| A8  | `neverAlone` holds: `tôi không đồng ý`, `hai mươi không đủ`, `anh ba năm nay không đi` produce zero digits for those spans                                                                                                       | table test reusing `repair-number-vocabulary.ts`                 |
| A9  | VIVOS WER unchanged at 5.38%                                                                                                                                                                                                     | re-run `benchmarks/stt/run_benchmark.py`, vi set                 |
| A10 | Punctuation F1 and proper-noun capitalization recorded at their new values (expected 0.0000 each, from 0.7222 / 0.8636) **in the phase record**                                                                                  | `display_fidelity.py`                                            |
| A11 | `grep -ri gemma` over `apps/`, `packages/`, `benchmarks/`, `docs/`, `README.md` returns only historical narrative in `development-journey.md`                                                                                    | grep                                                             |
| A12 | The display scoring sequence runs end-to-end **with no API key set**, and is wired into CI                                                                                                                                       | Phase 5 record                                                   |
| A13 | **One real browser session** verified end to end: the FINISHED line paints with digits in a **single commit** — no words-form flash — and never changes afterwards, **and the report records what the live partial line showed** | Phase 5 recording                                                |
| A14 | An `en_to_vi` turn is typeset by the **English** ITN, never by the Vietnamese one; `ws-events.ts`'s bidirectional contract still holds                                                                                           | `translation-session.service` spec                               |
| A16 | English numeral hallucinations = 0 on the 50 held-out moonshine utterances                                                                                                                                                       | `itn_holdout_check.mjs`, EN arm                                  |
| A15 | A throwing ITN cannot fail the turn: audio still delivered, turn closes `completed`                                                                                                                                              | `translation-session.service` spec with an injected throwing ITN |

**A2 is the make-or-break criterion.** Everything else is recoverable; a digitized
negation is a sentence reversed on screen in the speaker's own words, with nothing
marking it.

## Open questions

1. **Is synthesized held-out recall enough for the thesis?** — **Partly, and the
   honest answer is now evidenced rather than argued.** All three tiers were
   built, and each caught defects the others could not: in-sample caught two
   grammar faults, held-out negatives caught **four hallucinations** unreachable
   from the 22 utterances, and the round-trip set caught **four more** that
   neither could see. That is the strongest available case that the tiers are not
   redundant. What it still cannot do is put an ASR error in front of the ITN:
   tier 3 is clean text, so it measures the grammar and not the pipeline. The
   live runs in Phase 5 partially close that — real decoder output, including one
   utterance the recognizer garbled — but on three turns, not fifty. **Recording
   new spoken audio remains the only way to get held-out spoken recall, and it is
   still not costed.** State the tiers separately wherever they are quoted; do not
   write "validated on held-out data".
2. Is the divergence guard worth keeping in any form? ITN output is derived from raw
   by construction, so `repairDivergence` passes it trivially and catches none of
   its hallucinations. This plan deletes it; `neverAlone` is the real mechanism.

**Resolved during planning** (kongming counsel, 2026-08-29, all claims re-verified
against source):

- The A1 bar fork — gate on `max(re-baselined LLM, 0.8810)`, disclose both LLM
  columns. The ruler change is asymmetric: it penalizes the LLM for a convention it
  was never given while the ITN emits that convention by construction, so a bar
  that fell with the re-baseline would flatter the ITN and look, to an examiner,
  like a published number quietly replaced by an easier one.
- Q5, the never-tested render path — closed by one manual browser run in Phase 5
  (A13), roughly an hour, not Playwright infrastructure.
- Three deletion touchpoints were missing from the first inventory and are now in
  Phase 4: the `DisplayRepairMetrics` / `recordRepair()` / `'repair'` sink machinery
  in `turn-metrics.recorder.ts` (stranded by Phase 3), the `turn-concurrency.ts:100-110`
  doc comment that explains the ceiling via the 25.1s repair, and the gemma
  assertions in `gemini-translation-provider.spec.ts`.

## Red Team Review

### Session — 2026-08-29

**Findings:** 9 after deduplication (9 accepted, 0 rejected)
**Severity breakdown:** 5 Critical, 4 High
**Reviewers:** Assumption Destroyer (Scope Auditor), Failure Mode Analyst (Flow
Tracer), Security Adversary (Fact Checker). Every finding carried `file:line`
evidence and every one was re-verified independently before acceptance.

| #   | Finding                                                                                                                          | Severity | Disposition | Applied To              |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------- | ----------------------- |
| 1   | ITN inside the turn's `try` — a throw kills the turn's audio, not just the display                                               | Critical | Accept      | Phase 3 (A15)           |
| 2   | Unconditional emit turns the "show original" disclosure on for every line                                                        | Critical | Accept      | Phase 3 (A6)            |
| 3   | `packages/ai-providers` has no test runner — the abort gate would pass having executed nothing                                   | Critical | Accept      | Phase 2                 |
| 4   | Guard tiers used as generator tiers — recall ceiling 30/42 = 0.714, and a date built from ambiguous numerals gets no span at all | Critical | Accept      | Phase 2 (D7)            |
| 5   | D1 silent on thousands grouping — Phase 2's own criterion guaranteed A2 > 0 on 3 rows                                            | Critical | Accept      | D6, Phase 1 + 2         |
| 6   | Same-tick server emit is not a single client render — two frames, two macrotasks                                                 | High     | Accept      | Phase 3, Phase 5 (A13b) |
| 7   | The live partial line always shows the words-form, so Goal 1 was unachievable as written                                         | High     | Accept      | D8, Goal 1, Phase 5     |
| 8   | No direction gate — `en_to_vi` display silently dies and a shipped schema doc becomes false                                      | High     | Accept      | Phase 3 (A14), Phase 4  |
| 9   | Phase 1's "six rows" was not exhaustive; the validator must generate the edit list                                               | High     | Accept      | Phase 1                 |

**Decisions taken to resolve findings (user, 2026-08-29):**

- **D6 — thousands separator is a dot** (`2.500`). Recorded in the brainstorm
  report beside D1-D5. Needs no reference edits: the corpus already writes
  `120.000` / `2.500` / `25.000`.
- **D7 — the ITN defines its own tier mapping over the vocabulary data**, which is
  itself unedited. Guard tiers answer "may this word appear on the repaired side";
  generator tiers answer "does this word belong inside a numeral".
- **D8 — Goal 1 is scoped to the finished-turn line.** The live partial line shows
  the words-form and is out of scope; Phase 5 must record what it showed rather
  than let the thesis claim a property the product does not have.

**What the review says about how this plan was written.** Five of the nine
findings are the same mistake: a claim asserted rather than checked — that the ITN
would be total (code not yet written), that the specs would run (no runner), that
the vocabulary could be reused as-is (different predicate), that six rows were all
of them (hand-enumerated, then a validator specified to agree), and that "the line"
had one meaning (there are two lines). The reviewers found them because they were
required to cite `file:line`; the plan asserted them because it reasoned instead.

## Validation Log

### Session 1 — 2026-08-29

**Questions asked:** 4 (Step 2.5 verification pass skipped — `## Red Team Review`
already carries `file:line` evidence for every claim; no `[UNVERIFIED]` tags found).

The four questions were the forks the plan had explicitly deferred rather than
decided. All four are now closed.

| #       | Decision                                                            | Effect                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D9**  | Build an English ITN too; `direction` selects the module            | Reverses the "English display path" non-goal. Phase 2 grows to a shared span engine + two vocabularies; effort 2d -> 3d, plan 4.5d -> 6d. Keeps `ws-events.ts:142-143`'s bidirectional contract TRUE, so Phase 4's planned doc fix is withdrawn.         |
| **D10** | Carry the display on `server.transcript.final` as an optional field | Replaces the "no schema change" constraint. Structurally removes the one-frame flash red-team Finding 6 identified, instead of accepting it. `server.transcript.display` stays declared, stops being emitted. Schema edit moves from Phase 4 to Phase 3. |
| **D11** | In-sample recall + text-only held-out recall; no new audio          | Confirms the Phase 2 tier structure. Requires the two claim strengths be reported separately, never merged into "validated on held-out data".                                                                                                            |
| **D12** | Delete the divergence guard entirely                                | Confirms the existing plan. ITN output is derived from raw by construction, so the guard passes it trivially and catches none of its hallucinations; `neverAlone` is the real mechanism.                                                                 |

**What D9 costs, recorded because Phase 5 must publish it.** There is no English
display-fidelity reference corpus — `manifest-vi-display.jsonl` is the only one —
and the 50 held-out `sherpa-moonshine-en.jsonl` utterances contain **0 digits**, so
they score hallucination (A16) but not recall. **English therefore has no in-sample
spoken recall figure at all**, and its A1 rests on a round-trip text set alone. This
is now the weakest evidence in the plan, ahead of the Vietnamese in-sample problem.

**What D10 costs.** The plan's "client contract unchanged" constraint is gone. The
change is additive and old tabs ignore an unknown optional field, but this is a
public schema edit and should be described as one rather than as a no-op.

### Whole-Plan Consistency Sweep

- Files reread: `plan.md`, `phase-01` through `phase-05`
- Decision deltas checked: 4 (D9, D10, D11, D12)
- Reconciled stale references: 3 — Phase 4's `ws-events.ts` doc-fix block (withdrawn,
  D9 made the doc true again), Phase 3's two-event emit description (replaced by the
  single-event form), Phase 5's flash check (now a single-commit proof rather than an
  accepted flaw)
- Unresolved contradictions: 0

<!-- slug: vi-display-itn-and-gemma-removal -->
