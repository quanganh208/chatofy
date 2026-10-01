# Vietnamese punctuation and case benchmark: Dewpoint mmBERT keeps its place

**Date**: 2026-10-01 15:20
**Component**: benchmarks/punct, services/local-stt `/restore`
**Status**: Resolved. Prod model kept.

## Why

The display restorer (Dewpoint mmBERT, embeddings int8) was chosen from two models measured on 36 rows. It still writes "Anh Tuấn. Anh, Xin kính chào" on a recorded conversation. The question was whether another model does better, asked before changing anything. This benchmark answers it with every usable non-generative vi tagger, three rulers and a decision rule fixed before the full run (`plans/261001-1431-vi-punct-case-model-benchmark/plan.md`).

## Setup

- Harness: `benchmarks/punct/`. Each arm runs in its own process, 4 threads, CPU, on the same lowercase unpunctuated input. Peak RSS is sampled over the process tree.
- Rulers:

  | ruler          | rows | reference                           |
  | -------------- | ---- | ----------------------------------- |
  | prod           | 36   | 7 prod sessions, live ASR vs Scribe |
  | aiwho          | 17   | ai = who guard                      |
  | FLEURS vi test | 347  | gold, read Wikipedia                |
  | ViCapPunc test | 500  | gold, forum Q&A                     |

- Decision score: mean of case F1 and punctuation F1 over prod and FLEURS. A replacement needs ≥ +0.02 with no loss on AI. Each delta carries a 95% paired bootstrap interval.
- A row whose words an arm changed is scored as prod serves it, i.e. the ITN-only fallback, because the API refuses such a restore. vibert-capu and xlm-roberta-capu turn number words into digits ("năm năm" → "5 năm") and merge words. That happens in 6–29 rows per ruler.

## Results

| arm                                  | primary   | Δ vs prod [95% CI]      | RSS MB | prod p95 ms | prod case / punct | FLEURS case / punct | ViCapPunc case / punct |
| ------------------------------------ | --------- | ----------------------- | ------ | ----------- | ----------------- | ------------------- | ---------------------- |
| Dewpoint ensemble (mmBERT + XLM-R-L) | 0.815     | +0.006 [−0.005, +0.019] | 3170   | 390         | 0.869 / 0.689     | 0.899 / 0.803       | 0.797 / 0.650          |
| **Dewpoint mmBERT, emb int8 (prod)** | **0.809** | –                       | 1230   | 124         | 0.856 / 0.667     | 0.895 / 0.820       | 0.778 / 0.639          |
| Dewpoint mmBERT fp32                 | 0.808     | −0.001 [−0.004, +0.001] | 2283   | 117         | 0.853 / 0.663     | 0.896 / 0.822       | 0.777 / 0.641          |
| Dewpoint XLM-R-large                 | 0.801     | −0.008 [−0.023, +0.007] | 1884   | 282         | 0.859 / 0.670     | 0.886 / 0.789       | 0.784 / 0.634          |
| vibert-capu fp32                     | 0.750     | −0.059 [−0.118, −0.013] | 609    | 451         | 0.734 / 0.573     | 0.877 / 0.817       | 0.801 / 0.668          |
| xlm-roberta-capu                     | 0.748     | −0.061 [−0.122, −0.014] | 1283   | 464         | 0.734 / 0.559     | 0.882 / 0.818       | 0.788 / 0.649          |
| vibert-capu int8                     | 0.743     | −0.066 [−0.127, −0.022] | 299    | 131         | 0.722 / 0.560     | 0.875 / 0.814       | 0.798 / 0.658          |
| BAD-CODE xlmr (no vi, control)       | 0.711     | −0.098 [−0.125, −0.073] | 2022   | 319         | 0.761 / 0.551     | 0.808 / 0.723       | 0.711 / 0.579          |
| capu-vi (VLSP, fairseq)              | 0.562     | −0.247 [−0.292, −0.218] | 1883   | 647         | 0.692 / 0.406     | 0.724 / 0.426       | 0.610 / 0.463          |
| floor (first capital, final stop)    | 0.369     | −0.440                  | 30     | 0           | 0.209 / 0.210     | 0.470 / 0.589       | 0.360 / 0.277          |

Other columns, on the prod ruler:

| arm              | proper nouns | AI    | mid-sentence capitals per 1k words |
| ---------------- | ------------ | ----- | ---------------------------------- |
| prod model       | 125/139      | 26/26 | 12.0                               |
| ensemble         | 124/139      | 24/26 | 9.8                                |
| vibert-capu fp32 | 89/139       | 21/26 | 3.6                                |
| xlm-roberta-capu | 92/139       | 22/26 | 2.7                                |

Per-mark F1, latency and every other ruler are in `benchmarks/punct/results/summary.json`.

## Decision

Keep Dewpoint mmBERT with the int8 embedding.

- No arm clears +0.02. The ensemble's gain is inside noise, and it needs 3.2 GB and a 390 ms p95. That is over the 300 ms restore budget and does not fit beside STT in the 4 GB container.
- Quantizing the embedding costs nothing measurable (−0.001 against fp32) and saves 1 GB.
- The vi-native vibert/xlm-roberta-capu models are the only ones ahead anywhere. They lead on written forum text (ViCapPunc punctuation 0.668 vs 0.639) and write fewer stray capitals. But they lose clearly on speech: prod case F1 0.73 vs 0.86, and 89 vs 125 proper nouns. They also rewrite number words, which prod has to refuse.

