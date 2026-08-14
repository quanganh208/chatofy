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
  "source": "tôi đi VinFast",
  "hypothesis": "I go Vinfat",
  "reference": "I drive a VinFast",
  "label": "proper-noun"
}
```

`reference` is required and the tool refuses to run without it on every row,
rather than scoring the subset that has one — for the same reason
`live-translate/score-adequacy.py` refuses: a rate computed over whichever rows
happened to be complete is a number nobody chose.

## What is automatic, and what is not

| Category | Decided by | Points at |
| --- | --- | --- |
| `untranslated-passthrough` | Output folds equal to the **source** | Direction, or Rule 1 |
| `tone-or-diacritic` | Marks differ, everything else folds equal | Session hotwords |
| `number-mismatch` | The digit runs differ | The digit-spelling rule |
| `invention` | Output much longer than the reference | Rule 5 — re-run the fragment cases |
| `truncation` | Output much shorter | Clause splitting, `finishReason` |
| `casing-punctuation` | Differs only in case and punctuation | Nothing; cosmetic |
| `lexical-or-semantic` | None of the above | A human label |

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
over-reach into completion, and the live path translates on a *suspected* end of
speech, so a fragment can be genuinely mid-sentence. An invented ending reaches
the listener as speech with nothing marking it as invented.

A non-zero `invention` count means the prompt-level guard is not holding, and the
next step is `benchmarks/prompt-injection` — `ctl-fragment-not-completed` and
`ctl-fragment-vi-not-completed` measure the same property against the live API.
