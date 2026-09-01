# stt benchmark harness

Measurement-only harness comparing STT stacks on CPU for the model decision +
thesis comparison chapter. **Not** part of the pnpm/turbo workspace and never
imported by the app — standalone `uv` Python project (same convention as
`services/local-stt`).

Research context, candidate survey, and the recorded decision:
`docs/development-journey.md`

## Stacks under test

| Stack    | vi                        | en                    | Engine         |
| -------- | ------------------------- | --------------------- | -------------- |
| A        | Zipformer-30M-RNNT-6000h  | Moonshine base        | sherpa-onnx    |
| B        | PhoWhisper-small CT2 INT8 | whisper small.en INT8 | faster-whisper |
| Baseline | ElevenLabs Scribe v2      | ElevenLabs Scribe v2  | cloud REST     |

Metrics: WER + CER (one shared normalization), RTF + latency p50/p95, peak RAM
per engine (subprocess-isolated), model load time. Decision threshold: RTF ≤ 0.3.

CER is reported next to WER because Vietnamese carries meaning in its diacritics.
A hypothesis one tone mark away from its reference loses the whole word to WER,
scoring the same as an unrelated word; CER prices that near-miss at one
character. On r1 the two metrics disagree about how far apart the vi engines
are — WER separates them by 43% relative, CER by 19% — so the vi comparison is
read on both. Both are computed from the per-utterance `ref_text`/`hyp_text`
already in `results/`, so adding CER re-reports finished runs rather than
requiring new ones.

## Setup

```bash
cd benchmarks/stt
uv sync
```

## Prepare test data (once)

```bash
uv run python scripts/prepare_datasets.py
```

Downloads VIVOS test split (vi, CC BY-NC-SA 4.0 — measurement use only) and
LibriSpeech test-clean (en, CC BY 4.0), selects 50 utterances/lang (3–10s,
seed 42), converts to 16 kHz mono WAV, writes `data/manifest-{vi,en}.jsonl`.

## Test

```bash
uv run pytest
```

## Download models (once)

```bash
uv run python scripts/download_models.py
```

Caches Zipformer-30M vi (+ generates tokens.txt and bpe.vocab from bpe.model),
Moonshine base en INT8, PhoWhisper-small CT2, whisper small.en CT2 into
`models/`. `bpe.vocab` exists only so sherpa-onnx can encode hotword phrases for
the decode-comparison arm below.

## Run benchmark

```bash
uv run python run_benchmark.py --run-tag r1            # 4 local engines
uv run python run_benchmark.py --run-tag r2            # variance-check rerun
uv run python run_benchmark.py --include-cloud ...     # + ElevenLabs baseline
```

Engines run sequentially, each in its own subprocess (isolated peak-RAM
measurement, no CPU contention).

## vi decode comparison

A separate three-arm run measuring what the decoder alone buys on Vietnamese.
Model files, quantization and thread count are held fixed; only the decoder
varies.

```bash
uv run python scripts/build_hotwords_vi.py                  # writes data/hotwords-vi.txt
uv run python run_benchmark.py --decoder-arms --run-tag r3-decoder-arms
```

| Arm                                 | Decoder                | Biasing            |
| ----------------------------------- | ---------------------- | ------------------ |
| `sherpa-zipformer-vi-greedy`        | `greedy_search`        | none (control)     |
| `sherpa-zipformer-vi-beam`          | `modified_beam_search` | none               |
| `sherpa-zipformer-vi-beam-hotwords` | `modified_beam_search` | 48-phrase hotwords |

The arms carry their own engine ids and their own run tag, so the recorded
`r1`/`r2` stack comparison is neither overwritten nor re-scored. The control arm
repeats the shipping configuration inside the same session, because comparing
against `r1` would confound the decoder with the machine and date it ran on.

**The hotword arm is a ceiling, not an expected gain.** Its list is derived from
the test set's own reference texts (`stt_bench/hotwords.py` documents the rule),
so it measures what biasing could buy if the rare terms were known in advance.
Live conversation does not grant that. Report the number with the label attached.

## Display fidelity — the metric WER cannot be

The WER table above can never credit a fix to the Vietnamese transcript's
readability, and this is structural, not a tuning oversight:

- 0 of 50 VIVOS references carry a digit; 0 carry a punctuation mark. All 50 are
  ALL-CAPS. There is no label for casing, punctuation, or numeral form.
- `stt_bench/text_normalize.py` leaves numbers as written, by design, so every
  recorded number stays comparable. A hypothesis that correctly renders `17:00`
  scores three word errors against a reference reading `MƯỜI BẢY GIỜ` (it
  normalizes to `17 00`, so two substitutions and a deletion).

