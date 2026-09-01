---
type: debate-synthesis
mode: debate
date: 2026-09-01
question: 'OQ9 — what fills the ~35% of turns the acoustic layer cannot attribute?'
candidates: [debate-candidate-a.md, debate-candidate-b.md, debate-candidate-c.md]
verdict: 'The acoustic channel is measured dead on the tail (argmax = chance). Only a non-acoustic channel can answer OQ9, and the number that would decide between them does not exist yet.'
---

# Debate synthesis — OQ9

Three planners, one shared evidence packet, no cross-reading. Synthesised by the
orchestrator, not by a planner. Two measurements were run **during** the debate
and both changed the answer; they are reported first because they invalidate
parts of what the planners were given.

---

## 1. What the debate measured

All three planners independently converged on the same next experiment: **score
the nearest-centroid argmax that `online.py` already computes and discards.**
The dead-zone return at `online.py:265` is unconditional — no `above_cap` policy
governs it — so for every tail turn a best-guess index exists and is thrown away.
Nobody had measured whether it was any good.

### Result — the acoustic channel is dead on the tail [measured]

campplus / far-field / N=2 / cold / 1.0s, abstain @ floor 0.65, thresholds
re-calibrated per length, 400 meetings × 3 splits, filled **at each turn's own
arrival time** so D13 holds trivially:

| turns | immediate | resolved | argmax-filled | acc imm | acc res | **acc argmax** | **D8 all-turns** | required |
| ----- | --------- | -------- | ------------- | ------- | ------- | -------------- | ---------------- | -------- |
| 10    | 0.5968    | 0.0937   | 0.3096        | 0.9185  | 0.7336  | **0.5191**     | **0.7775**       | 0.7532   |
| 20    | 0.5811    | 0.0680   | 0.3509        | 0.9379  | 0.7637  | **0.5140**     | **0.7773**       | 0.7211   |
| 40    | 0.5881    | 0.0644   | 0.3475        | 0.9374  | 0.7838  | **0.5261**     | **0.7846**       | 0.7144   |

**The argmax scores chance.** N=2 chance is 0.50; measured 0.514–0.526. The
required fill accuracy to reach the 0.85 bar is 0.714–0.753. It falls **~20
points short**.

Planner A pre-registered the kill threshold: `a_argmax ≤ 0.55` means "the tail is
a different population and the acoustic channel is dead there." **It fired.**

**Three consequences:**

1. The tail is not a quality deficit the current embedder can be coaxed past —
   those turns carry **no usable discriminative signal** in campplus's
   representation at 1.0s. Any mechanism that reads the embedding will coin-flip.
2. **`D8 all-turns ≈ 0.78` is now measured, not bracketed.** The earlier
   0.77–0.86 range collapses to its lower end; the optimistic bracket was never
   real, exactly as it was flagged not to be.
3. Only a channel that **does not read the acoustic embedding** can move this.

### Result — the tail is robust to speaker ordering [measured]

Planner B and C both flagged that every number in the packet was measured on
`order="shuffled"`, while the bench's own docstring says `alternating` is "what
two-person dialogue actually does" and that "reporting both is what makes the
shuffled numbers interpretable". Only one had been reported.

Re-run at `alternating`:

| order                     | 10 turns   | 20 turns   | 40 turns   |
| ------------------------- | ---------- | ---------- | ---------- |
| shuffled — tail           | 0.3096     | 0.3509     | 0.3475     |
| **alternating — tail**    | **0.3587** | **0.3536** | **0.3910** |
| shuffled — acc imm        | 0.9185     | 0.9379     | 0.9374     |
| **alternating — acc imm** | **0.9576** | **0.9631** | **0.9666** |
| shuffled — exact          | 0.9417     | 0.9642     | 0.9742     |
| **alternating — exact**   | **0.9967** | **0.9958** | **0.9992** |

**The tail does not shrink — it grows slightly.** Quality on labelled turns and
speaker counting both improve markedly. So the tail is a property of the acoustic
layer, not of the schedule.

**Caveat both planners raised and this measurement inherits:** `alternating` is
p=1.0, perfect round-robin. The bench offers only p≈0.5 and p=1.0 and **cannot
represent a realistic turn-switch rate at all.** This bounds the answer; it does
not produce it.

---

## 2. Where the three planners agree

Convergence is high, and on the load-bearing points:

- **Fill by a cheapest-first cascade with a bounded per-turn deadline.** All
  three. D8 is discharged by a terminal assign at the deadline; D13 holds because
  the deadline fires in-session.
- **Measure the discarded argmax before building anything.** All three. Now done.
- **The turn-taking / conversational channel is the leading non-acoustic
  candidate**, and this product owns a signal the literature has to learn: the
  app knows exactly when it played TTS.
- **LID is sequenced behind a correlation check, not adopted on the packet's
  §4.3 reasoning.** All three refused to build on it unverified.
- **Name the residue.** All three state that their own mechanism leaves one, and
  size it.
- **Report on the D8 all-turns denominator.** All three, explicitly.

## 3. Where they differ

