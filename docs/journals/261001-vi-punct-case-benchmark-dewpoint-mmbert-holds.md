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