So repairing the display would make the headline WER **worse** while the product
got better. `stt_bench/display_fidelity.py` is the separate measurement:
numeral recall, punctuation F1 (placement, anchored to the preceding word), and
proper-noun capitalization — scored on the raw string, with `normalize_text`
deliberately not applied.

It also counts **numeral hallucinations** — the motivating case being the failure
an over-eager inverse text normalization produces, `không phải` ("not") rewritten
to `0 phải`. Read the name loosely: it is a multiset difference, so a _reformat_
(`2/9` emitted as `2-9`) raises it too, and a reformat therefore costs both a
recall miss and a hallucination. One defect, two headline numbers — say so when
quoting the pair.

Two conventions worth knowing before writing references: a run of the same mark
counts once (`...` is one ellipsis, not three periods), and punctuation is keyed
by (preceding word, mark), so two placements after the _same_ word can collide.
That needs one word to precede marks at two positions; separating those cases
needs optimal assignment, which is far more machine than the case is worth.

Aggregation is micro (pooled counts). A metric whose reference offered nothing to
score returns `None`, never a vacuous 1.0.

```bash
uv run pytest tests/test_display_fidelity.py -q
```

**The corpus is one speaker's own voice, recorded through the real browser
capture chain** — 22 utterances, 115.2s, 311 reference words, captured with the
same AGC, noise suppression and mic distance the product ships. That was a
deliberate choice over a clean close-mic set, which would measure a channel
nobody uses. The cost is that it is an internal set: the audio is personal data,
is gitignored, and these numbers are **not independently reproducible**. State
that caveat wherever they are quoted.

Recording instrument: a page that replayed the app's own capture path rather than
using `MediaRecorder`, which would add an Opus round-trip `/translate` does not
have. **It lived under the plan tree and went with it**, so re-recording this set
means rebuilding it — the property that mattered is the one named above, not the
page. That is a second reason to treat these numbers as an internal baseline.

```bash
uv run python scripts/run_display_baseline.py
```

Baseline for today's shipping output (greedy Zipformer + the sidecar's
`postprocess`), recorded 2026-08-28:

| Metric                     | Baseline   | Denominator                |
| -------------------------- | ---------- | -------------------------- |
| numeral recall             | **0.0000** | 0 / 42 numerals            |
| numeral hallucinations     | **0**      | —                          |
| punctuation F1             | **0.0000** | ref 39 marks, hypothesis 0 |
| proper-noun capitalization | **0.0000** | 0 / 22 recognized          |
| proper-noun coverage       | 0.8800     | 22 / 25 declared           |

Split by whether the reference carries a numeral, the display cost separates from
recognition error with no hand-written spoken references needed: the 20
numeral-bearing utterances score 54.84% WER against their written references, and
the 2 numeral-free ones score **0.00% — every word correct — while still scoring
zero on all three display metrics.** Perfect recognition, zero display fidelity.
That is why this measurement has to exist separately, and why no decoder or
engine work can move it.

### The deterministic ITN — the arm that ships

The display is typeset in process by a pure function, with no model and no
network. Three steps, and unlike the arm below every one of them runs with no API
key and inside CI:

```bash
uv run python scripts/dump_display_hypotheses.py                 # recognizer output, once
node scripts/itn_display_hypotheses.mjs                          # the shipping display path
uv run python scripts/score_display_repair.py \
    --input data/display-itn.jsonl --field itn --no-guard        # against the zero baseline
```

Two more gates, neither of which the LLM arm could have had, because both need to
run on every change rather than once per quota budget:

```bash
node scripts/itn_holdout_check.mjs                 # held-out negatives, vi
node scripts/itn_holdout_check.mjs --language en   # held-out negatives, en
node scripts/itn_roundtrip_recall.mjs              # held-out recall, both languages
```

`--no-guard` is not a convenience. The ITN has no paraphrase guard — its output
is derived from the raw text by construction and nothing is ever withheld — so
scoring it through the repaired arm's `shown()` would print a "0 withheld"
statistic describing a mechanism that does not exist.

### What the ITN moved — the arm that ships

Scored 2026-08-29 on the same 22 utterances, the same instrument, and the same
D1 references as the LLM column below it, so the two are comparable by
construction.

