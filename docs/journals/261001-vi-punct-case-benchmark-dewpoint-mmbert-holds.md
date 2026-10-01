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

### Correction: the opening comma was right

`title-comma` was reverted the same day. The greeting is "Vâng, xin chào anh **Tuấn Anh**, xin kính chào quý vị khán giả": a correspondent greeting the anchor Tuấn Anh, not "Anh" the speaker. That reading was assumed rather than checked, and on the one sentence the rule ever changed, it removed the correct comma.

The audio settles it: no pause anywhere between "xin chào" and "khán giả" (Tuấn→Anh 0.16 s, Anh→xin 0.20 s, no energy dip). The only pause is ~0.7 s after "giả". The model's full stop after "Tuấn" therefore sits where the speaker did not stop. A text-only tagger cannot tell "anh Tuấn. Anh xin" from "anh Tuấn Anh, xin", and pauses can, which is the next thing to measure.

## Follow-up 3: pause-aware sentence boundaries

The restorer reads text only. A full stop it writes where the speaker did not pause is now dropped when the sidecar can measure pauses (`engines/word_pauses.py`: the recognizer's word onsets plus frame energy).

**Rulers.** FLEURS vi dev (149 clips) for selection; FLEURS vi test (347) and 42 chunks of 5 recorded sessions (Scribe reference) for the single scored run.

**Pause measure.** The first definition, 25 dB under the speech level, read no pause in half the FLEURS clips. On dev only, it was replaced by "below the midpoint between the clip's floor and its speech level": AUC 0.856 vs 0.723 for separating punctuated gaps from unpunctuated ones.

**Selection on dev.** Every gate variant (120/200/300 ms × drop/comma) was flat to slightly negative: 4 dev rows changed, and the best was `120-drop` at −0.0005.

**Scored once on test, against the shipped sidecar:**

|                     | full-stop F1 FLEURS | full-stop F1 prod | case F1 FLEURS | case F1 prod | primary Δ [95% CI]         |
| ------------------- | ------------------- | ----------------- | -------------- | ------------ | -------------------------- |
| shipped             | 0.927               | 0.671             | 0.872          | 0.820        | –                          |
| + gate 120 ms, drop | **0.940**           | **0.686**         | 0.874          | **0.836**    | +0.0086 [−0.0029, +0.0199] |

All four pre-set criteria hold. The recorded greeting, with the words prod heard and pauses measured from the recording, reads "Vâng, xin chào anh Tuấn Anh, xin kính chào quý vị khán giả."

Caveat: the gain rests on 31 changed test rows, and dev showed none. The gate only removes boundaries. A long pause the model left unpunctuated ("…xảy ra vụ việc này", 310 ms after "ra") is not added.

## Follow-up 4: a full stop at a long pause — measured, not shipped

On the recorded news read (dc04 turn 0), the gate dropped two full stops the model had placed where the speaker did not pause ("tấn công mạng. Trong quá trình…", "đáng chú ý. Dù…"). Those drops were correct. The real boundaries, after "thử nghiệm" (550 ms) and "vụ tấn công mạng" (370 ms), carried no mark at all. A first reading blamed the block seams for the dropped stops, and that reading was wrong: without pauses, the model never puts a mark at either real boundary.

**Seam fix (shipped).** A forced cut lands ~100 ms into a pause, so the last word of a piece always read under the 120 ms gate. On dc04, cut the way the capture gate cuts, the seams read 80 and 100 ms, against 550 and 370 ms in the continuous audio. A full stop at a cut was therefore always dropped. The sidecar now returns `leadPause`, the quiet before the first word measured by energy (the recognizer stamps the first token at ~0 s), and a block adds it to the previous piece's last pause. The pre-roll caps a seam reading at ~400 ms.

**Rule measured:** a full stop after a word with no mark or a comma, followed by ≥ T ms of silence. T was picked on FLEURS dev and scored once on test against the shipped gate.

| T (ms)       | dev primary Δ | test primary Δ [95% CI] | full-stop F1 FLEURS | full-stop F1 prod |
| ------------ | ------------- | ----------------------- | ------------------- | ----------------- |
| shipped gate | –             | –                       | 0.940               | 0.686             |
| 300          | −0.354        | −0.199                  | 0.390               | 0.654             |
| 500          | −0.246        | −0.130                  | 0.506               | 0.699             |
| 1000 (pick)  | −0.090        | −0.042 [−0.048, −0.037] | 0.760               | 0.686             |

It fails every criterion. Read speech pauses inside sentences for 300–900 ms (breath, emphasis), so pause length alone cannot mark a boundary. Only prod at 500 ms nudged up (+0.013 full-stop F1, 42 chunks), and that came with FLEURS collapsing. The code was not kept. Whatever closes the dc04 boundaries has to read both the text and the pause: a model trained with pause features, not a threshold on top of a text-only one.

## Follow-up 5: a model that reads the text and the pause together — measured twice, not shipped

**Design** (chosen by a best-of-5 brainstorm, `plans/reports/brainstorm-261001-2205-pause-aware-boundary-fusion.md`):

- A logistic model at each word gap reads Dewpoint's posteriors (log P(end), log P(comma), log P(none)) and the pause (its own, the next one, and its offset from the text's median).
- It decides every sentence end in place of the 120 ms gate. Without pauses, the output is identical; this was checked on all six text rulers.
- Each fit had a kill gate first, and test was scored once per fit.

