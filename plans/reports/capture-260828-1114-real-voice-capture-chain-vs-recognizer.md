# Real voice, three capture chains, one sentence — the chain moves WER 4x

**Date:** 2026-08-28
**Plan:** `plans/260827-2150-vi-transcript-display-and-turn-merge/`
**Status:** evidence recorded. Does **not** close Phase 3 — see "What this is not".

## Question

Phase 6 showed the decoder is not the limiting factor on clean close-mic VIVOS
audio. Open: is it the limiting factor on the audio a real user produces?

## Method

One sentence, one speaker, three recordings. Only the recording chain varies —
same model, same decode path, same config.

- Decode: `services/local-stt/audio/decode.py::decode_to_16k_mono` (PyAV), the
  sidecar's own path, so the samples are what a live upload would produce.
- Recognizer: shipping config — Zipformer-30M INT8, `greedy_search`,
  `num_threads=8` (`services/local-stt/engines/zipformer_vi.py`).
- Display string: that file's `postprocess()` verbatim (strip, lower, capitalize
  first character).
- Scoring: `benchmarks/stt/stt_bench/metrics.py` + `text_normalize.py` — the same
  normalization every recorded WER in this repo used.

Two references for the same utterance:

- **SPOKEN** — what the speaker said, numerals as spoken. Fair score for a
  recognizer with no inverse text normalization. 47 words.
- **WRITTEN** — the sentence as written, digits and punctuation intact. What the
  user reads on screen, and what Phase 4 targets. 41 words after normalization
  (`ngày 2 9 1945 tại quảng trường ...`).

Reference sentence (WRITTEN): _Ngày 2/9/1945, tại Quảng trường Ba Đình lịch sử,
Chủ tịch Hồ Chí Minh đọc Tuyên ngôn Độc lập, khai sinh nước Việt Nam dân chủ
cộng hòa, nay là nước Cộng hòa xã hội chủ nghĩa Việt Nam._

## Result

| take     | capture chain        | dur s | WER spoken % | CER spoken % | WER written % | digits | punct | proper-noun caps |
| -------- | -------------------- | ----- | ------------ | ------------ | ------------- | ------ | ----- | ---------------- |
| `take-a` | messaging app (Opus) | 12.0  | 14.9         | 9.0          | 31.7          | 0      | 0     | 0                |
| `take-b` | messaging app (Opus) | 10.0  | 17.0         | 11.9         | 39.0          | 0      | 0     | 0                |
| `take-c` | iPhone Voice Memos   | 12.1  | **4.3**      | **2.4**      | 26.8          | 0      | 0     | 0                |

Edit operations, spoken reference (47 words):

| take     | S   | D   | I   | total |
| -------- | --- | --- | --- | ----- |
| `take-a` | 5   | 2   | 0   | 7     |
| `take-b` | 5   | 3   | 0   | 8     |
| `take-c` | 2   | 0   | 0   | 2     |

## Three findings

### 1. The capture chain is worth ~4x the recognizer's own error rate

Same speaker, same sentence, same model: 17.0% on the messaging-app chain,
4.3% on the iPhone one. The recognizer did not change between those two numbers.
Nothing in the decoder budget buys a 12.7-point swing — Phase 6 measured the best
available decoder lever at **0.72 pt, and that under an oracle hotword list**.

`take-c` at 4.3% also **beats the 5.38% VIVOS headline**, on unseen real speech
with proper nouns. The model is not the problem.

The two chains differ in more than one variable (codec, bitrate, and whatever
processing each app applies), so this identifies "the chain", not which knob in
it. It is enough to rank the levers.

### 2. Errors cluster where audio quality collapses, not on hard vocabulary

| region                  | `take-a`                      | `take-b`          | `take-c`       |
| ----------------------- | ----------------------------- | ----------------- | -------------- |
| date `một chín bốn lăm` | `một` deleted                 | `lăm` → `năm`     | correct        |
| `Quảng trường`          | correct                       | correct           | → `trình`      |
| `đọc Tuyên ngôn`        | → `lập thành`, `ngôn` deleted | → `độc quy mô`    | `đọc` → `được` |
| `khai sinh nước`        | correct                       | all three deleted | correct        |
| `nay là`                | → `đây là`                    | → `đây là`        | correct        |

