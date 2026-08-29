---
phase: 2
title: 'Deterministic ITN modules and their evidence battery'
status: complete
priority: P1
effort: '3d'
dependencies: [1]
---

## Result — 2026-08-29 — **the gate passes**

| criterion                                     | result                                                      |
| --------------------------------------------- | ----------------------------------------------------------- |
| **A2** — numeral hallucinations, held-out vi  | **0**                                                       |
| **A16** — numeral hallucinations, held-out en | **0**                                                       |
| A1 — recall, tier 1 in-sample (bar 0.8810)    | **1.0000** (42/42)                                          |
| A1 — recall, tier 3 held-out text             | **vi 1.0000** (51/51), **en 1.0000** (21/21)                |
| A3 — determinism, 100 runs                    | byte-identical                                              |
| A4 — convention uniformity                    | no `\d+\s*giờ`, `\d+\s*phút`, `tháng \d+ năm \d`            |
| A7 — added latency                            | **p95 0.206 ms** (budget 5 ms; the LLM was 10.0-92.6 **s**) |
| A8 — `neverAlone`                             | all three sentences emit zero digits                        |
| A12 — runs with no API key                    | full sequence green with `GEMINI_API_KEY` unset             |

Specs: **88 passing** across `vietnamese-inverse-normalize.spec.ts` and
`english-inverse-normalize.spec.ts`. Verified they actually EXECUTE by breaking
one assertion on purpose and watching the suite go red, then restoring it — the
vacuous-pass risk this phase named as its worst failure.

### Tier 2 hand review — the expected answers were written down first

All 24 held-out utterances carrying number vocabulary were reviewed before
looking at any output. Five categories were predicted; the first run produced
exactly those five and nothing else. Verdicts:

| held-out row                | first run      | verdict                                                |
| --------------------------- | -------------- | ------------------------------------------------------ |
| `MƯỜI MỘT MƯỜI HAI MƯỜI BA` | `43`           | **hallucination** — three numbers merged into a fourth |
| `PHÒNG BA LE HAI`           | `PHÒNG 3 LE 2` | **hallucination** — `Ba Le` is a name                  |
| `CHỊ HAI`                   | `CHỊ 2`        | **hallucination** — a kinship form of address          |
| `KHIẾN HAI CHA CON`         | `2 CHA CON`    | **hallucination** — an idiom, no numeric context       |
| `BA MƯƠI TRƯỜNG`            | `30 TRƯỜNG`    | correct                                                |
| `MỘT CHIẾC LỒNG ĐÈN`        | `1 CHIẾC`      | correct — `chiếc` is a true classifier                 |

After the fixes only the two correct rows remain, and both are checked in to
`data/display-itn-holdout-approved.jsonl` (given a `.gitignore` exception beside
`hotwords-vi.txt`, with the reason recorded there: regenerating a record of a
human judgement would silently re-approve whatever the code now does).

### What each tier actually caught — the argument for building all three

- **Tier 1 (in-sample)** caught the greedy month run reading
  `tháng chín năm một chín bốn năm` as month 951945, and `parseCardinal(['mười'])`
  returning null so every bare `mười giờ` lost its clock.
- **Tier 2 (held-out negative)** caught all four hallucinations above. None was
  reachable from the 22-utterance corpus.
- **Tier 3 (held-out round-trip)** caught **four more** that neither other tier
  could see, which is the clearest evidence it was worth building:
  `850.000 đồng một đêm` -> `đồng 1 đêm` (a unit vouching for the NEXT number),
  `hai nghìn không trăm hai mươi sáu` -> `2000` + stranded words (twice, in a
  year and in a date), and English `nineteen ninety eight` never reaching 1998.

### The rules that changed, each statable without naming a corpus row

1. `mười` takes no multiplier — `hai mười` is not Vietnamese, `hai mươi` is.
2. An unparseable run abstains **whole**; the driver skips it rather than
   retrying from the middle and typesetting a tail its whole could not account
   for.
3. Every single-token numeral needs a neighbour; an **ambiguous** one needs a
   true classifier, not a positional noun (`phòng`, `tầng`, `trang`, `chỗ`,
   `điểm`), because Vietnamese names rooms and people by birth order.
