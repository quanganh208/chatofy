---
phase: 1
title: 'Re-baseline the corpus to the D1 convention'
status: complete
priority: P1
effort: '0.5d'
dependencies: []
---

## Result — 2026-08-29

**A1's bar is `max(0.8571, 0.8810)` = 0.8810.** The re-baselined figure came out
lower, as predicted, and the bar therefore does not move.

| metric                     | LLM, old refs      | LLM, D1 refs       |
| -------------------------- | ------------------ | ------------------ |
| numeral recall             | **0.8810** (37/42) | **0.8571** (36/42) |
| punctuation F1             | 0.7222             | 0.8333             |
| proper-noun capitalization | 0.8636             | 0.8636             |
| numeral hallucinations     | **0**              | **1**              |

Both columns are reproducible from the same untouched arm file:
`--embedded-references` gives the old column, the default (manifest join) gives
the new one.

**The validator flagged 5 rows, not the 6 or 7 the hand list expected** — and the
two it did not flag are the two this phase said to decide from evidence:

| id    | hand list said          | evidence                        | outcome                   |
| ----- | ----------------------- | ------------------------------- | ------------------------- |
| `-01` | `0,4 m` abbreviated     | decoder said `mét`              | edited → `0,4 mét`        |
| `-02` | unpadded date           | —                               | edited → `02/09/1945`     |
| `-05` | `31,5 độ C` abbreviated | **decoder itself emitted `c`**  | **not edited**            |
| `-09` | `0,6 m` abbreviated     | decoder said `mét`              | edited → `0,6 mét`        |
| `-12` | `125 km` abbreviated    | **decoder itself emitted `km`** | **not edited**            |
| `-13` | unpadded date           | —                               | edited → `ngày 05/01`     |
| `-16` | `1,68 m`, `62,4 kg`     | decoder said `mét`, `ki lô gam` | edited → both spelled out |

`-06`, `-07`, `-11`, `-18`, `-19`, `-21` were confirmed not flagged. The
validator was self-tested against eight deliberately-wrong references first
(zero-padded hour, `H:M`, unpadded date, ungrouped `120000`, dot decimal, plus a
year, an identifier and a fully-conformant row) so a silent pass was ruled out
before it was trusted.

**Two findings this phase's design did not anticipate.**

1. **`score_display_repair.py` read `ref_text` from inside `display-repaired.jsonl`,
   not from the manifest.** Editing the manifest alone would have moved no number
   at all, and the phase would have gone green having re-baselined nothing. The
   scorer now joins references from the manifest by id, so one ruler serves every
   arm and the protected arm file still never has to be rewritten.
2. **`benchmarks/stt/data/` is gitignored** (`data/*`), so the "`git diff` empty"
   protection for `display-repaired.jsonl` could never have fired. Replaced with a
   recorded SHA-256, verified `OK` after all edits.

**Why the punctuation F1 rose rather than fell.** The model had already written
`mét` and `ki lô gam` where the old references said `m` and `kg`. The marks were
always anchored to the right words; the reference was wrong about what was
spoken. The model and the recognizer agreed with each other and not with the
reference — independent confirmation of the unit edits, from a source that had no
access to this decision.

**The whole recall move is one row.** `vi-display-02`: the model wrote
`2/9/1945` against a D1 reference of `02/09/1945`. That single reformat is also
the entire new hallucination count — the multiset double-count appearing in a
real table rather than in a warning.

# Phase 1: Re-baseline the corpus to the D1 convention

## Overview

Rewrite the 6 display-fidelity references that use a different numeral convention
than D1, parameterize the scorer's input path, and re-score the **existing** LLM
repair output against the new references. Produces the only numbers Phase 5 is
allowed to compare against.

## Why this is first — mechanical, not bookkeeping

`benchmarks/stt/stt_bench/display_fidelity.py` defines the hallucination metric as
a **multiset difference**, and says so outright:

> "it is a multiset difference, so a _reformat_ (`2/9` emitted as `2-9`) and a
> _repeat_ also raise it. A reformat therefore costs both a recall miss and a
> hallucination — one defect counted in two places."

So a **correct** ITN output of `02/09/1945` scored against the current reference
`2/9/1945` registers as a hallucination. **A2 (= 0) is not merely mis-calibrated
before this phase — it is unmeasurable.** Every later phase's gate depends on this
one landing first.

Secondarily: phase-04's published 0.8810 / 0.7222 / 0.8636 were measured against
old-convention references, so quoting them beside an ITN number without this
phase compares two different rulers.

Re-baselining is cheap and needs **no new recording**: all 22 `.wav` files are
present under `benchmarks/stt/data/audio/vi-display/`, transcription is
deterministic (greedy decoding, fixed model), and `data/display-hypotheses.jsonl`
and `data/display-repaired.jsonl` are both already on disk.

## The bar fork — decided here, not mid-implementation

