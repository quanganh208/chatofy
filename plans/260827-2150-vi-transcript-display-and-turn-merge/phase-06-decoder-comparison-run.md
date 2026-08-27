---
phase: 6
title: 'Decoder comparison run'
status: pending
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

- [ ] Three arms measured: greedy control, beam, beam + hotwords
- [ ] WER, CER, RTF, p50/p95, peak RAM recorded for each
- [ ] RTF for every arm confirmed still inside the 0.3 gate
- [ ] Result written up whatever it shows, null included
- [ ] Hotword arm reported explicitly as a best-case ceiling, not an expected gain
- [ ] No shipping default changed in this phase

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