|                          | A                                                                 | B                                                                                  | C                                                                         |
| ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Primary channel          | continuity prior from TTS boundaries + inter-turn gaps            | **turn-linkage from already-logged timing**; a causal Must-Link from delivery time | fusion decision layer over cost-ranked channels                           |
| New models               | none until LID, gated                                             | **none at all**                                                                    | none until LID, gated                                                     |
| Projected D8 all-turns   | not committed                                                     | 0.80–0.85                                                                          | derives requirement 0.71–0.75, does not claim to meet it                  |
| Distinctive contribution | residue taxonomy (6 classes); LID break-even arithmetic D9 lacked | uses only data the product already logs; zero wire change                          | the arithmetic reducing OQ9 to one number: is real turn-switch rate ≳0.78 |

**B is the most conservative** — it adds no model and no wire change, and it
reproduces the packet's 0.772 at zero link coverage as its own calibration check.
**C is the most rigorous** — its decomposition reproduces the packet's D8 column
to four decimals and converts OQ9 into a single measurable scalar. **A is the
most complete on failure** — six named residue populations including the
prior's characteristic _block_ failure, where wrong chips arrive in runs rather
than scattered.

None of them is wrong. They are three framings of the same cascade.

## 4. Corrections the planners made to the evidence packet

Recorded because the packet was mine and these are its defects:

- **§4.3's "testable on data in hand" is only partly true.** Both bench corpora
  are Vietnamese (`fetch_corpora.py`), so a Vietnamese-only corpus can measure at
  most half the VI/EN confusion matrix. (A, and B independently.)
- **The bench cannot measure a turn-order prior at all** — p≈0.5 or p=1.0, with
  nothing in between, so scoring an alternation prior against the `alternating`
  arm is circular and reports ~1.00. (C, and A.)
- **`SttTranscriptResult.language` is a pass-through of the request parameter,
  not a detection** (`local-speech-stt-provider.ts`). A planner reading the type
  would wrongly conclude LID is already available. (C.)
- **All 21 M1 turns are `voice_off`** — speech output was disabled for the whole
  capture, so no translation ever played and no counterpart was responding. **M1
  is a solo sitting**, and `TURN_S = 1.0s` was selected from it. (A.) Verified
  independently: 21/21 server rows `voice_off`.
- **`cutForced` is 0/21** in the only production telemetry on disk, so the
  currently-shipped same-utterance predicate would never fire. (B.)

---

## 5. The synthesised answer to OQ9

**No acoustic mechanism can fill the tail.** Measured, this session: the argmax is
chance, and the tail survives both speaker orderings and every session length
tested. Fine-tuning (D11) is not strictly excluded — a better representation
might find signal where campplus finds none — but it is no longer a plausible
_primary_ answer, because the deficit is ~20 points and the channel carries zero
information today.

**The answer must be a non-acoustic channel.** Two exist: the turn-taking /
conversational prior, and per-turn LID.

**And the number that would decide between them does not exist, in either
direction:**

- The **turn-taking** channel needs the real turn-switch rate. The bench
  structurally cannot measure it (p≈0.5 or p=1.0). Production cannot either — M1
  is voice-off and solo, so it contains no conversational turn-taking at all.
- The **LID** channel needs the SV/LID error-correlation check. The corpus is
  Vietnamese-only, so it can measure at most half the confusion matrix.

**Both roads lead to Phase 2.** The one-shot real recording is now the only
instrument that can produce either number — and it is the same session already
scheduled for the channel question. Its protocol must additionally record:
per-turn language, turn-switch ground truth, TTS playback boundaries, and
near/far position. Three of those four were already added; **turn-switch ground
truth is new and follows from this debate.**

**Recommended sequence, revised:**

1. **P7-M11** — the instrument audit. Unconditional; everything above is void if
   trial construction is broken.
2. **P2** — the one-shot recording, protocol extended with turn-switch ground
   truth. It now answers three questions at once: the channel, the turn-switch
   rate, and (partially) the language mix.
3. **Then and only then** choose between the turn-taking prior and LID, against
   measured numbers rather than the literature's silence.

**What this does to the bar.** At `D8 all-turns ≈ 0.78` measured, with a 0.85 bar,
the gap is ~7 points and it must come entirely from a non-acoustic channel on
~35% of turns. That is a demanding requirement, and it should be said plainly to
the user before P2's fixture is spent: **it is possible that no available channel
closes it**, in which case the honest outcomes are lowering the bar or not
shipping auto-attribution — both of which remain legitimate results.

---

## 6. Open questions

1. **What is the real turn-switch rate?** Blocks the leading channel. Only P2 can
   answer it. Neither the bench nor existing production data can.
2. **Do LID and SV fail on the same turns?** Blocks the second channel. Needs a
   bilingual corpus or P2's recording; the Vietnamese-only bench cannot answer it.
3. **Is `TURN_S = 1.0s` right for conversational speech?** It came from a solo
   voice-off sitting. Everything downstream is conditional on it.
4. **Is the bench instrument sound?** P7-M11 has not run.
5. **Does the user accept ~0.78 if no channel closes the gap?** A product
   decision, and it should be asked before the one-shot fixture is spent, not
   after.
6. D13's final-turn case: a turn deferred within the deadline of the user
   pressing stop. C names it; it needs a ruling.
