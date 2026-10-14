# Recognizer fusion ruler

Whether the display gets better when a second Vietnamese recognizer hears each turn too, and a model picks between the two transcripts. Examples: "đâm giao" becomes "đâm dao", "vị trí" becomes "bệnh trĩ", "ra cùng" becomes "gia cố", "inche" becomes "incheon".

It runs the shipped pieces end to end, so a number here describes production:

- the fusion prompt on the production host (`RECOGNIZER_FUSION_INSTRUCTION`);
- the guard (`acceptRecognizerFusion`);
- with `--with-homophones`, the homophone repair beside it and the merge the API makes (`mergeCorrections`, the fusion's first);
- the application to the line (`applyTranscriptCorrections`).

```bash
pnpm --filter @chatofy/ai-providers build      # the ruler loads the built package
node benchmarks/recognizer-fusion/score.mjs --repeats 3 [--with-homophones]
```

The script takes `DEEPSEEK_API_KEY` from the environment, falling back to `apps/api/.env`. It never prints the key. In non-thinking mode the host pins `temperature` to 1.0, so use `--repeats`.

## Data

`data/` is gitignored, because the turns are production transcripts.

`data/conversations.json` holds `[{ "id", "turns", "alternates", "reference" }]`. `turns` and `reference` are the homophone ruler's (`../homophone-repair/README.md`). `alternates` are the same turn audio decoded by hynt ZipFormer-150M (`hynt/ZipFormer-150M-CR-CTC-RNNT-6000h`, int8, greedy), the second recognizer the STT sidecar now loads, lowercased.

## Recorded

2026-10-14, 6 Vietnamese conversations (2,220 reference words), with the prompt and guard as shipped:

| Mode                                                  | WER per run                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| Recognizer alone                                      | 5.86%                                                                         |
| Homophone repair alone (shipped before)               | 5.50–5.54%                                                                    |
| Fusion alone                                          | 4.95, 5.00, 5.00, 5.00, 5.00%                                                 |
| **Fusion and homophone repair, as the API runs them** | **4.77, 4.86, 4.91% (guard as first built); 4.77, 4.73, 4.77% (final guard)** |

- No conversation got worse in any run. The fusion called the model on 46 of 95 turns; on the others the second recognizer heard the same words. Latency p50 ~850 ms, p90 ~1.0 s.
- **Accepted in every run, among ~30:** vị trí → bệnh trĩ, ra cùng → gia cố, kẻ sọ → kè, giao → dao, đinh → đỉnh, vươn → vườn, inche → incheon, singtin → thinking, roman brad → ruman radev. Some foreign names only move from one misspelling to another (amode → amod, bulgari → bungary).
- `prompt-injection/fusion.mjs`: 21/21 over 3 runs.

### The guard

A stretch where the model's answer differs from the transcript reaches the line only when:

- **It replaces words.** A stretch that only adds or only drops words is refused, and so is one replacing a word the second recognizer heard as well. On the same set, scored by `benchmarks/stt`'s normaliser, allowing them gained nothing: 4.91–5.00% with adds and drops, 4.82–4.91% without. A drop is also the one failure no reader can see.
- **The other recognizer heard it there.** Its words must be a run of what the second recognizer heard between the words both share on either side. A word heard elsewhere in the turn is refused, because a spoken "change X into Y" puts Y in both transcripts.
- **It changes the sound.** A change of tone-mark placement ("khóa", "khoá") or spacing ("openai", "open ai") is refused. The two recognizers were trained on text written differently, and "open ai" was the one edit that made a conversation worse, in every run.
- **It keeps the hint terms.** The second recognizer decodes without the hotwords the first was biased with, so it is the worse witness for those words.

### What the measurements decided

- **Two recognizers, not three.** Adding ChunkFormer-RNNT-large as a third gave 4.73–5.04% on the earlier scorer, inside the two-recognizer runs' spread. It also needs torch in the sidecar (~1.8 GB against 412 MB) and calls the model on 65 turns instead of 47.
- **Neither recognizer is called the better one in the prompt.** Told "when both make sense, take A", the model kept A's wrong word where B's fitted: 5.14–5.23%. Told nothing, under the same guard: 4.95–5.14%, and 4.91–5.00% once the sound rule above was added. A prompt that called B "better at names and sentence-level sense", which is untrue of this model, scored 4.91–4.95%, the same within noise.
- **Foreign names are fused too.** Refusing stretches with no Vietnamese syllable lost "incheon" and "thinking", 5.00–5.09% against 4.91–5.00%.

Where both recognizers mishear the same word, there is nothing to pick. The remaining errors on this set are mostly that kind, plus fillers ("à") that the reference keeps and neither recognizer outputs.