## What this says about "Anh, Xin"

The prod model writes the most mid-sentence capitals on the prod ruler (12 per 1k words, against 3–4 for the capu models). It is the price of casing more proper nouns: the same reflex that gets "Hoàng Long" right puts a capital on "Anh" and "Xin". On the gold FLEURS ruler the gap mostly closes (7.9 vs 6.0–7.0), so part of the prod-ruler gap is Scribe's own casing.

On the one sentence from `dc04d8e1`, the ensemble, XLM-R-large and xlm-roberta-capu all write "Anh xin kính chào". One sentence is not a benchmark, and in aggregate none of them beats prod.

This makes the remaining fix a measurable post-rule, not a model swap: for example, lowercase a capital after a comma unless the word is a known name. Review L5 rejected that rule before because it could break "…, Hà Nội". It can now be scored on these rulers before it ships.

## Caveats

- The prod ruler is small (36 rows), and its reference is Scribe's punctuation, not a human's. FLEURS and ViCapPunc are human gold, but they are clean text without ASR errors.
- ViCapPunc's gold has quirks of its own, for example "Lan thân mến, Trường hợp…" with a capital after a comma, where the source had a line break.
- Latency was measured on the dev box while prod containers were running, so the p95 values are noisy. The ranking does not depend on them.
- capu-vi ran on fairseq 0.12 with CPU patches, and its repository has no license. It is reported for completeness only.

## Follow-up: post-rules for "Anh, Xin"

Two rules were measured on top of the prod model, under ship criteria fixed in the plan before the run:

1. Primary Δ ≥ 0, with the CI lower bound ≥ −0.005.
2. Proper nouns drop by ≤ 1 point on prod and FLEURS.
3. Mid-sentence capitals go down on prod and FLEURS.

| arm                        | primary Δ [95% CI]          | prod mid caps /1k | FLEURS mid caps /1k | FLEURS proper nouns | ships?                                |
| -------------------------- | --------------------------- | ----------------- | ------------------- | ------------------- | ------------------------------------- |
| prod                       | –                           | 12.0              | 7.9                 | 596/714             | –                                     |
| + comma                    | −0.000 [−0.003, +0.003]     | 9.3               | 7.4                 | 580/714             | no: lowers Berlin, Arizona, Paraguay… |
| + title                    | +0.000 [+0.000, +0.001]     | 11.6              | 7.9                 | 596/714             | no: FLEURS unchanged                  |
| + comma-common             | +0.001 [−0.001, +0.004]     | 9.3               | 7.5                 | 593/714             | yes                                   |
| **+ comma-common + title** | **+0.002 [+0.000, +0.004]** | **8.9**           | **7.5**             | **593/714**         | **yes**                               |

The rules:

- `comma-common` lowers a capital right after a comma when the word is one Vietnamese writes in lowercase and the next word is not capitalized.
  - "Lowercase words" are those lowercase in ≥ 80% of ≥ 50 mid-sentence occurrences in ViCapPunc **train**: 2,263 words, data-derived, not hand-kept.
  - It turns "Anh, Xin kính chào" into "Anh, xin kính chào".
- `title` lowers a kinship word capitalized mid-sentence before a name: "chào Anh Tuấn" becomes "chào anh Tuấn".

The proper-noun drop on FLEURS (3) and ViCapPunc (52) is not names.

- The lowered words are "Tuy", "Các", "Em", "Cháu", "Tôi": capitals where the reference starts a new sentence or, on ViCapPunc, follows a line break in the source.
- On prod, nothing that was a name got lowered.

## Follow-up 2: greeting commas

"Vâng, xin chào, anh Tuấn. Anh, xin kính chào" kept two commas after the capitals were fixed. The general rulers hold one case of each, and the prod one was misheard by Scribe, so two targeted rulers were built from ViCapPunc **train** (300 windows each; nothing scored there is fitted to it):

- `title-open`: windows opening with a kinship word.
- `greet`: windows with "chào" before a kinship word.

Comma F1, against the shipped prod (`+ comma-common + title`):

| arm           | prod      | FLEURS | greet     | title-open | primary Δ [95% CI]   |
| ------------- | --------- | ------ | --------- | ---------- | -------------------- |
| shipped       | 0.560     | 0.704  | 0.353     | 0.460      | –                    |
| + greet-comma | **0.564** | 0.704  | **0.363** | **0.464**  | +0.0004 [0, +0.0016] |
| + title-comma | 0.560     | 0.704  | 0.353     | 0.460      | +0.0000 [0, 0]       |

Both pass the criteria fixed in the plan, and both shipped. Case F1 is unchanged everywhere.

`title-comma` changed nothing in the 300 windows that open with a kinship word: the model almost never writes "Anh, xin". Its only measured effect is the recorded greeting. The cost it could have, removing a correct comma after a spoken vocative ("Anh, em xin lỗi"), is not in any ruler.