Re-scoring the **LLM's existing output** against zero-padded references will score
it materially lower and give it hallucinations, because the LLM was never told the
D1 convention (prompt rule 6 told it the opposite). Two candidate bars for A1:

| bar                             | value       | property                                                |
| ------------------------------- | ----------- | ------------------------------------------------------- |
| (a) published 0.8810, old refs  | fixed floor | **harder**; the number already in the thesis            |
| (b) LLM re-scored under D1 refs | lower       | flatters the ITN, which is the only side that speaks D1 |

**Decision: A1's bar is `max(re-baselined LLM figure, 0.8810)` — it can rise, never
fall — and BOTH LLM numbers are published side by side.** Bar (b) alone would
penalize the LLM for a convention it was never given, making the comparison look
better than it is. The thesis table must show old-ref and new-ref LLM scores
together so no reader can suspect mixed conventions. See this phase's Risk
Assessment for why a falling bar is the specific failure to guard against.

## Requirements

- Functional: the 6 rows below carry D1-convention `ref_text`; the scorer accepts
  an input path; **both** LLM figures (old-ref and new-ref) are recorded.
- Functional: a validation script asserts every reference numeral matches the
  convention regexes, so the manifest and the code constant cannot drift apart.
- Functional: the scorer gains a **no-guard mode** alongside the input-path
  argument — see below.
- Non-functional: `data/display-repaired.jsonl` is **not** regenerated. It is the
  evidence record behind every number in the brainstorm report and costs real
  quota to reproduce.

## Architecture

The display scoring sequence is three steps with file handoffs:

```
dump_display_hypotheses.py   ->  data/display-hypotheses.jsonl   (recognizer output)
repair_display_hypotheses.mjs ->  data/display-repaired.jsonl    (step 2, replaced in Phase 3)
score_display_repair.py       ->  metrics                        (reads REPAIRED, hardcoded)
```

`scripts/score_display_repair.py:28` hardcodes
`REPAIRED = BENCH_ROOT / "data" / "display-repaired.jsonl"`. Phase 2 adds a second
producer writing a different file, so this must become an argument now. Default
stays `display-repaired.jsonl` so no existing invocation changes.

**A second change is needed, and it is not cosmetic.** `shown()` (`:38-54`) reads
`row["divergence"]["residual"]` and compares it to `MAX_REPAIR_DIVERGENCE`; `:68`
derives a list of `rejected` ids from it. That is guard bookkeeping the **ITN does
not have** — its output is derived from raw by construction and nothing is ever
withheld. If the ITN arm synthesized a `divergence` field to fit the existing row
shape, the scorer would print a "0 withheld" statistic that describes a guard that
does not exist, **in a thesis artifact**.

So: add a `--no-guard` mode in which `shown()` returns the row's text and
`withheld=False` without consulting a `divergence` key, and define the ITN row
schema explicitly as `{id, raw, ref_text, proper_nouns, language, itn, ms}` — the
repaired arm's fields minus `repaired`/`divergence`. Do **not** reshape the ITN
output to imitate the repair's rows.

## Related Code Files

- Modify: `benchmarks/stt/data/manifest-vi-display.jsonl` (6 of 22 `ref_text`)
- Modify: `benchmarks/stt/scripts/score_display_repair.py` (parameterize input)
- Read only: `benchmarks/stt/data/display-repaired.jsonl` (**do not regenerate**)
- Create: `benchmarks/stt/scripts/check_display_convention.py` (manifest validator)
- Modify: `benchmarks/stt/README.md` (state the convention the references follow)

## The validator produces the edit list — not this file

**Red-team finding, accepted.** An earlier draft of this phase hand-enumerated six
rows and then specified a validator written to agree with that list. That is
backwards, and it was wrong: a scan found **two more rows** the list missed
(`vi-display-05` `31,5 độ C`, `vi-display-12` `125 km`, both abbreviated units that
D1 forbids). Had the validator been written from the six-row understanding, Phase 1
would have gone green with a ruler still wrong for two rows — and every wrong row
costs a recall miss **and** a hallucination under the multiset rule.

**So: write `check_display_convention.py` FIRST, run it over all 22 rows, and let
its output be the edit list.**

The convention it enforces, complete (D1 + D6):

| element       | rule                                                   | regex the validator applies                   |
| ------------- | ------------------------------------------------------ | --------------------------------------------- |
| clock         | `H:MM` 24-hour, hour **not** zero-padded               | `\b\d{1,2}:\d{2}\b`                           |
| date          | `DD/MM` or `DD/MM/YYYY`, day and month **zero-padded** | `\b\d{2}/\d{2}(/\d{4})?\b`                    |
| `ngày`        | kept where spoken                                      | —                                             |
| decimal       | comma                                                  | `\b\d+,\d+\b`                                 |
| **thousands** | **dot** (D6)                                           | reject a bare `\d{4,}` run                    |
| units         | as spoken, never abbreviated                           | reject `\d\s*(m\|km\|cm\|mm\|kg\|g\|ha\|C)\b` |

