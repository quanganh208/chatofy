---
phase: 4
title: 'Intelligibility round-trip'
status: completed
priority: P1
effort: '2h'
dependencies: [3]
---

# Phase 4: Intelligibility round-trip

## Goal

Transcribe every WAV phase 3 produced and score corpus WER and CER against the
reference text — with a human-speech control so the numbers are interpretable,
and a second judge so the verdict can be tested for judge-dependence.

## Read first

- `benchmarks/stt/stt_bench/metrics.py` — `corpus_wer` / `corpus_cer`, and its
  argument for why CER separates a near-miss from a miss in Vietnamese
- `benchmarks/stt/stt_bench/text_normalize.py` — the normalizer, and its note
  that numbers are left as written
- `benchmarks/stt/stt_bench/engines/fw_phowhisper_vi.py` — PhoWhisper-small-ct2,
  faster-whisper INT8, greedy
- `benchmarks/stt/stt_bench/engines/sherpa_zipformer_vi.py` — the app's own STT
- `docs/development-journey.md`, the vi STT results table — **the human-speech
  floors this phase depends on**

## Files to create / modify

- Modify: `benchmarks/tts-vi/pyproject.toml` — add `jiwer>=3.0`,
  `faster-whisper==1.2.1`, `sherpa-onnx==1.13.4`, `huggingface-hub>=1.24.0`,
  `sentencepiece>=0.2.2`
- Create: `benchmarks/tts-vi/tts_vi_bench/metrics.py` (vendored)
- Create: `benchmarks/tts-vi/tts_vi_bench/text_normalize.py` (vendored verbatim)
- Create: `benchmarks/tts-vi/tts_vi_bench/asr_judges.py`
- Create: `benchmarks/tts-vi/score_intelligibility.py`
- Create: `benchmarks/tts-vi/tests/test_metrics.py`
- Modify: `benchmarks/tts-vi/scripts/download_models.py` — add both ASR models

`sherpa-onnx==1.13.4` pairs with `onnxruntime==1.27.0` by versioned symbol — the
sidecar's `pyproject.toml` records that they are one ABI pair, not two
independent deps. Since phase 1 already pins ORT to 1.27.0, adding Zipformer
costs nothing; pinning them together is what keeps it that way.

**Re-sync with `uv sync --frozen`.** This phase adds dependencies _after_ phase
3's numbers were taken. A re-resolve that moved `onnxruntime` underneath already
recorded figures would be silent, so the lock must not move here.

## The two judges, and why only one of them scores

**Score the headline WER/CER with PhoWhisper-small alone. Report Zipformer-vi as
a clearly-labelled second column. Never take a min of the two.**

The vendor transcribes with two ASRs and takes the per-utterance minimum. Do not
copy that here, for three reasons:

`min` is not a neutral operator on a _comparison_. It lowers both arms' absolute
WER, which is what a vendor wants for a headline — but it shifts the _delta
between the two TTS systems_ in a direction that cannot be stated in advance. It
rewards a system whose errors are idiosyncratic to one judge and punishes one
whose errors are acoustic and therefore shared. An operator with an unpredictable
sign on the quantity that _is_ the deliverable is the wrong operator.

Our two judges are far less symmetric than the vendor's. They used
whisper-large-v3 and PhoWhisper-large: two large encoder-decoders of comparable
strength, where min ≈ best-of-two-equals. Ours would be PhoWhisper-small (AED,
INT8) and Zipformer-30M (RNNT, INT8). A min across those mostly reproduces
whichever is stronger on that acoustic condition, plus noise. It borrows the
vendor's protocol's name without its properties.

And min destroys the control below — there is no recorded human-speech floor for
a min-of-two column.

**Zipformer still belongs in the run.** It is the app's real STT, so "does the
app's own recognizer understand this voice?" is a product question this benchmark
should not skip. Its brittleness on synthetic audio is exactly why it must not be
merged into the score — and exactly why seeing it is worth the few minutes it
costs at RTF 0.017.

## The control that makes the numbers mean something

`docs/development-journey.md` already records both judges' WER on **human** speech
over these exact 50 VIVOS utterances: PhoWhisper-vi **7.71%**, Zipformer-vi
**5.38%**. Quote both as control rows in every table. Without them a reader
cannot tell a bad voice from a judge's own error floor.

## Tasks & Steps

1. **Vendor the normalizer verbatim**, keeping its docstring. Changing it would
   break comparability with the STT harness's numbers, which is what makes these
   figures legible beside the existing ones. Note in the file that it is a
   verbatim copy and that divergence from `benchmarks/stt` silently costs that
   comparability — the "stay independent" convention does not cover this coupling.