| fit on                                                    | gate: P(end) AUC, gaps ≥ 300 ms | gate: CV AUC joint vs pause | test primary Δ [95% CI]  | full-stop F1 FLEURS | full-stop F1 prod | comma F1 prod | prod internal ends P / R |
| --------------------------------------------------------- | ------------------------------- | --------------------------- | ------------------------ | ------------------- | ----------------- | ------------- | ------------------------ |
| shipped gate                                              | –                               | –                           | –                        | 0.940               | 0.686             | 0.528         | 0.83 / 0.62              |
| FLEURS train (310 boundaries)                             | 0.971                           | 0.969 vs 0.894              | −0.0069 [−0.019, +0.005] | 0.944               | 0.667             | 0.507         | 0.73 / 0.60              |
| + 40 podcast episodes, Scribe-labelled (1,090 boundaries) | 0.892                           | 0.956 vs 0.835              | −0.0128 [−0.026, +0.000] | 0.928               | 0.691             | 0.455         | 0.63 / **0.80**          |

**FLEURS fit.** The text separates read-speech boundaries almost perfectly, so the fit leaned on it: 2.77 on log P(end), 0.24 on log pause. At dc04's "thử nghiệm" (640 ms, P(end) 0.35) it scored 0.02. It did not transfer to recorded sessions.

**Conversational fit.** The training data was the Vietcetera podcast part of VietSuperSpeech, 40 episodes × 20 segments, labelled by Scribe v2 and decoded by the live zipformer.

- It found the missing boundaries: internal-end recall on prod went 0.62 → 0.80.
- It paid for them with false ones: precision 0.83 → 0.63, and commas turned into stops (comma F1 0.528 → 0.455). FLEURS full stops fell as well.
- Its pause weight is still small (0.14): in conversation, speakers often end a sentence without pausing and pause without ending one.
- On dc04 it put back the two full stops the gate had rightly removed ("tấn công mạng. Trong…", 50 ms) and still missed the real ones.

**Conclusion.** Neither fit meets the criteria. The plan made the conversational fit the last scored look at the test rulers for this direction.

- Dewpoint's posterior and a pause length do not jointly separate sentence ends in conversation better than the model plus the 120 ms gate.
- Recall can be bought, but only at a precision and comma cost that loses overall.
- What remains is a stronger _text_ signal at those boundaries (a model that reads more context, or a different tagger), or prosody beyond pause length. Both are separate decisions.

The code and both fits are kept on branch `feat/punct-pause-fusion`, so the result can be reproduced. Nothing changed in the sidecar on main.
