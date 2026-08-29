---
type: brainstorm
date: 2026-08-28 17:19
slug: vi-display-deterministic-itn
mode: ultra (best-of-5 verifier)
status: decided — see "User decisions" below; §5 and §7 amended accordingly
---

# User decisions (2026-08-28, override the winner's §5 where they differ)

**D1 — Display convention.** `6:00 ngày 10/02/2026`: keep the unit word `ngày`,
zero-pad day and month to two digits, four-digit year, `H:MM` 24-hour clock,
decimal comma. This is now a constant in code, not a prompt request.

Consequences, accepted:

- The 22 references in `benchmarks/stt/data/manifest-vi-display.jsonl` must be
  rewritten to this convention (they currently read `2/9/1945`, `12/10`, `5/1`).
  Phase-04's numbers stop being directly comparable and must be re-baselined; say
  so wherever they are quoted.
- Keeping `ngày` is what makes rule 2 ("change no words") and the divergence
  guard satisfiable at the same time. D1 therefore _dissolves_ the contradiction
  documented above rather than merely picking a side of it.
- Unit words stay as spoken (`0,4 mét`, not `0,4 m`) for the same reason. The
  corpus's own `1,68 m` / `145 mi li mét` inconsistency is resolved toward
  "keep what was said".

**D2 — Keep the LLM repair, narrowed to punctuation and capitalization only.**
The winner recommended deleting it; the user chose to retain it for the two things
deterministic code cannot do. Numerals become ITN's exclusive property and the
model is forbidden from touching them.

> **SUPERSEDED by D4 below.** D2 was reversed once the model question was
> examined. The block is kept because the reasoning in it still describes what a
> narrowed repair would have cost, and D4 is only defensible against it.

## Amendments to §5 forced by D2 (superseded, kept for the record)

**Retained** (the winner would have deleted these): `repair()` and `REPAIR_MODELS`
on the Gemini provider, `transcript-repair-prompt.ts`, `repair-divergence.ts`,
`MAX_CONCURRENT_DISPLAY_REPAIRS`, `REPAIR_TIMEOUT_MS`, the `kind: 'repair'`
prompt-injection arm, and one Gemma request per turn. Repair stays on
`gemma-4-31b-it` — the flash bucket (500/day vs 14,400/day, against a measured
1.84 flash requests/turn) is not to be spent on it.

**Changed:**

1. **ITN runs first; the repair's input is the ITN'd string**, not the raw one.
2. **Prompt rules 5 and 6 are deleted.** Numerals are no longer the model's job,
   so the instruction that ordered it to drop unit words — the sole cause of both
   guard rejections — is removed rather than reworded. Rules 2, 3, 4 remain.
3. **Numeral freeze.** After the repair returns, its numeral multiset is compared
   against the ITN'd text; any difference rejects the repair and keeps the ITN'd
   line. The format the reader sees can therefore never flip.
4. **The guard gets stricter at no cost.** With numerals identical on both sides
   there is no numeral span to exempt, so the ITN-masking exemption stops firing
   and a model that reformats `17:00` back to `17 giờ` is rejected outright. A
   punctuation-only repair has residual 0 by construction, since the guard's
   tokenizer drops punctuation and casing — so no new false rejections.
5. **Failure semantics improve on every path.** A repair that fails, is rejected,
   times out, exceeds the ceiling, or simply arrives late now degrades to a line
   that _already carries correct digits in the right convention_. This removes
   inconsistency sources #2, #3 and #4 entirely. Only **punctuation presence**
   still varies turn to turn — a different axis from the one complained about,
   and the accepted price of keeping F1 0.7222 / cap 0.8636.

**Acceptance criteria changes:** A10 is withdrawn (there is no regression to
publish). Replace with:

| #    | Criterion                                                                                                                                             | Evidence producer                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| A10' | Punctuation F1 >= 0.7222 and proper-noun capitalization >= 0.8636 maintained on the re-baselined corpus                                               | `display_fidelity.py`                          |
| A11  | A repair whose numeral multiset differs from the ITN'd source is rejected and the ITN'd text kept                                                     | vitest spec beside `repair-divergence.spec.ts` |
| A12  | Every clock time in displayed output matches `^\d{1,2}:\d{2}$`; every date `^\d{1,2}/\d{2}/\d{4}$` or `^\d{1,2}/\d{2}$`; `ngày` retained where spoken | grep assertion over corpus output              |

A4 is superseded by A12. A1/A2 (recall >= 0.8810, hallucinations = 0) stand and
are still the make-or-break pair, now measured against re-baselined references.

**D3 — Remove `gemma-4-31b-it` from the system entirely. Gemini only, everywhere.**

What this actually costs is much less than it first appears, because **the live
conversation path already contains no gemma at all**
(`apps/api/src/modules/translate/session/translation-model-policy.ts`):

```
FINAL_MODELS            = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
SPECULATION_MODELS      = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']
LIVE_TRANSLATION_MODELS = ['gemini-3.5-flash-lite']
```

Gemma survives in exactly two places: `DEFAULT_MODELS` (the last resort of
`POST /translate`, the REST _baseline_ path, not the product path) and
`REPAIR_MODELS`. Removing it therefore does not touch live translation.

**A correction that killed the option floated earlier in this session.** An
intermediate suggestion was to move the repair to `gemini-3.1-flash-lite` on the
grounds that it was a near-idle bucket. That was wrong, and the policy file says
so: 3.1 is the **speculation** model, and speculation is the dominant traffic —
"three turns in four now reuse a guess". 3.5 carries live-preview (one request per
partial) plus finals. **Neither flash bucket is idle.** The table in the
superseded D3 draft above should not be relied on.

The binding constraint is also per-minute, not only per-day: the free tier "meters
per minute PER MODEL", measured at 15/min on a single key, and bunching on one
model is what previously "drew seven rate limits over thirty-two turns, and one
request came back after fifteen seconds".

**D4 — Delete the LLM display repair entirely. ITN only. (Reverses D2.)**

With gemma gone and no idle flash bucket to host it, keeping a punctuation repair
would mean adding one request per turn to the same models the conversation runs
on — the exact bunching the policy file was written to prevent. The user chose to
drop the repair instead. This restores the winner's §5 **unchanged**: the contract
is now cand-a's recommendation as written, with no amendments.