2. **Vendor `corpus_wer` and `corpus_cer`.**

3. **Write `asr_judges.py`** with both engines, each matching its
   `benchmarks/stt` configuration exactly: PhoWhisper via faster-whisper
   (`device="cpu"`, `compute_type="int8"`, `language="vi"`, `beam_size=1`) and
   Zipformer greedy and unbiased — **no hotwords**. Any difference from the STT
   harness's config would make the control floors inapplicable.

4. **Add both ASR models to `download_models.py`.** Note that phase 4's earlier
   draft claimed PhoWhisper would be pinned "to the revision the STT harness
   records" — the STT harness records no revision and `revision=` appears nowhere
   in the repo. Either pin a sha here and say it is newly chosen, or state
   plainly that the model is unpinned; do not claim a pin that does not exist.

5. **Write `score_intelligibility.py`.** Walk
   `results/<tag>/wav/<engine>/<voice>/<sentence_set>/`, transcribe with both
   judges, join to the sentence set **on `sentence_id`**, and emit per-arm corpus
   WER and CER plus a per-sentence JSONL carrying reference, both hypotheses, and
   both scores. The per-sentence rows are what make a bad number diagnosable.

6. **Gate on completeness.** Join WAVs to the sentence set and **hard-fail** on
   any mismatch, or emit `{"incomplete": true, "expected": N, "found": M}` on the
   arm. Phase 3's crashed-arm orphans would otherwise score as a corpus WER over
   a silent subset — a plausible-looking number with no marker on it.

7. **Report the rank agreement.** Do both judges order the arms the same way? If
   yes, state that the conclusion is robust to the judge — that is the real value
   of a second ASR, and it is worth more than a lower absolute number. If no, the
   disagreement **blocks the verdict** and must be reported as blocking. A min
   would have hidden exactly this case.

8. **Report the two sentence sets separately** — never pooled. They differ in
   register, and VIVOS carries the possible-overlap caveat.

9. **For the `code-switch` subset, report CER as primary and hand-review all
   8–10 hypotheses.** The normalizer splits `check-in` into two tokens, so a
   transcript of `checkin` costs word errors regardless of audio quality; a WER
   over ten sentences is not a rate worth quoting.

10. **Write the caveats into the generated output**, not only into phase 5's
    report. A figure that travels without its caveat gets quoted without it:
    - this is PhoWhisper-**small**; the vendor used PhoWhisper-large with
      whisper-large-v3 and took the minimum. Absolute WER will be higher for
      **both** engines and is **not** comparable to the vendor's 1.03%
    - the control floors, quoted inline
    - which decoder produced the scored audio (whole-sentence, not streaming,
      unless phase 3 found them identical or wrote the streamed arm)

11. **Write `tests/test_metrics.py`** covering the normalizer on Vietnamese
    diacritics and a known WER case.

## Verification

```bash
cd benchmarks/tts-vi
uv sync --frozen
uv run python scripts/download_models.py
for tag in r1 r2; do
  uv run python score_intelligibility.py --run-tag $tag \
      --out results/report-intelligibility-$tag.md
done
# every WAV was transcribed, in both tags
uv run python score_intelligibility.py --check-complete
uv run pytest
```

## Success Criteria

- [x] `uv sync --frozen` succeeds, proving the lock did not move after phase 3 measured
- [x] Every WAV from both tags is transcribed by both judges; `--check-complete` passes
- [x] Headline WER/CER scored by PhoWhisper-small alone; Zipformer reported as a separate column; **no min-of-two column exists**
- [x] Both human-speech control floors (7.71%, 5.38%) appear in every table
- [x] Rank agreement between judges is reported, and a disagreement is marked as blocking the verdict
- [x] Sentence sets reported separately; `code-switch` subset scored by CER with all hypotheses hand-reviewed
- [x] Per-sentence JSONL carries reference, both hypotheses, and both scores
- [x] The PhoWhisper-small caveat, the control floors, and the decoder provenance appear in the generated output
- [x] `benchmarks/stt/` is unmodified

## Risk and rollback

If WER is implausibly high for **both** engines, suspect the judge or the
normalizer before the engines — check a handful of per-sentence hypotheses
against their WAVs by hand. A uniform disaster is a harness bug; the control
floors are there to make that obvious immediately. Rollback is deleting the
scoring scripts; phase 3's WAVs and numbers survive.
