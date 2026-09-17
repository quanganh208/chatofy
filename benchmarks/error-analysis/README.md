# error-analysis harness

What kind of wrong a translation is, and therefore which lever fixes it.

Measurement-only, **not** part of the pnpm/turbo workspace and never imported by
the app — same convention as `benchmarks/stt`, `benchmarks/tts`,
`benchmarks/realtime`, `benchmarks/mos` and `benchmarks/live-translate`.

The point is not to count errors. "The translation is worse than it should be"
has no next action; "eleven of these fourteen errors are tone-only on proper
nouns" does, and it is a different action from the one "six of them invented a
clause ending" calls for. Every category here exists because it names a
different fix.

## Running it

```bash
# classify.mjs loads the match-fold from the built package
pnpm --filter @chatofy/ai-providers build

node benchmarks/error-analysis/analyze.mjs rows.jsonl > results/r1.md
node --test benchmarks/error-analysis/classify.test.mjs
```

Input is JSONL, one row per translation:

```json
{
  "id": "u012",
  "direction": "vi_to_en",
  "source": "tôi đi VinFast",
  "hypothesis": "I go Vinfat",
  "reference": "I drive a VinFast",
  "label": "proper-noun"
}
```

`reference` is required and both tools refuse to run without it on every row,
rather than scoring the subset that has one — for the same reason
`live-translate/score-adequacy.py` refuses: a rate computed over whichever rows
happened to be complete is a number nobody chose. `translate-rows.mjs` checks it
BEFORE the first request, so an incomplete corpus costs nothing rather than
eighty paid translations.

`direction` is `vi_to_en` or `en_to_vi`. `analyze.mjs` ignores it — it reads only
`source`, `hypothesis`, `reference` and `label` — but `translate-rows.mjs`
**requires** it on every row and refuses the run otherwise. It is explicit rather
than inferred because detecting a language from one short utterance is exactly
the guess this corpus exists to avoid.

## Producing a hypothesis

`analyze.mjs` never translates. It classifies rows that already carry a
`hypothesis`, so something has to write one:

```bash
node benchmarks/error-analysis/translate-rows.mjs rows.jsonl \
  --model gemini-3.5-flash-lite > results/before.jsonl
```

It spends real Gemini quota — one request per row, paced at 4300 ms — and writes
to **stdout only**. The redirect belongs to the caller, as it does for
`analyze.mjs`: a scorer that writes into recorded results is how a `--limit`
smoke run silently corrupts a real one.

### The glossary arm

`--glossary` hands the pairs to the provider as conversation **hints**, exactly
as a selected AI Context does in production, so what is measured is the shipped
context block rather than a mock of it:

```bash
node benchmarks/error-analysis/translate-rows.mjs rows.jsonl \
  --glossary benchmarks/error-analysis/glossary.json \
  --model gemini-3.5-flash-lite > results/after.jsonl

node benchmarks/error-analysis/analyze.mjs results/before.jsonl > results/before.md
node benchmarks/error-analysis/analyze.mjs results/after.jsonl > results/after.md
```

Both arms on ONE model, so the comparison is not confounded by the provider's
model ladder. 40 rows × 2 arms = 80 requests against a 500/day per-model ceiling;
budget it against `benchmarks/prompt-injection`, which spends ~117 per model at
`--repeats 3`.

Each emitted row carries the `model` that answered it, `analyze.mjs` prints it at
the top of the report and refuses a file that mixes two, and `DEFAULT_MODEL` is
the same model the commands above name. All three exist because the first
recording of these arms had none of them, and the result was a number nobody
could attribute: the arms were produced on `gemini-3.5-flash-lite` while the
runner's default and this file's own commands both said `gemini-3.1-flash-lite`.

That was settled by re-running both arms on both models rather than by argument:

| Arm            | 3.5-flash-lite | 3.1-flash-lite | originally recorded |
| -------------- | -------------- | -------------- | ------------------- |
| before (exact) | 4              | 2              | 7                   |
| after (exact)  | 7              | 1              | 14                  |

**The glossary helps the stronger model and does nothing for the weaker one.**
On 3.5 it roughly doubles the rows whose words are right, which is the shape the
original recording has; on 3.1 it does not help at all. That is why the two
models are not interchangeable here, and why this benchmark measures 3.5: it
leads `FINAL_MODELS`, so it answers with the sentence a user actually receives.
`gemini-3.1-flash-lite` leads only `SPECULATION_MODELS`, whose output is
provisional — so on the evidence here the glossary does not improve the live
provisional line, only the answer that replaces it.

The magnitudes differ from the original recording (4→7 against 7→14) and are
reported as measured. Forty rows and one repeat cannot separate that from
run-to-run variance; the direction reproduces, the size does not.