4. Evidence for an ambiguous numeral is read from the **right**, since the
   classifier follows its number — a unit on the left closes the previous
   quantity.
5. A `neverAlone` word may sit interior to a span only when a **scale word**
   follows it: `không trăm` is the empty hundreds place of every year 2001-2099;
   `không đủ` is a negation.
6. A quantity may not **begin** with a `neverAlone` word, which keeps the
   documented accepted cost (`số không không tám` stays words) instead of
   half-typesetting it.

### Deviations from the phase as written

- **Two spec files, not one** — English needs its own under D9.
- **A fourth module**, `inverse-normalize-transcript.ts`, holds the language
  dispatcher. The engine cannot import the language modules that import it: the
  tier tables are built at module load, so the cycle would evaluate one before
  its vocabulary existed.
- **English does not emit `DD/MM`.** `october tenth nineteen thirteen` becomes
  `october 10 1913`, not `october 10/10/1913`, which says the month twice.
  English separators also invert (`0.4`, `2,500`). The Vietnamese convention is
  not a house style to export.
- **`năm năm` -> `55` holds inside a clock only.** As a bare span it abstains,
  because `năm năm` is far commoner as "five years" — digitizing it would be the
  hallucination this phase exists to prevent. Recorded rather than silently
  narrowed.
- The package's `typecheck` runs `noUncheckedIndexedAccess` while its build
  does not, so `tsup` succeeded on code `tsc` rejected. Resolved with `wordAt` /
  `rawAt` accessors rather than scattered non-null assertions.

# Phase 2: Deterministic ITN module and its evidence battery

## Overview

A pure function that turns spoken Vietnamese number words into D1-convention
digits, plus every measurement that decides whether it may ship. Entirely inside
`packages/ai-providers` and `benchmarks/stt/scripts` — **nothing in `apps/` is
touched.**

**This phase is the abort point.** If A2 = 0 turns out to be unreachable, the plan
stops here with `main` completely untouched and nothing deleted. That is the whole
reason no deletion happens before this gate.

## Starting point: there is no prototype

The brainstorm cites a ~110-line prototype scoring recall 0.9524 with 3-4
hallucinations. **That code does not exist** — searched across the repo and the
session scratchpads on 2026-08-29 and confirmed gone; it lived only in a candidate
subagent's context.

Treat 0.9524 as feasibility evidence from an unreproducible run. Do not write a
"port the prototype" step, and do not quote its numbers as continuity with this
implementation.

## A2 = 0 is a design property, not a tuning outcome

The prototype's `hai nghìn năm trăm` -> `2.000 500` was **not** a missing
backtracker. It was a **partial-parse emission**: the parser consumed `hai nghìn`,
failed to attach `năm trăm`, and emitted both fragments.

The rule, stated once:

> **One candidate span yields exactly one numeral, or nothing. Never a fragment.**

Concretely:

1. **Segment spans first, parse values second.** Grow greedily from an anchor —
   an `INSIDE` counting word, or a `DATE_MARKER`; only `INSIDE` words may travel
   within a span; `OUTSIDE` words count purely as adjacency evidence and are never
   consumed. Those three sets are the ITN's own derivation over the vocabulary
   data — **see D7 below, which is why the guard's raw tiers must not be used
   here.** The span builder must make no value decisions.
2. **Parse the whole span under all three grammars** — compound cardinal
   (`nghìn`/`trăm`/`mươi`/`lăm`/`linh`/`lẻ`), digit-string (all tokens single-digit
   words, length >= 2), and **year-pair** (two consecutive 2-digit groups, e.g.
   `một chín` + `mười ba` -> `19|13` -> `1913`). The third exists because the
   digit-string grammar rejects `mười` and would otherwise make this phase's own
   `1913` criterion unsatisfiable. **Accept only a parse that consumes the entire
   span.**
3. **Abstain when ambiguous.** If both grammars complete with different values and
   context (`năm`/`ngày`/`tháng`/a unit word) does not disambiguate — or if neither
   completes — emit **words**.