`Hồ Chí Minh`, `Ba Đình`, `Cộng hòa xã hội chủ nghĩa Việt Nam` are correct in all
three. The proper nouns survive; the unstressed function words and the verb
`đọc` do not. That is a signal-quality failure pattern, not a vocabulary one — and
it is the pattern hotword biasing is least able to help, since the words being
lost are the common ones no sane hotword list contains.

### 3. Numeral form alone costs 9 word errors on one sentence

`take-c` scores 2 errors against the spoken reference and 11 against the written
one. Every one of the extra 9 (3 substitutions + 6 insertions) is the date:
`2 9 1945` (3 tokens) against `mùng hai tháng chín năm một chín bốn lăm` (9).

This is the Phase 2 argument, now measured on real audio rather than argued from
VIVOS. Scoring the spoken reference _verbatim_ against the written one — a
recognizer that makes no mistakes at all — isolates the numeral cost from
`take-c`'s own two errors:

| hypothesis vs WRITTEN reference        | S   | D   | I   | total | WER       |
| -------------------------------------- | --- | --- | --- | ----- | --------- |
| `take-c` (4.3% against spoken)         | 5   | 0   | 6   | 11    | **26.8%** |
| a perfect recognizer (spoken verbatim) | 3   | 0   | 6   | 9     | **22.0%** |

**A recognizer at 4.3% spoken WER scores 26.8% against written Vietnamese, and a
flawless one still scores 22.0%** — that 22.0% is the date and nothing else. WER
cannot see the display defect, and repairing the display would make WER worse.

Digits, punctuation and proper-noun capitals are **0 across all three takes**,
independent of audio quality. The display defect is not an audio problem and no
amount of better microphone fixes it.

## What this also produced: the merge threshold was mis-calibrated

Replaying all three takes through the real `CapturePump` (`continuous: true`,
`fullDuplex: true`, the app's own options) at ceilings from 4s to 10s yielded 22
forced cuts:

| min   | median | p90   | max   |
| ----- | ------ | ----- | ----- |
| 128ms | 202ms  | 427ms | 597ms |

The shipped `MAX_CAPTURE_GAP_MS = 400` merged only 18 of 22, and **failed on two
of the three takes at the shipped 8s ceiling** — the Phase 5 fix did not fire on
real speech. Raised to 1200ms with regression tests over the three measured gaps
(commit `f2e31b3`). The original 400 was reasoned from a single ~130ms
observation and never measured: the `TAU_SUGGEST` lesson repeating inside the plan
that cites it.

## What this is not

**Not Phase 3.** Phase 3 asks whether the _browser_ capture chain (AGC, noise
suppression, `PRE_ROLL_MS = 320`, `MIN_SPEECH_MS = 120`) drops the head of an
utterance. Neither recording here went through a browser. This compares two
_external_ chains and shows the chain matters; it does not measure the one that
ships. Phase 3 stays `pending`.

**Not Phase 2.** Not the browser-recorded display-fidelity set the plan decided
on, and n=1 sentence. It is a seed, not the corpus.

**Not a corpus.** One speaker, one sentence, three takes. Direction is clean;
magnitude carries no precision. 47 words means one word error ≈ 2.1 WER points.

## Reproduce

```bash
cd benchmarks/stt
uv run python <scratch>/score_takes.py   # decodes the 3 source files, scores both refs
```

Source audio is the user's own voice and is **not** committed (personal data).
Numbers above were re-measured from the source files for this report, not carried
forward from the session that first produced them.

## Consequence for the plan

Two independent measurements now point the same way — Phase 6's null decoder
result on clean audio, and a 4x chain effect on real audio. **The recognizer is
not where the remaining Vietnamese quality lives.** That raises the value of
Phase 3 (which chain knob, in the chain that actually ships) and leaves Phase 4's
case untouched: the display defect measured 0/0/0 regardless of audio quality.

## Unresolved

1. Which knob inside the messaging-app chain costs the 12.7 points — codec
   bitrate, or the app's own noise processing? Not separable from these files.
2. Does the browser chain sit closer to the iPhone take or the messaging-app
   takes? This is Phase 3 and needs a browser recording.
3. Is `nay` → `đây` (both bad takes, neither in the good one) a signal artifact or
   a genuine model weakness on that word? One sentence cannot tell.