| Metric                     | Baseline | LLM, old refs           | LLM, D1 refs | **ITN**            |
| -------------------------- | -------- | ----------------------- | ------------ | ------------------ |
| numeral recall             | 0.0000   | 0.8810                  | 0.8571       | **1.0000** (42/42) |
| numeral hallucinations     | 0        | 0                       | 1            | **0**              |
| punctuation F1             | 0.0000   | 0.7222                  | 0.8333       | **0.0000**         |
| proper-noun capitalization | 0.0000   | 0.8636                  | 0.8636       | **0.0000**         |
| added latency per turn     | —        | 25.1s median, 92.6s max | —            | **0.21 ms p95**    |

**Two of those got worse, and they are in the table for that reason.**
Punctuation and proper-noun capitalization go to zero: `Phạm Văn Bạch` is
displayed `phạm văn bạch`. The ITN typesets numerals and touches nothing else, so
the model's punctuation and casing are simply gone. Sentence-initial capitals
survive because `zipformer_vi.py::postprocess()` already produces them. That loss
was the condition the design was accepted under — a correction nobody can read in
time is not a correction, and the median was 25.1 seconds with a **minimum of
10.0s** over 22 turns.

**The three evidence tiers are different strengths of claim and must not be
merged.** Writing "validated on held-out data" would overstate the weakest one:

| tier                                                  | what it proves                        | limit                                                                 |
| ----------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| in-sample — the 22 utterances above                   | recall is achievable                  | one speaker; the ITN was built while reading these                    |
| held-out negatives — 50 VIVOS + 50 LibriSpeech        | **no hallucination** on unseen speech | zero digits in either reference set, so recall is unscoreable         |
| held-out round-trip — 59 vi + 26 en written sentences | recall on unseen text                 | **contains no ASR errors**: it measures the grammar, not the pipeline |

Held-out recall: **vi 1.0000 (59/59), en 1.0000 (23/23), 0 hallucinations.**

Nine of those sentences carry no numeral on purpose. A row whose reference has
no digits scores no recall and can only fail — which is what makes it the
regression guard for a reading that was once wrong: `mười năm` as 15, `open
twenty four seven` as 2047, `no one came` as `no 1 came`, `a hundred and twenty`
as `a hundred and 20`.
Held-out negatives: **0 unreviewed digits in either language.**

**English has no in-sample spoken figure at all.** There is no English
display-fidelity corpus — `manifest-vi-display.jsonl` is the only one — and the
50 held-out `sherpa-moonshine-en.jsonl` utterances contain zero digits, so they
score hallucination but not recall. English recall rests on the round-trip text
set alone. That is the weakest evidence here; say so wherever it is quoted.

VIVOS WER is **unchanged at 5.38%** (CER 2.90%), re-run after the change. It has
to be: the ITN never touches `sourceText`, which stays the only input to WER.

### The display convention the references are written in

Written-reference orthography is part of the ground truth, not a scoring detail —
because `display_fidelity.py` scores numerals as a **multiset difference**, so a
reference in a different convention than the producer does not merely mis-grade
it: a reformat costs a recall miss _and_ a hallucination, one defect counted
twice, and a correct output becomes unscoreable.

So the convention is pinned, and `scripts/check_display_convention.py` enforces
it over all 22 rows:

| element   | rule                                          | example      |
| --------- | --------------------------------------------- | ------------ |
| clock     | `H:MM`, 24-hour, hour **not** zero-padded     | `6:00`       |
| date      | `DD/MM[/YYYY]`, day and month **zero-padded** | `10/02/2026` |
| decimal   | comma                                         | `0,4`        |
| thousands | dot                                           | `2.500`      |
| units     | as **spoken**, never abbreviated              | `0,4 mét`    |

A year (`năm 1913`), a year inside a date, and an identifier (`số 4472`) are
exempt from thousands grouping — none of them is a quantity, and `số 4.472` would
be wrong Vietnamese rather than merely unconventional.

**The unit rule is checked against the recognizer, not against a taste.** "As
spoken" has exactly one source of evidence: what the decoder actually emitted. So
the validator reads `data/display-hypotheses.jsonl` and flags an abbreviation
only when the decoder did not itself produce that token. `125 km` passes because
the decoder really wrote `km`; `0,4 m` fails because it wrote `mét`. Running the
validator BEFORE editing a reference is the point — its output is the edit list,
and a hand-written edit list got two of these rows wrong in both directions.

**Re-baselined 2026-08-29** (5 rows: `-01`, `-02`, `-09`, `-13`, `-16`). Numeral
form and unit words only; no wording, punctuation or proper noun was touched.
`--embedded-references` scores an arm against the frozen `ref_text` inside its own
output file, which is how the pre-re-baseline figures below stay reproducible.

### What the LLM repair moved — a HISTORICAL arm, no longer runnable