**The recall budget affords this.** A1's bar floor is 0.8810 = **37 of 42**
numerals, so the ITN may abstain on roughly 5 of 42 and still pass — **but only
once D7 is applied**; under the guard's raw tiers the forced-abstention count alone
is 12, which is why D7 is a correctness fix and not a refinement. (The bar is
`max(re-baselined LLM, 0.8810)` per Phase 1, so it can be higher — check the
Phase 1 figure before spending the budget.) This converts hallucination
risk into recall loss _by construction_.

Do not chase recall 0.9524 with zero hallucinations. **Chase zero hallucinations
and let recall land wherever it lands above the bar.**

## `neverAlone` is checked first and consults nothing

Does a bare `0` appear on the output side of a span that contained `không`? One
line, no context. That subsumes all three measured holes documented in
`repair-number-vocabulary.ts:104` (`tôi không đồng ý`, `hai mươi không đủ`,
`nó không trăm phần trăm đúng`), which is why widening `neighbour` can never
reopen them.

**Do not restate a flat number list.** That file records, with scores, a flat list
reaching a perfect 0.0000 while letting `tôi không đồng ý` -> `Tôi 0 đồng ý`
through — a negation turned into a zero does not alter a sentence, it **reverses**
one, on screen, in the speaker's own words.

Accepted cost, already recorded: `số không không tám` -> `Số 0 0 8` and a literal
`không độ` -> `0 độ` are refused and stay as words.

## The evidence battery — three audio-free tiers

Recording new audio is not required. The ITN's input is recognizer **text**, so
held-out _text_ is legitimate held-out data for the function itself.

| tier                    | source                                                                                    | proves          | limit                                             |
| ----------------------- | ----------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------- |
| 1. in-sample            | the 22-utterance corpus, re-baselined in Phase 1                                          | A1 recall       | one speaker; the LLM prompt was also tuned on it  |
| 2. negative, held-out   | 50 VIVOS refs in `results/r1/sherpa-zipformer-vi.jsonl` + `manifest-vi.jsonl` transcripts | **A2**          | cannot score recall — VIVOS refs contain 0 digits |
| 3. round-trip, held-out | ~50 written Vietnamese sentences with digits, verbalized to spoken form, then scored      | **A1 held-out** | contains no ASR errors — say so                   |

Tier 2 measured 2026-08-29: **22 of 50** VIVOS utterances contain number
vocabulary, **8 of 50** contain `KHÔNG`. Three further traps are visible in those
rows and become named tests: `MỘT MÀU` and `MỘT GIẢI PHÁP` (`một` as "a", not 1),
and **`CHÚ TƯ`** — `tư` is the numeral four, but here it is a person's name.

The eight negation rows, all of which must produce **zero digits**:

```
VIVOSDEV02_R027  CÓ THỂ LÀNH LẶN MÀ KHÔNG ĐỂ LẠI VẾT SẸO
VIVOSDEV04_R152  SẼ KHÔNG KHIẾN BẠN TRÔNG GẦY NHƯ NHỮNG TRANG PHỤC MỘT MÀU
VIVOSDEV05_249   TÔI NGHĨ THỦ TƯỚNG SẼ KHÔNG NÉ TRÁNH BẤT CỨ CÂU HỎI NÀO
VIVOSDEV08_032   SẼ KHÔNG KHIẾN BẠN TRÔNG GẦY NHƯ NHỮNG TRANG PHỤC MỘT MÀU
VIVOSDEV09_159   TỨC LẤY SỤN LÀNH TỪ NƠI KHÔNG PHẢI CHỊU LỰC GHÉP VÀO NƠI HƯ
VIVOSDEV13_211   KHÔNG NẢN NGHĨA TIN RẰNG SẼ CÓ MỘT GIẢI PHÁP NÀO ĐÓ
VIVOSDEV18_126   VÀI LẦN TRIỂN LÃM CHÂN TƯỢNG KHÔNG LỜI NHƯ THẾ HẲN SẼ NHẬN RA
VIVOSDEV19_257   NHƯNG NẾU CHỈ NÓI CÁI GIỎI KHÔNG THÔI THÌ THẬT SỰ CHƯA ĐỦ VỀ CHÚ TƯ
```

Tier 2 rows are ALL-CAPS — that is the raw decoder text as the harness records it;
the shipping path sentence-cases in `zipformer_vi.py::postprocess()`. Case-fold on
input.