Accepted regression, to be published as a number (A10 stands, A10'/A11 withdrawn):
punctuation F1 **0.7222 -> 0**, proper-noun capitalization **0.8636 -> 0**.
Sentence-initial capitalization survives — `zipformer_vi.py::postprocess()` already
does it deterministically.

**D5 — `DEFAULT_MODELS` becomes `['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']`.**
REST loses its last resort deliberately: it is the measurement baseline, and
failing clearly beats answering after 90 seconds.

## Final deletion list (D3 + D4 together)

- `REPAIR_MODELS`, `repair()` on `GeminiTranslationProvider`, and the
  `TranslationProvider.repair` interface member.
- `packages/ai-providers/src/providers/gemini/transcript-repair-prompt.ts`.
- `packages/ai-providers/src/text/repair-divergence.ts` — its only consumer was
  the repair. **`repair-number-vocabulary.ts` is KEPT**: the ITN needs its
  `counting`/`filler`/`neighbour`/`neverAlone` tiers, and `neverAlone` becomes the
  ITN's hard suppression rule. Its file header must be rewritten, since it
  currently describes itself as data the _guard_ reasons over.
- `repairForDisplay`, `repairsInFlight`, `MAX_CONCURRENT_DISPLAY_REPAIRS`,
  `REPAIR_TIMEOUT_MS`, `withDeadline`, `repairDisplay()` on
  `PipelineTranslatorService`, and the `DisplayRepair` interface.
- The `kind: 'repair'` arm of `benchmarks/prompt-injection` — with no model in the
  display path, that injection surface ceases to exist rather than being mitigated.
- `gemma-4-31b-it` from `DEFAULT_MODELS`.
- The `repairDivergence` / `MAX_REPAIR_DIVERGENCE` exports from
  `packages/ai-providers/src/index.ts`. Verified: the only non-spec consumers are
  `pipeline-translator.service.ts:291` and the bench script below, both of which
  go away with the repair.
- `benchmarks/stt/scripts/repair_display_hypotheses.mjs`. This is step 2 of the
  3-step display-fidelity sequence
  (`dump_display_hypotheses.py` -> `repair_display_hypotheses.mjs` ->
  `score_display_repair.py`), so it must be **replaced, not merely deleted**, by an
  `itn_display_hypotheses.mjs` that runs the new pure function over
  `data/display-hypotheses.jsonl`. The replacement needs no API key, no pacing and
  no quota, so it can finally run in CI — which the repair step never could.

`TranslationProvider.repair` is declared optional (`translation-provider.ts:130`),
so dropping it breaks no implementor.

**Re-baselining note.** `data/display-repaired.jsonl` is the record of what the
LLM repair produced and is the evidence behind every number quoted in this report.
Keep the file; do not regenerate or delete it. The new ITN arm writes alongside it.

**Kept:** `server.transcript.display` and the `repairDisplay` opt-in flag. The ITN
reuses the same transport, so there is no schema change and no deploy-window
"Unexpected event shape" for open tabs. Note the flag name becomes a misnomer —
renaming it is a separate, breaking client-contract decision, deliberately not
taken here.

**Still open** (from §7): Q3 held-out validation set — unchanged and still the
weakest evidence in the whole contract; Q5 the render path has never been run
end-to-end in a real browser. Q1, Q2 and Q4 are closed by D1-D5.

---

# Vietnamese display path — replace the late LLM repair with deterministic ITN

Winner of a 5-candidate ultra wave, emitted unchanged. Ranking appendix at the end.

## Summary

User complaint: the display repair lands ~25-30s after the line is on screen
(redundant), and the numeral/date format varies turn to turn (inconsistent).
User's framing question: why can't the text just be right the first time?

Answer, measured: **the recognizer can never be right the first time; the display
can be, with no model at all.**

## Measurements taken during this brainstorm (new, not in prior records)

Latency distribution over all 22 rows of `benchmarks/stt/data/display-repaired.jsonl`
(`ms` field) — previously only median and max were recorded:

```
10.0 11.7 11.7 13.6 13.7 14.5 15.0 15.5 15.5 15.6 18.1
25.1 25.4 27.6 31.1 32.0 33.4 36.7 43.6 71.0 78.2 92.6   (seconds)
```

min **10.003s** · p50 **21.6s** · p90 **71.0s** · max **92.56s** · 0 rows under 10s.

Consequence: **no bounded display window shorter than ~10s can ever fire.** Any
design that keeps the repair on `gemma-4-31b-it` and bounds it to "a few seconds"
discards 22/22 repairs. This retires that whole family of options.

Guard outcome: 20/22 `faithful: true`, 2/22 rejected (9.1%).

## Root cause of the format inconsistency (verified, three independent defects)

1. **Prompt rule 6 contradicts rule 2 and the divergence guard.** Rule 6 orders
   the model to "drop the spoken unit words that the separator replaces"; rule 2
   and `repairDivergence` punish dropping words. Both of the two guard rejections
   are rule 6 being over-applied:
   - `vi-display-13`: `trong ngày năm tháng một` → `trong 5/1` (dropped `ngày`),
     residual 0.25, **rejected** → falls back to raw spelled-out text.
   - `vi-display-12`: a _duration_ (`hai tiếng ba mươi phút`) rendered as a clock
     time `2:30`, **rejected**.
     The rule credited with fixing the convention is also the sole cause of the
     raw-lowercase fallback lines the user is complaining about.

2. **The same edit is accepted in one row and rejected in another.** Dropping
   `ngày` scores residual 0 in `vi-display-06` (`14:30 12/10`, accepted, and the
   accepted output disagrees with its own reference `14:30 ngày 12/10`) but 0.25
   in `vi-display-13` (rejected). The difference is the exemption count (12 vs 4),
   not the edit. This is the user's "lúc này lúc khác" reproduced mechanically.

3. **The reference corpus contradicts itself on units**, so the yardstick embodies
   the same defect: row 16 `1,68 m` / `62,4 kg` abbreviated; row 21 `145 mi li mét`,
   row 19 `12 héc ta`, row 5 `78 phần trăm` spelled out. And row 1's shipped output
   `0,4 mét` is penalized against a reference of `0,4 m` — the model obeyed rule 2
   ("change no words") and the corpus marked it wrong. **Numeral recall cannot reach
   1.0 while both rules hold.**

## Correction to the working assumptions

The shipping display is **not** ALL-CAPS. `services/local-stt/engines/zipformer_vi.py:34`
`postprocess()` lowercases and sentence-cases before the socket sees it, pinned by
`services/local-stt/test_postprocess.py`. The 50/50-uppercase benchmark row is the
harness's raw decoder text. Sentence-initial capitalization was therefore never the
LLM's contribution — and a deterministic, zero-latency display transform already
ships in production, which is the precedent for the recommendation below.

---

# The winning contract (cand-a, unchanged)

## 0. Claim 4 answered directly

**No, the recognizer can never be right the first time. Yes, the display can be —
with no model at all.**

- Shipping recognizer emits no digits and no punctuation, ever: 0/50 on VIVOS
  (`benchmarks/stt/results/r1/sherpa-zipformer-vi.jsonl`). Vocabulary-level, not a
  tuning gap.
- Decoder is not the lever. Phase-06 measured greedy 5.38 WER vs beam 5.38 WER,
  CER 0.04 pt worse. Hotwords bought 0.72 pt from a list derived from the test
  set's own references — nobody sees that live.
- Swapping recognizer does not help. Recomputed from `r1/fw-phowhisper-vi.jsonl`:
  aggregate **RTF 0.3316, over the 0.3 gate** (repo's own record:
  `docs/development-journey.md:122` RTF 0.332); p50 1.328s vs sherpa 0.068s; peak
  RSS 971.5 MB vs 223.3 MB. And still 0/50 digits.

Digits must therefore be produced _after_ recognition. The only real question is
whether that pass is a remote model (today: 10-92s) or a local function (0 ms).

## 1. Outcome

A Vietnamese source line appears **once**, already carrying digits, and never
changes afterwards. Spoken "sáu giờ ngày mười tháng hai năm hai nghìn không trăm
hai mươi sáu" renders as `6:00 ngày 10/2/2026` at the instant the line first
paints — same handler tick as `server.transcript.final`, no network call, no
second event a reader can catch moving. One convention, produced by one
deterministic function, so `17:00` and `17 giờ` cannot both occur: the second form
is unreachable, not merely discouraged. Turns the function cannot resolve keep
their spelled-out words permanently and never mutate later. The "show original"
disclosure stays, because raw remains the measured record.

## 2. Constraints

- `segment.sourceText` stays RAW (`turn-keyed-transcript.ts:320`, `ws-events.ts`);
  WER, MT context history and `display_fidelity.py` all depend on it.
- `normalize_text` must never be applied on the display-fidelity path.
- Must not regress the baseline as the user actually sees it: numeral recall
  0.8810, numeral hallucinations 0. The hallucination count is the binding one.
- Must not touch the audio path.
- Reuse the `counting`/`filler`/`neighbour`/`neverAlone` tiering in
  `packages/ai-providers/src/text/repair-number-vocabulary.ts`. Do not restate a
  flat number list — that file documents the flat version scoring a perfect 0.0000
  while letting `0 phải` through.
- `normalizeTranscript()` only; **never** `foldForMatch()`.
- Client contract unchanged: `repairDisplay` opt-in flag and
  `server.transcript.display` stay as-is. No schema change, so no deploy-window
  "Unexpected event shape" for tabs left open.
- `benchmarks/prompt-injection` `kind: 'repair'` cases stay green for as long as
  the repair path exists.
- Files >200 LOC modularize; kebab-case names.

## 3. Non-goals

- Replacing or retuning the recognizer.
- Promoting hotwords/biasing to the shipping engine.
- Phase 3 (offline capture-vs-model diff) — still pending, not absorbed here.
- The `en_to_vi` English display path.
- Typewriter / erase-and-retype animation (rejected, §6C).
- Translation quality, TTS, turn merge.

## 4. Acceptance criteria

| #   | Criterion                                                                                                                                                                 | Evidence producer                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A1  | Numeral recall >= 0.8810 on displayed text                                                                                                                                | `display_fidelity.py` over `manifest-vi-display.jsonl` |
| A2  | Numeral hallucinations = 0                                                                                                                                                | same scorer                                            |
| A3  | Zero variance: same input -> byte-identical output, 100 runs                                                                                                              | unit test in `packages/ai-providers/src/text/`         |
| A4  | Convention uniformity: 0 occurrences of `\d+\s*giờ`, `\d+\s*phút` in clock context, or `tháng\s+\d+\s+năm\s+\d` in displayed output                                       | grep assertion in the same spec                        |
| A5  | Displayed text differs from `segment.sourceText`; `turns[].sourceText` unchanged                                                                                          | existing `turn-keyed-transcript` assertion pattern     |
| A6  | At most one display value per turn, emitted in the same handler tick as `transcript.final`                                                                                | `translation-session.service` spec                     |
| A7  | Added per-turn latency < 5 ms p95                                                                                                                                         | micro-benchmark in the package's tests                 |
| A8  | `neverAlone` suppression holds: `tôi không đồng ý`, `hai mươi không đủ`, `anh ba năm nay không đi` produce zero digits for those spans                                    | table test reusing `repair-number-vocabulary.ts`       |
| A9  | VIVOS WER unchanged at 5.38%                                                                                                                                              | re-run `benchmarks/stt/run_benchmark.py`, vi set       |
| A10 | If the LLM repair is retired: punctuation F1 and proper-noun capitalization recorded at their new values (expected 0.0000 each, from 0.7222 / 0.8636) in the phase record | `display_fidelity.py`                                  |

A10 is a criterion, not a footnote — it is the regression the user must accept,
published as a number rather than dropped silently.

## 5. Recommended direction

**Deterministic inverse text normalization, in-process, replacing the LLM repair.**

_Where._ New module `packages/ai-providers/src/text/vietnamese-inverse-normalize.ts`
— pure, no I/O, no provider — importing the tier sets from the existing
`repair-number-vocabulary.ts`. Split token tables from the rewriter if it crosses
200 LOC, mirroring the existing `repair-divergence.ts` / `repair-number-vocabulary.ts`
split.

_What it does._ Token-level span recognizer over the raw transcript, in priority
order: date (`ngày|mùng|mồng` D `tháng` M [`năm` Y]) -> clock (N `giờ` [M [`phút`]])
-> decimal (`phẩy` + digit run) -> scaled quantity (mantissa digitized,
`triệu`/`tỷ` kept as words) -> bare cardinal, admitted only when multi-token or
adjacent to a unit/classifier. Two adjacent bare digit-words read as a spoken digit
STRING, not a sum — that one rule is what makes `bốn năm` -> 45, `năm năm` -> 55,
`một chín mười ba` -> 1913 come out right, and those are 4 of 22 utterances in this
corpus. Anything unjustified is left as words. `neverAlone` is a hard suppression.

_Where it runs._ Server-side in `translation-session.service.ts`, on
`translated.sourceText`, in the same handler as the `transcript.final` emit,
immediately followed by `server.transcript.display` on the same socket. No await,
no ceiling, no timeout, no slot. `repairForDisplay`, `repairsInFlight`,
`MAX_CONCURRENT_DISPLAY_REPAIRS` and `REPAIR_TIMEOUT_MS` are deleted with it.

_On failure._ Total function on a string: unrecognized spans stay words, worst
outcome is display == raw. No timeout, no quota, no 429, no rejection state, no
orphaned 120s socket.

_What is deleted._ `REPAIR_MODELS` / `repair()` on the Gemini provider,
`transcript-repair-prompt.ts`, `repair-divergence.ts`, the `kind: 'repair'`
injection arm, one Gemma request per turn against a 14,400/day bucket, and the
uncancellable 120s socket at `pipeline-translator.service.ts:136`.

### Feasibility is measured, not assumed

A ~110-line prototype was written and scored with the same numeral-recall metric
over all 22 corpus rows, from the raw hypotheses:

|                                              | numeral recall     | hallucinated numeral forms | latency  | quota        |
| -------------------------------------------- | ------------------ | -------------------------- | -------- | ------------ |
| raw baseline                                 | 0.0000             | 0                          | —        | —            |
| LLM repair, as generated                     | 0.9524 (40/42)     | 0                          | 10-92.6s | 1 Gemma/turn |
| **LLM repair, as displayed** (guard applied) | **0.8810** (37/42) | 0                          | 10-92.6s | 1 Gemma/turn |
| prototype ITN, iteration 3                   | 0.9286 (39/42)     | 3                          | <1 ms    | 0            |
| prototype ITN, iteration 4                   | 0.9524 (40/42)     | 4                          | <1 ms    | 0            |

Two honest qualifications:

(a) **In-sample.** Iterated four times against the same 22 utterances, exactly as
phase-04 admits its prompt was revised twice against the same corpus. Feasibility
evidence, not a shipping number; A1/A2 must be earned on a held-out extension.

(b) The prototype's hallucination count is **3-4, not 0**, and iteration 4's are a
regression introduced by resolving the digit-string ambiguity with one crude rule
(`hai nghìn năm trăm` -> `2.000 500`) instead of proper backtracking. **A2 (=0) is
the criterion that makes or breaks this design**, and it is where the real work is.

### Second-order effects

Deletes ~700 LOC and a whole failure taxonomy. Removes the
`gemini-translation-provider.ts:131-134` shared-cooldown risk where a repair 429
cooled Gemma for `POST /translate`. Removes a genuinely novel injection surface.
Costs: punctuation F1 0.7222 -> 0 and proper-noun capitalization 0.8636 -> 0.
Sentence-initial capitalization survives — `zipformer_vi.py` already sentence-cases.

## 6. Approaches considered and rejected

**A. Move the repair to the flash bucket and render inline.**
Assumes the 10-92s is a model-capability cost. It is not — it is a quota decision;
flash p50 is 553ms. Fails when the day's ~17th conversation starts: flash carries
**500 requests/day** against Gemma's 14,400, and every live turn already spends
flash (measured 1.84 flash requests/turn, `redteam-260827-2201`). Worst case: flash
exhausts mid-demo and display repair and _translation_ degrade together. Strictly
worse than today, where a repair outage costs punctuation only.

**B. Fold the repair into the final translate call (one request, two fields).**
Assumes every turn makes a final translate call. `translation-model-policy.ts:69`
measures **three turns in four** reusing a speculation. Identical defect to the one
that cancelled Phase 1. Worst case: governs <=25% of turns, so 3 lines in 4 stay
spelled out while 1 in 4 shows digits — claim 3 made _worse_.

**C. Keep the late swap, animate it (erase-and-retype).** The user's own option B.
Assumes the objection is that the swap is _invisible_. Fails at p90 = 71.0s, three
or four turns later. Worst case: a typewriter animation fires on an off-screen line
92s after it was spoken, pulling the eye off the live turn onto stale content.
Motion makes a late correction more intrusive, not less, and addresses none of
claims 1, 3 or 4.

**D. Swap the recognizer to PhoWhisper.** RTF 0.3316 breaks the 0.3 gate, 971.5 MB,
p50 20x worse, still 0/50 digits.

## 7. Unresolved questions

1. **Does the user accept punctuation F1 0.7222 -> 0 and proper-noun capitalization
   0.8636 -> 0?** Their call (`review-audit-self-decision.md`). If not, deterministic
   partial recovery is a terminal period plus a proper-noun gazetteer seeded from
   the corpus `proper_nouns` fields and `benchmarks/stt/data/hotwords-vi.txt` — but
   live gazetteer recall is **not established**.
2. **Bare date without a year — `ngày 5/1` or `5/1`?** The corpus reference keeps
   `ngày`; prompt rule 6 drops it; that disagreement caused one of the two guard
   rejections. One user decision, then it is a constant.
3. **Held-out validation set.** All 22 utterances are one speaker, and both the
   shipped prompt and the prototype are now tuned against them. A1/A2 mean nothing
   without utterances neither has seen. Size and recording effort: not established.
4. **Is the divergence guard still needed?** ITN output is derived from raw by
   construction, so `repairDivergence` passes it trivially and catches none of its
   hallucinations. `neverAlone` is the real safety mechanism.
5. **The render path has still never been run end-to-end in a real browser**
   (phase-04's own stated limitation). Unchanged by this proposal, and the largest
   untested surface either way.

---

# Ranking appendix

Rubric: faithfulness to the request · evidence grounding · sharpness of acceptance
criteria · honesty about unknowns.

1. **cand-a (winner).** Only candidate to build and measure a prototype
   (0.93-0.95 recall, <1 ms) rather than assert feasibility. Independently
   recomputed the latency distribution (matched the controller's own computation
   exactly). Inspected both guard rejections and identified rule 6 as their common
   cause. Best honesty: declared its numbers in-sample, reported its prototype's
   3-4 hallucinations as make-or-break rather than burying them, and named the
   punctuation regression as a published criterion (A10) rather than a footnote.
2. **cand-d.** Corrected the controller's own packet on `postprocess()`
   sentence-casing (verified true, and a real precedent for the recommendation).
   Found the corpus unit self-contradiction. Quoted the documented RTF 0.332
   exactly. Its "apply only while the line is still current" window is a good
   operationalization of the complaint, but with a 10.0s floor the window drops
   nearly every repair in continuous speech — a consequence it does not confront.
3. **cand-c.** Independently found the rule-6-vs-rule-2 contradiction. Sharpest
   invariants (idempotence, totality). "Inline or gone, one measurement decides" is
   decisively framed. Recomputed RTF as 0.346, drifting from the documented figure.
4. **cand-b.** Solid, but recommends moving repair to the flash bucket while
   simultaneously listing that bucket's exhaustion as its own top unresolved risk —
   recommending a direction whose load-bearing assumption it cannot verify. RTF
   0.2641 also drifts.
5. **cand-e.** First to surface the quota correction (flash 500/day vs Gemma
   14,400/day), which proved load-bearing for every other candidate. But its
   recommended bounded window (~3s, gemma retained) is refuted by the latency
   floor: 22/22 repairs would be discarded. It did not compute the distribution.

No candidate was rejected as unusable; all five produced complete seven-section
contracts.

## Unresolved questions for the user

Listed in §7 above. The two that block planning are Q1 (accept the punctuation and
capitalization regression?) and Q2 (the exact date/unit convention).

---

# Addendum 2026-08-29 — unofficial Google Translate endpoint evaluated, rejected

User pointed at `ai-redteam-toolkit/tools/common/gtranslate_api.py` (reverse-engineered
`batchexecute` RPC, no key, Gemini-backed "advanced" mode), claiming it handles proper
nouns and numerals correctly. Tested live today. Premise is half right; the half that is
wrong is the half this contract needed.

## Measured

| test                     | result                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- |
| `vi -> vi`, 3 utterances | **byte-identical to input.** No casing, no punctuation, no digits                |
| `vi -> en` proper nouns  | correct: `Bach Mai Hospital`, `Nguyen Mac Quang Anh`, `Hanoi` from all-lowercase |
| `vi -> en` clock time    | `mười bốn giờ ba mươi` -> `14:30` (digits)                                       |
| `vi -> en` date          | `ngày mười hai tháng mười` -> `October 12` (part digits)                         |
| `vi -> en` quantity      | `hai trăm bốn mươi` -> `two hundred and forty` (**words**)                       |
| `vi -> en` money         | `hai trăm năm mươi nghìn` -> `two hundred and fifty thousand` (**words**)        |
| latency                  | 0.43s (vi->vi), 1.47s median (vi->en)                                            |
| burst 10 req             | 10/10 ok, no 429                                                                 |

## Why it is rejected

1. **`vi -> vi` is a no-op.** The line the user complained about is the Vietnamese SOURCE
   line. This endpoint does nothing to it. The direct application does not exist.
2. **Its numeral convention is inconsistent in exactly the way the user complained about** —
   times digitized, quantities spelled out. Adopting it re-imports "lúc này lúc khác",
   and unlike our own prompt it is not a convention we can change.
3. **Proper nouns arrive on the English line, which we already produce.**
   `gemini-3.5-flash-lite` already capitalizes them. The endpoint adds no signal we lack.
4. **Unofficial, ToS-risked, unversioned.** Its own docstring: "unofficial and subject to
   change", "ToS risk for heavy automated use". Acceptable in a red-team tool; not in the
   product path of a defended thesis.

Speed (0.43-1.47s vs gemma 10-92.6s) is real but no longer the binding constraint — D4
deletes the LLM path in favour of ITN at <1ms.

## The real idea underneath, kept as a candidate (NOT scope now)

D4 accepts proper-noun capitalization 0.8636 -> 0. The signal to recover it is already in
hand every turn: the English translation capitalizes the same proper nouns, and
`foldForMatch()` already strips diacritics for exactly this kind of match. No new request,
no new dependency, no added latency.

Prototype measured today, 3 cases: **1 correct, 1 actively wrong, 1 missed.**

- `nguyễn mạc quang anh` -> `Nguyễn Mạc Quang Anh` (correct)
- `bệnh viện bạch mai` -> `bệnh viện bạch Mai` (**wrong, and worse than leaving it alone** —
  `Bach` was sentence-initial in the English so it was excluded as ordinary capitalization)
- `hà nội` -> unchanged (missed — `Hanoi` is one English token against two Vietnamese ones)

Both defects are structural, not tuning: sentence-initial ambiguity, and agglutinated
transliteration (`Hanoi`, `Saigon`). A half-capitalized `bạch Mai` on screen is the same
class of defect the user opened this brainstorm about. Needs its own accuracy gate before
it is worth building; the starting point is 1/3, not 0.8636.

**Decision: contract unchanged. No adoption.**

---

# D6 — thousands separator (user, 2026-08-29). Extends D1.

**Grouping is a dot: `2.500`, `120.000`, `25.000`.**

D1 defined clock, date, decimal and units but was **silent on thousands
grouping**. The gap was found by the plan's red-team pass and is not cosmetic:
`display_fidelity.py:59` tokenizes `_NUMERAL = r"\d+(?:[.,:/]\d+)*"`, so `2.500`
and `2500` are different multiset members — one recall miss **and** one
hallucination each, by the scorer's own double-count. A2 (= 0) was therefore
unreachable on rows `vi-display-07`, `-11` and `-18` regardless of how good the
ITN was.

Chosen because it needs **no reference edits**: the corpus already writes
`120.000 đồng`, `2.500 tỷ đồng`, `25.000 đồng`. It is also standard Vietnamese
number writing and consistent with D1's decimal comma (`0,4`).

Consequence: the ITN emits `hai nghìn năm trăm` -> `2.500`, never `2500`. The
convention validator must reject a bare `\d{4,}` run.
