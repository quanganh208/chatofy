---
phase: 6
title: 'Decoder comparison run'
status: completed
priority: P3
effort: '0.5d'
dependencies: []
---

# Phase 6: Decoder comparison run

## Overview

Measure what beam search and contextual biasing buy on Vietnamese, and record it
whatever it shows. Optional for the product outcome; cheap and publishable for
the thesis either way.

## Why this phase exists

The shipping recognizer decodes greedily with no biasing:

```python
sherpa_onnx.OfflineRecognizer.from_transducer(..., decoding_method="greedy_search")
```

sherpa-onnx transducers support `modified_beam_search` and
`hotwords_file` / `hotwords_score`. Neither is used. The reported errors
(`ngập`→`ngọt`, the `đi gặp gặp` duplication) are the shape greedy decoding
produces on out-of-domain audio — but that they are _fixable this way_ is
unproven, and Phase 3 may show they are the capture chain rather than the model.

There is headroom to spend: RTF is 0.017 against a 0.3 gate, ~17×. Beam search
at 3–5× the cost is still comfortably inside.

There is also an unused lever on the MT side: `buildContextBlock()` in
`prompt-builder.ts` accepts up to 48 hotwords, and nothing in `apps/web` calls
it. One list could feed both `hotwords_file` and the Gemini `<context>` block.

## Requirements

- Functional: WER/CER/RTF/p95/RAM for greedy (control), `modified_beam_search`,
  and beam + hotwords, on the existing vi benchmark.
- Non-functional: measurement only. No shipping default changes in this phase.

## Architecture

Existing harness, new decode-parameter arms. The runner already records
`decode_params` per run header, so the arms are self-describing in `results/`.

Hotword list for the third arm: the proper nouns and domain terms of the
display-fidelity set from Phase 2 — which is honest only if reported as a
best-case, since live conversation does not let you know the words in advance.
Say so beside the number.

## Related Code Files

- Modify: `benchmarks/stt/stt_bench/engines/sherpa_zipformer_vi.py` (decode-param arms)
- Modify: `benchmarks/stt/run_benchmark.py` (arm selection)
- Create: `benchmarks/stt/data/hotwords-vi.txt`
- Read only: `services/local-stt/engines/zipformer_vi.py` (must stay in step with the harness)
- Update on completion: `docs/development-journey.md` comparison chapter

## Implementation Steps

1. Read Phase 3's verdict first. If the errors are the capture chain, this phase
   still runs but its framing changes: it measures a lever that cannot fix the
   reported defect, and must say so.
2. Add the decode arms, keeping `num_threads: 8` and INT8 fixed so only the
   decoder varies.
3. Run all three arms on the existing 50-utterance VIVOS vi set.
4. Run the beam arm against Phase 2's display set too, if it exists — beam search
   changes word choice, not formatting, so expect no display-metric movement.
   Confirming that is worth one run.
5. Record every number, including a null result.
6. Write the comparison row for the thesis.

## Success Criteria

- [x] Three arms measured: greedy control, beam, beam + hotwords
- [x] WER, CER, RTF, p50/p95, peak RAM recorded for each
- [x] RTF for every arm confirmed still inside the 0.3 gate
- [x] Result written up whatever it shows, null included
- [x] Hotword arm reported explicitly as a best-case ceiling, not an expected gain
- [x] No shipping default changed in this phase

## Outcome (measured 2026-08-28)

Full numbers and the per-utterance diff:
`plans/reports/decoder-260828-1000-vi-decoder-comparison.md`.
Raw results: `benchmarks/stt/results/r3-decoder-arms/`.

| Arm                                 | WER % | CER % | RTF    | p50 s | p95 s | Peak RAM |
| ----------------------------------- | ----- | ----- | ------ | ----- | ----- | -------- |
| `sherpa-zipformer-vi-greedy` (ctrl) | 5.38  | 2.90  | 0.0158 | 0.065 | 0.088 | 211 MB   |
| `sherpa-zipformer-vi-beam`          | 5.38  | 2.94  | 0.0207 | 0.079 | 0.117 | 212 MB   |
| `...-beam-hotwords` (ceiling)       | 4.66  | 2.73  | 0.0211 | 0.084 | 0.117 | 211 MB   |

**Beam search is a null result.** WER unchanged to the digit; CER 0.04 pt worse;
1.31x RTF for it. It changed 3 of 50 utterances — 1 better, 1 worse, 1 trading
one error for another.