Add tier 2b: **~30-50 hand-written adversarial sentences** putting
`không`/`năm`/`ba`/`tư` in non-numeric senses. The traps are already enumerated in
`repair-number-vocabulary.ts`'s own doc comments. An hour's work; becomes a
permanent vitest table.

**Do not split the 22 into dev/test.** Both the shipped prompt and the dead
prototype already burnt all 22. Pretending otherwise is worse than admitting
in-sample.

## D9 — two languages, one derivation

The display path is **bidirectional today** and stays that way. Build the ITN
language-parameterized: one span engine, two vocabularies, selected by
`direction`. `repair-number-vocabulary.ts` already ships both — EN has 61
`counting`, 17 `filler`, 21 `neighbour`, and a 4-entry `neverAlone`
(`a`->1, `second`->2, `march`->3, `may`->5) with the measured failures documented
beside it (`i want a second opinion` -> `I want 1 second opinion.`,
`in may a storm hit` -> `In 5 a storm hit.`, all scored 0.0000).

**D7 applies to English identically.** Its `filler` mixes genuine numeral words
(`one`, `oh`, `half`, `quarter`, `point`) with unit and affix tokens that only ever
appeared on the repaired side (`am`, `pm`, `p`, `m`, `metre`, `meter`, `grams`).
Derive `INSIDE`/`OUTSIDE` for EN the same way.

English span grammars differ from Vietnamese and must not be copied: `o'clock`,
`half past`, month names as date anchors, ordinals (`first`..`twentieth`), and
`point` for decimals. The Vietnamese date/clock priority order does not transfer.

**The honest cost of D9, stated here because Phase 5 must publish it:** there is
**no English display-fidelity reference corpus**. `manifest-vi-display.jsonl` is
the only one, and the 50 held-out `sherpa-moonshine-en.jsonl` utterances contain
**0 digits** — so they score hallucination (A16) but not recall. English recall
rests on a round-trip text set alone, with no in-sample spoken figure at all.

## D7 — guard tiers are not generator tiers

**Red-team finding, accepted, and it invalidated this phase's first algorithm.**

`repair-number-vocabulary.ts` answers a GUARD's question — _may this word appear on
the repaired side without counting as paraphrase?_ An ITN asks a different one —
_does this word belong INSIDE a numeral?_ `filler` conflates two disjoint kinds:

| kind                             | examples                                               | generator meaning                                                     |
| -------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| genuine numeral words            | `không` `một` `ba` `tư` `năm`                          | may travel **inside** a span                                          |
| non-numeral nouns and units      | `số` `đồng` `phần` `độ` `ngày` `tháng` `ki` `lô` `gam` | must stay **outside** — they sit beside a numeral, not in it          |
| repaired-side-only abbreviations | `m` `km` `kg` `h` `c`                                  | **never appear in ITN input at all** — the recognizer spells them out |

Measured consequence of ignoring this: with `filler` allowed to travel inside and
whole-span-or-abstain accepting only a complete parse, spans swallow `số`/`đồng`/
`phần` and then fail to parse. **12 of 42 corpus numerals are lost, recall ceiling
30/42 = 0.714**, against a bar of 0.8810. Two failures are structural, not marginal:

```
cổng số ba            số filler, ba filler, cổng untiered  -> ZERO anchors, loses 3
ngày năm tháng một    ngày/năm/tháng/một ALL filler        -> ZERO anchors, loses 5/1
```

The second is fatal on its own: **a date built from the ambiguous numerals gets no
span at all**, and `ngày 05/01` is exactly what this feature exists to produce. It
only looks like it works on the headline example `ngày mười tháng hai`, where
`mười` and `hai` happen to be `counting`.

**Resolution (D7): the ITN defines its OWN tier mapping over the same data. The
data file is not edited.** Concretely, the ITN reads the vocabulary and derives:

- `INSIDE` — `counting` plus the genuine numeral words currently in `filler`
  (`không`, `một`, `ba`, `tư`, `năm`)
- `OUTSIDE` — `neighbour` plus the non-numeral nouns and units currently in
  `filler` (`số`, `đồng`, `phần`, `trên`, `độ`, `vuông`, `ki`, `lô`, `gam`), which
  provide adjacency evidence and are never consumed
