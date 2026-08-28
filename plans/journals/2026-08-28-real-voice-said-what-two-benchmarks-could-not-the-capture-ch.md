---
title: 'Real voice said what two benchmarks could not: the capture chain, not the model'
date: 2026-08-28
summary: 'Three takes of one sentence moved WER 4x on the recording chain alone; built the display metric WER is structurally blind to, and mutation-tested it into shape'
---

# Real voice said what two benchmarks could not: the capture chain, not the model

## What happened

The user sent three recordings of one Vietnamese sentence in their own voice. I
had reported numbers from them before a context compaction; rather than carry
those forward I re-decoded the source files through the sidecar's own
`decode_to_16k_mono` and re-scored. Everything reproduced, which is the only
reason the numbers went into a thesis document.

Same speaker, same sentence, same model, shipping config — only the recording
chain varying:

| take | chain                | WER spoken | WER written |
| ---- | -------------------- | ---------- | ----------- |
| a    | messaging app (Opus) | 14.9%      | 31.7%       |
| b    | messaging app (Opus) | 17.0%      | 39.0%       |
| c    | iPhone Voice Memos   | 4.3%       | 26.8%       |

A 12.7-point swing with the recognizer held constant. Phase 6 had just measured
the best available decoder lever at 0.72 pt, and that under an oracle hotword
list. Two measurements from opposite directions now say the same thing: the
recognizer is not where the remaining Vietnamese quality lives. `take-c` at 4.3%
even beats the 5.38% VIVOS headline on unseen real speech.

The third finding is the one worth the chapter. `take-c` makes 2 word errors
against a spoken reference and 11 against the written form. All 9 extra are one
date — `2 9 1945` against `mùng hai tháng chín năm một chín bốn lăm`.

## The correction that mattered

I wrote "a perfect recognizer scores 26.8% WER against written Vietnamese" and
bolded it in two thesis-bound documents. A reviewer recomputed it: 26.8% is
take-c's own score and includes its two recognition errors. A perfect recognizer
scores **22.0%**. I had conflated "the best take" with "a flawless recognizer" —
the two errors were being billed to the numerals. Verified independently before
changing anything, then fixed in both places with the decomposition shown rather
than a single number.

The qualitative claim survived. 22% is still a failure.

## The instrument, and what mutation testing found

Phase 2's corpus needs the user at a microphone, but its scorer does not. Built
`display_fidelity.py`: numeral recall, punctuation F1 anchored to the preceding
word, proper-noun capitalization, plus a hallucination count — all on the raw
string, never through `normalize_text`.

I found two of my own bugs before review: a noun listed twice re-matched the same
occurrence, and `__add__` summed positionally. Fixed both, mutation-tested both.

Then a review ran 40 mutants and found 13 real survivors in the tests I had just
congratulated myself on. The two that mattered:

- **The F1 formula was unpinned.** An arithmetic mean passed all 17 tests, because
  the only case with both precision and recall nonzero had P == R == 0.5, where
  the two means coincide. The module's headline metric, untested.
- **Mark identity was unpinned.** Keying every mark as a comma passed everything.
  Confusing a comma for a period at the right anchor is exactly what a
  punctuation restorer gets wrong — the mutation most likely to bite in Phase 4.

Four more tests scored a string against _itself_, where recall is 1.0 for any
tokenizer at all. They looked like coverage and were closer to decoration.

Two behaviours changed as a result, not just tests: a run of the same mark now
counts once (`...` is one ellipsis; triple-counting scored a correct terminal
mark at F1 0.5), and `__add__` iterates `dataclasses.fields`.

Two of my own new tests then failed to kill their mutants, which I only learned
by running the mutations rather than assuming. The empty-noun test passed because
the `claimed` set made the empty match consume position 0 and block the real
noun, coincidentally producing identical totals — fixed by listing the empty
entry last. And one surviving mutant turned out to be a genuine no-op: `_fold`'s
NFC pass is redundant, since every caller normalizes first. I relabelled the
comment instead of inventing a test for it. A batch script also mis-reported one
result; re-running it alone showed the mutant was killed.

24 display tests, 46 in the suite, every named mutant dies.

## Decision

Nothing promoted, nothing shipped to the recognizer. The corpus stays blocked on
a browser recording by design — recording it any other way would repeat exactly
the `TAU_SUGGEST` mistake this plan already caught itself making twice.

## Next steps

- Phase 2 corpus: >=20 utterances through the real browser capture chain.
- Phase 3 is still open and this does not close it. Both recordings were external
  chains; Phase 3 asks about the browser's. What this adds is that the question
  is worth answering.
- Open: does a _reformatted_ numeral count as a hallucination or only a recall
  miss? Currently both, which double-counts one defect across two numbers.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