Recorded 2026-08-28 against a display repair that no longer exists: one request
per finished turn on a reserve model, off the audio path entirely. Its producer
(`repair_display_hypotheses.mjs`) was deleted along with the feature, so this
arm cannot be regenerated — `data/display-repaired.jsonl` IS the evidence and is
protected for that reason. It is still scoreable, which is the point of keeping
it:

```bash
uv run python scripts/score_display_repair.py --embedded-references  # as published
uv run python scripts/score_display_repair.py                        # under D1 refs
```

| Metric                     | Baseline | Repaired, old refs | Repaired, D1 refs | Gate  |
| -------------------------- | -------- | ------------------ | ----------------- | ----- |
| numeral recall             | 0.0000   | **0.8810**         | **0.8571**        | ≥0.85 |
| punctuation F1             | 0.0000   | **0.7222**         | **0.8333**        | ≥0.70 |
| proper-noun capitalization | 0.0000   | **0.8636**         | **0.8636**        | ≥0.80 |
| numeral hallucinations     | 0        | **0**              | **1**             | —     |

Scored on what a reader SEES, not on what the model returned: the divergence
guard rejected 2 of 22 repairs and those fall back to raw, which is also why
proper-noun capitalization is 0.86 rather than the 1.00 the model itself earned.

**Both reference columns are published together, deliberately.** The re-baseline
is asymmetric: it penalizes the LLM for a convention it was never given — prompt
rule 6 told it the opposite — while a producer that emits D1 by construction pays
nothing. The whole 0.8810 → 0.8571 move is one row, `vi-display-02`, where the
model wrote `2/9/1945` against a reference of `02/09/1945`; that single reformat
is also the entire hallucination count, which is the double-count above appearing
in a real table rather than in a warning. Any later arm is gated at
`max(0.8571, 0.8810)` = **0.8810** — the bar can rise with a ruler change, never
fall, or an examiner sees a published number quietly replaced by an easier one.

Punctuation F1 _rises_ under the new references because the model had already
written `mét` and `ki lô gam` where the old references said `m` and `kg` — the
marks were always anchored to the right words, and the old reference was wrong
about what was spoken. That is independent confirmation of the unit edits, since
the model and the recognizer agreed with each other and not with the reference.

**These numbers are partly in-sample.** The repair prompt was revised twice
against this corpus — once to state the product's numeral convention, once for
sentence splitting — so this is a fitted result on 22 utterances from one
speaker, not a held-out estimate. Quote it as the former.

Two things worth carrying:

- **The convention has to be stated or it is not a convention.** The first run
  scored 0.64 recall with 26 apparent hallucinations, and every one of the 15
  misses and 26 extras was `17 giờ` against a reference of `17:00`, or `ngày mùng
2 tháng 9 năm 1945` against `2/9/1945`. All correct Vietnamese, none of it the
  compact form this product displays. **No number was ever invented.** A reformat
  costs a recall miss AND a hallucination, which is exactly the double-counting
  warned about above, and here it was the entire signal.
- **Latency is an order of magnitude worse than planned.** Median 25.1s, max
  92.6s per repair — the plan assumed ~6.9s from the model's own p50 on a
  one-sentence translation. A repair prompt is much longer and its output is a
  whole utterance. Nothing on the audio path waits for it, so this costs
  scrollback polish rather than a conversation, but "several seconds after the
  turn" was wrong and "tens of seconds" is right.

WER against the written references falls 50.75% → 12.54%, and that direction is
an artefact worth stating rather than a result: these references are WRITTEN, so
ITN moves the hypothesis toward them. Against SPOKEN references the same repair
would move WER the other way, which is the whole reason display fidelity is
measured separately.

Measured motivation, on real speech rather than argued from VIVOS: one recording
scored 4.3% WER against a spoken reference and 26.8% against the written form of
the same sentence — the entire 9-error gap being one date. The working record
that carried the per-sentence detail has been retired; the numbers are kept here
because they are the reason this section exists.

Render the markdown report from all run tags:

```bash
uv run python -c "from pathlib import Path; from stt_bench.report import render_report; print(render_report(Path('results')))"
```

Latest results are summarised in `docs/development-journey.md`; raw metrics stay
in `results/`. Environment:

- `STT_BENCH_THREADS` — CPU threads per engine (default 8, physical cores)
- `ELEVENLABS_API_KEY` — required only for the cloud baseline rows

Windows note: the sherpa-onnx wheel does not bundle `onnxruntime.dll`; the
engines preload the venv's copy before use so the ORT 1.17 build that ships in
`System32` cannot be picked up (that mismatch hard-crashes the process).