- `DATE_MARKER` — `ngày`, `tháng`, `năm`, `mùng`, `mồng`, which **anchor a date
  span** even when every numeral in it is ambiguous. This is what fixes `ngày năm
tháng một`.
- `neverAlone` — unchanged, and still checked first

The derivation lives in the ITN module and is documented as _"guard tiers are not
generator tiers"_, with the measured 30/42 ceiling as the reason. `neverAlone`
keeps doing the safety work; this changes only what may be consumed.

## Span priority order

Longest-match, highest-priority-first, left to right; a token consumed by a
higher-priority span is unavailable to a lower one.

1. **Date** — `ngày|mùng|mồng` D `tháng` M [`năm` Y] -> `ngày DD/MM[/YYYY]`
2. **Clock** — N `giờ` [M [`phút`]] -> `H:MM` (bare `N giờ` -> `N:00`; **hour not
   zero-padded**, day and month are)
3. **Decimal** — `phẩy` joining two digit runs -> `X,Y`
4. **Scaled quantity** — mantissa digitized, scale words kept as words
5. **Bare cardinal** — only when multi-token, or single-token with an adjacent
   `neighbour`

## Related Code Files

- Create: `packages/ai-providers/src/text/inverse-normalize.ts` — the shared span
  engine, language-parameterized
- Create: `packages/ai-providers/src/text/vietnamese-inverse-normalize.ts`
- Create: `packages/ai-providers/src/text/english-inverse-normalize.ts` (D9)
- Create: `apps/api/src/modules/translate/providers/vietnamese-inverse-normalize.spec.ts`
  — **not** beside the module. `packages/ai-providers` has **no test runner**:
  `package.json` scripts are `build`/`typecheck`/`clean`, its devDependencies carry
  neither vitest nor jest, and the package contains zero spec files. Specs written
  there are never collected, so A3/A4/A7/A8 would report green **having executed
  nothing** — and this phase is the plan's abort gate, so a vacuous pass is the
  worst possible failure. The repo's existing pattern is exactly this: the 328-LOC
  spec for `repair-divergence.ts` lives at
  `apps/api/src/modules/translate/providers/repair-divergence.spec.ts` and imports
  through `@chatofy/ai-providers` under jest. Follow it.
- Create: `benchmarks/stt/scripts/itn_display_hypotheses.mjs` — built **here**,
  because it is how this phase's own gate is measured. **Do not mirror the repair
  script's row shape.** Write `{id, raw, ref_text, proper_nouns, language, itn, ms}`
  to `data/display-itn.jsonl` and score it with the Phase 1 `--no-guard` mode; the
  repaired rows carry a `divergence` field the ITN has no equivalent of, and faking
  one would print a guard statistic that describes nothing.
- Create: `benchmarks/stt/scripts/itn_holdout_check.mjs` (tier 2 runner + differ)
- Create: `benchmarks/stt/data/display-itn-holdout-approved.jsonl` (review snapshot)
- Modify: `packages/ai-providers/src/index.ts` (export the ITN)
- Modify: `packages/ai-providers/src/text/repair-number-vocabulary.ts` — **header
  prose only**, since the guard it describes is about to be gone. Change no data.
- Read only: `packages/ai-providers/src/text/vietnamese.ts` (`normalizeTranscript`)
- **No NON-SPEC file under `apps/` changes.** (The original "`apps/` untouched"
  gate was incompatible with putting the specs where a runner exists. The abort
  guarantee is preserved: a new spec file is deleted on abort and changes no
  behavior.)

If the module crosses 200 LOC, split tables from the rewriter, mirroring the
existing `repair-divergence.ts` / `repair-number-vocabulary.ts` split.

## Implementation Steps

1. Span types and tier lookups over the imported vocabulary.
2. **`neverAlone` suppression first**, with its table test, before any digitizing
   path exists. Safety before capability.
3. Span segmentation (no value decisions), then the two grammars, then the
   whole-span-or-abstain acceptor. Test the abstain case explicitly by name.
4. Spans in priority order, each with its own table test.
5. `normalizeTranscript()` on input. **Never `foldForMatch()`** — lossy by design,
   must never reach a screen.