Entries are keyed by LANGUAGE (`{vi, en}`), never by role, and the runner does
**not** re-key them per direction: the prompt builder resolves whichever side is
the source against the direction it is given. One dictionary, both directions.

**One term this material genuinely needs is not in the glossary, and the reason
is a product constraint rather than an oversight.** `hoá đơn giá trị gia tăng`
— an ordinary way to say "VAT invoice", used by two rows of this very corpus in
both directions — is six words, over `MAX_GLOSSARY_TERM_WORDS`, so the prompt
builder always dropped it. It has been removed rather than left in pretending to
be in effect.

Shortening it is not available either. `e09` runs `en_to_vi` and its reference
expects the full phrase in the OUTPUT, so a shortened rendering would push the
model away from the answer the corpus grades against.

Raising the cap is not available either, and that was measured rather than
assumed: with the cap lifted to 8 and the trusted instruction's command clause
already in place, `gemini-3.1-flash-lite` answered "OK" to the attack payload on
one of three repeats. The clause alone does not hold. Both the phrase and the
payload are six words, so no word count separates them.

This is where the feature's cost falls, and it falls unevenly: Vietnamese writes
each syllable as its own word, so the `vi` side of this glossary averages 3.04
words against the `en` side's 2.04, and seven of the 23 entries sit at exactly
the cap with no headroom. See the docblock on `MAX_GLOSSARY_TERM_WORDS`.

### What forty rows are worth

**Forty chosen rows is weak evidence, and saying so is better than reporting it
as if it were not.** The corpus is deliberately biased toward what a glossary can
fix — proper nouns, institutional terms, domain jargon — so a movement here is a
statement about that material and not about translation in general. It is enough
to tell "this made things worse" from "this did not", and it is not enough to put
a number on how much better anything got.

Read the **unlabelled** count before reading the category table. For the reason
the holding-pen section below gives, a movement between `lexical-or-semantic` and
anything else says nothing until those rows are labelled by hand — so that number
is part of the result rather than a footnote to it.

## What is automatic, and what is not

| Category                   | Decided by                                | Points at                          |
| -------------------------- | ----------------------------------------- | ---------------------------------- |
| `untranslated-passthrough` | Output folds equal to the **source**      | Direction, or Rule 1               |
| `tone-or-diacritic`        | Marks differ, everything else folds equal | Session hotwords                   |
| `number-mismatch`          | The digit runs differ                     | The digit-spelling rule            |
| `invention`                | Output much longer than the reference     | Rule 5 — re-run the fragment cases |
| `truncation`               | Output much shorter                       | Clause splitting, `finishReason`   |
| `casing-punctuation`       | Differs only in case and punctuation      | Nothing; cosmetic                  |
| `lexical-or-semantic`      | None of the above                         | A human label                      |

`lexical-or-semantic` is a holding pen, not a finding. Geographic, factual, and
register errors cannot be detected by comparing strings — they need someone who
knows the subject — so they arrive as a hand-written `label` and are tallied
beside the automatic categories rather than guessed at. The report counts how
many rows are sitting there unlabelled, so that gap stays visible instead of
reading as "no semantic errors".

## Two decisions that keep the categories honest

**Cosmetic is checked before tonal, and the order is load-bearing.** Both
differences vanish under the match-fold, which strips case, punctuation and
diacritics together. Asking the tonal question first answers it "yes" for a row
whose marks are identical and whose only difference is a comma — sending someone
to add a hotword for a comma. The cosmetic check therefore runs on a
normalization that keeps the marks.

**Length is only consulted where it carries evidence.** A ratio is unreliable on
a short utterance: "Can you send that over" against "Could you please send that
over to me" is 5 words to 8, tripping a 1.6 ratio while being one added
politeness phrase and a perfectly good translation. `invention` and `truncation`
therefore require a reference of at least 6 words **and** an absolute gap of at
least 3, and below that the row falls through to `lexical-or-semantic` — which
is the honest answer, because on five words length says nothing either way.

## Why `invention` exists

It is the failure mode the prompt's repair/completion split created. Rule 4 now
lets the model silently repair recognition artifacts; Rule 5 forbids continuing
a fragment. A model given permission to repair is exactly a model liable to
over-reach into completion, and the live path translates on a _suspected_ end of
speech, so a fragment can be genuinely mid-sentence. An invented ending reaches
the listener as speech with nothing marking it as invented.

A non-zero `invention` count means the prompt-level guard is not holding, and the
next step is `benchmarks/prompt-injection` — `ctl-fragment-not-completed` and
`ctl-fragment-vi-not-completed` measure the same property against the live API.