**Hotwords bought 0.72 pt WER (13.3% relative), measured against the beam arm so
the decoder is held constant** — 3 utterances changed, 3 improved, 0 regressed,
every gain traceable to a list phrase in that utterance's reference. The list is
derived from the test set's own references, so this is not a gain anyone sees live.

It is also **not a ceiling**, and the arm as run cannot measure one: 81 pairs
qualify and the cap keeps the first 48 in manifest order, so 24 of 50 utterances
carry a phrase, 16 would be biased if the cap were lifted, and 10 never qualified
one. Sixteen utterances sat inside the arm as an unbiased control. Quote 0.72 pt as
"the most this 48-phrase list could buy" — a lower bound on an oracle, not an upper
one. The 48 cap stays right for a _shippable_ list (it mirrors `MAX_HOTWORDS = 48`
in the MT prompt builder); a true ceiling wants all 81 and is a different run.

Every arm passes the RTF gate with ~14x headroom (0.021 worst vs 0.3). Cost was
never why the engine stays greedy, and is not why it should move.

The control reproduces r1's **aggregate** WER and CER (5.38 / 2.90) but not r1
utterance by utterance: 2 of 50 hypotheses differ, in offsetting directions, which
is why the corpus WER lands on the same number twice. Same decode_params, but r1
logged 0.952 s load / 223.3 MB against this run's 0.531 s / 211.4 MB, and r1 and r2
are identical to each other on all 50 — so it is cross-session drift, not
nondeterminism, and 2 changed utterances is the same order as the 3 the beam arm
moved. RTF drifted too (0.0158 vs 0.0169, 6.9%, against the 5.0% r1/r2 spread).
Both facts are why the arms are compared to a same-session control rather than to
r1. r1/r2 and the shipping engine id were not touched.

**Deviations from the phase as written:**

- Step 1 could not be honoured. **Phase 3 has not run** — it needs a live
  reproduction through the browser capture chain. Its verdict is therefore absent
  from the framing, and the report says so. What this run adds to that open
  question: on clean close-mic VIVOS audio the decoder is not the limiting factor,
  which is weak evidence for the capture chain, not proof.
- Step 4 could not run: Phase 2's display set does not exist yet.
- The hotword list therefore could not come from Phase 2's proper nouns. It is
  derived from the VIVOS references instead, by the rule documented in
  `benchmarks/stt/stt_bench/hotwords.py`, and is labelled a ceiling everywhere it
  appears. The realistic version of this arm still wants Phase 2's vocabulary.

**Sample-size caveat carried into every quotation of these numbers:** 50
utterances / 558 reference words. 0.72 pt WER = 4 words. Direction is clean;
magnitude is not precise.

**Arms use their own engine ids and their own run tag**, so the phase's "no
shipping default changed" criterion holds literally:
`services/local-stt/engines/zipformer_vi.py` is untouched and still greedy.

The 48-phrase list is now committed (`benchmarks/stt/.gitignore` gains one
exception for it). `data/` is otherwise gitignored as downloaded corpora, but this
file is a 48-line generated input to a published number, and `decode_params`
records only its filename — the evidence behind 4.66 WER was not recoverable from
the repo without it.

One change fell outside the listed files: `stt_bench/report.py`'s run-variance
rows emitted one cell per tag the engine appeared in, against a header with one
cell per tag — adding a run tag with a different engine set produced a short,
misaligned markdown row. Fixed with the arms, since the arms are what surfaced it.

## Risk Assessment

- **Null result.** Signal: WER moves <0.5 pt. Response: publish it. "We measured
  beam search and biasing; here is what it bought" is a legitimate chapter row,
  and the decision to stay greedy becomes evidence-backed rather than a default.
- **Hotwords flatter the measurement.** Feeding the list the test set's own proper
  nouns measures a ceiling nobody reaches live. Signal: a large gain on the
  hotword arm only. Response: label it a ceiling everywhere it appears.
- **Harness and service drift apart.** `benchmarks/stt/.../base.py` deliberately
  mirrors the service so measured numbers describe shipped behavior. Signal: decode
  params differ between them. Response: if an arm is ever promoted to default, both
  change together in the same commit.
- **Scope creep into shipping the winner.** Signal: an edit to
  `services/local-stt/engines/zipformer_vi.py` in this phase. Response: this phase
  measures; promoting a winner is a separate decision with its own latency and
  thesis consequences.