6. Determinism test (A3), latency micro-benchmark (A7), convention grep (A4).
7. Write `itn_display_hypotheses.mjs`; score tier 1 against the Phase 1 manifest.
8. Write `itn_holdout_check.mjs`; **hand-review all 50 tier-2 rows.** Decide what
   _should_ happen before looking at what the ITN did, then diff.
   **Then check the approved outputs in as a snapshot**
   (`data/display-itn-holdout-approved.jsonl`). This phase openly expects to loop,
   and every iteration would otherwise invalidate a 50-row manual review. With the
   snapshot, `itn_holdout_check.mjs` diffs against it and only **changed** rows need
   re-reviewing. The same artifact becomes the durable CI regression gate for any
   later ITN change — which is the only thing that keeps this gate alive after the
   thesis.
9. Build tiers 2b and 3; score tier 3 with `display_fidelity.py`.

## Success Criteria

- [x] **A2 = 0 on tier 2 (held-out Vietnamese), hand-review notes recorded here**
- [x] **A16 = 0 on the 50 held-out `sherpa-moonshine-en.jsonl` utterances**
- [x] English `neverAlone` holds: `i want a second opinion`, `in may a storm hit`,
      `we march a mile` emit zero digits
- [x] A1 >= `max(re-baselined LLM, 0.8810)` on tier 1, and a tier-3 held-out recall figure recorded
- [x] A3 — byte-identical output over 100 runs
- [x] A4 — no `\d+\s*giờ`, `\d+\s*phút` in clock context, no `tháng\s+\d+\s+năm\s+\d`
- [x] A7 — p95 added latency < 5 ms
- [x] A8 — the three named `neverAlone` sentences emit zero digits
- [x] The 8 `KHÔNG` rows, plus `MỘT MÀU`, `MỘT GIẢI PHÁP`, `CHÚ TƯ`, emit zero digits
- [x] `bốn năm` -> `45`, `năm năm` -> `55`
- [x] `một chín mười ba` -> `1913` via the **year-pair** reading (two 2-digit groups, `19|13`) — the plain digit-string grammar rejects `mười`, so a third reading is required or this criterion is unsatisfiable
- [x] `cổng số ba` -> `cổng số 3` and `ngày năm tháng một` -> `ngày 05/01` — the two D7 regression cases
- [x] `hai nghìn năm trăm` -> `2.500` (D6 dot grouping), and **never** `2.000 500` or `2500`
- [x] An ambiguous span emits words, asserted by a named test
- [x] A12 — the scoring sequence runs with **no `GEMINI_API_KEY` set**
- [x] `display-itn-holdout-approved.jsonl` checked in; re-running the checker on an
      unchanged ITN reports zero rows needing review
- [x] `repair-number-vocabulary.ts` data unchanged; header only
- [x] `git diff --stat apps/` shows ONLY the new spec file
- [x] `pnpm -w test` demonstrably **executes** the new specs — verify by making one assertion fail on purpose and seeing the suite go red

## Risk Assessment

**This gate is expected to fail on its first run.** The only prior attempt had 3-4
hallucinations with the same corpus. Failing here is the gate working.

**Signal it broke in the dangerous direction:** a _plausible_ hallucination — a
digit in a numeric-looking context the reviewer nearly accepts. **Response:** when
a reviewer hesitates, count it as a hallucination. The premise of the feature is
that a reader cannot question a change they cannot see.

**Never trade A2 for A1.** Recall is a number in a table; a hallucination is a
wrong sentence on a user's screen, and in the `không` case a reversed one.

**Over-fitting to 22 utterances.** Every rule must be justifiable from Vietnamese,
not from one failing row. If a rule cannot be stated without naming a corpus id, it
is over-fitting — that is what tiers 2 and 3 exist to expose.

**Reviewer is the implementer** — tier 2's hand review is the only unautomated gate
in the plan. Two mitigations, both in step 8: decide the expected answer before
looking at the output, and snapshot the approved rows so a later iteration cannot
quietly re-approve a row by re-running the script.

**Scope creep into punctuation.** Numerals only. Sentence-initial casing is already
deterministic in `zipformer_vi.py::postprocess()`.

**If A2 = 0 is unreachable:** stop and report. `main` is untouched, nothing is
deleted, and the LLM repair still ships. That is a real outcome, not a failure of
nerve.