**Known-suspect rows to expect the validator to flag** (recorded so a silent
validator bug is detectable, NOT as the edit list):

| id              | fragment               | why                                            |
| --------------- | ---------------------- | ---------------------------------------------- |
| `vi-display-01` | `dâng 0,4 m,`          | abbreviated unit                               |
| `vi-display-02` | `Ngày 2/9/1945,`       | unpadded day and month                         |
| `vi-display-05` | `31,5 độ C,`           | abbreviated unit — **missed by the hand list** |
| `vi-display-09` | `ngập sâu 0,6 m,`      | abbreviated unit                               |
| `vi-display-12` | `khoảng 125 km,`       | abbreviated unit — **missed by the hand list** |
| `vi-display-13` | `trong ngày 5/1.`      | unpadded                                       |
| `vi-display-16` | `1,68 m, ... 62,4 kg.` | abbreviated units                              |

`vi-display-06` (`ngày 12/10`) is already correct — confirm the validator does not
flag it. Rows `-07`, `-11`, `-18` already carry `120.000` / `2.500` / `25.000` and
are correct under D6; confirm the validator does not flag those either. Rows `-19`
(`12 héc ta`) and `-21` (`145 mi li mét`) are already spelled out and correct.

**`vi-display-16` and `-05` must be decided from evidence, not assumption.** The
corpus is internally inconsistent on units in _both_ directions. Read
`data/display-hypotheses.jsonl` for those ids — or listen to the `.wav` — before
choosing between `62,4 ki lô gam` and `62,4 kg`, and between `31,5 độ C` and
`31,5 độ xê`. Do not guess; the reference IS the format spec everything downstream
is measured against.

**Pin the convention exactly, in one place.** D1 zero-pads day and month
(`10/02/2026`) but leaves the hour unpadded (`6:00`). That asymmetry is easy to
get wrong across 22 rows, and a single padding slip fails A1 and A2
_simultaneously_ because of the double-count above.

## Implementation Steps

1. **Write `check_display_convention.py` first** and run it over all 22 rows. Its
   output is the edit list. Compare against the known-suspect table above: if it
   flags fewer rows, the validator is broken, not the corpus.
2. Read `data/display-hypotheses.jsonl` for every flagged id to see what the
   recognizer actually produced, so each new reference matches spoken words.
3. Rewrite the flagged `ref_text` values. Change **only** numeral form and unit
   words — never wording, punctuation, or proper nouns, which are separately
   scored.
4. Add an input-path argument to `score_display_repair.py`, defaulting to
   `data/display-repaired.jsonl`.
5. Re-run `uv run python scripts/score_display_repair.py` over the untouched
   `display-repaired.jsonl`.
6. Record the three new numbers in this file under "Result", beside the old ones.
7. Update `benchmarks/stt/README.md` to state the D1 convention the references now
   follow, so the next person does not re-derive it from the data.

## Success Criteria

- [x] `check_display_convention.py` written and run BEFORE any reference was edited
- [x] Every row it flagged reviewed, each edit justified against the hypothesis text
- [x] `vi-display-16` and `vi-display-05` unit forms decided from evidence, not assumption
- [x] Rows `-06`, `-07`, `-11`, `-18`, `-19`, `-21` confirmed NOT flagged
- [x] `score_display_repair.py` takes an input path; default behavior unchanged
      (`--embedded-references` reproduces the old column byte-for-byte)
- [x] `display-repaired.jsonl` byte-identical to before this phase — verified by
      **SHA-256**, not `git diff`: `data/` is gitignored, so the planned check
      could never have fired
- [x] **Both** LLM figures recorded here: old-ref and new-ref, side by side
- [x] `check_display_convention.py` passes over all 22 rows
- [x] `benchmarks/stt/README.md` states the convention

## Risk Assessment

**The re-baselined recall will probably come out lower than 0.8810, and the bar
does NOT move with it.** The ruler change is asymmetric: it penalizes the LLM for
a convention it was never asked to produce (`02/09`, `mét`), while the ITN emits
the references' convention by construction. Letting the bar fall with the
re-baselined figure would let a mediocre ITN pass while showing the reader fewer
digits than yesterday — and an examiner would see 0.8810 published, then a lower
bar quietly adopted mid-plan.

**A1's bar is `max(re-baselined LLM figure, 0.8810)`.** If the LLM scores higher
under D1 references, the bar rises; it never falls. The 0.9524 feasibility signal
says this is affordable.

**Signal something is wrong:** the re-baselined figure moves by more than ~0.10 in
either direction. **Response:** stop and read the diff before continuing — a large
move means an edit changed more than numeral form, most likely a proper noun or a
punctuation mark, which silently corrupts the other two metrics.

**Do not "fix" a low re-baselined number by editing references toward what the LLM
produced.** That inverts the measurement.
