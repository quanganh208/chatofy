# VibeVoice-ASR — evaluated 2026-09-04, did not win

Whether Microsoft's VibeVoice-ASR could replace the CampPlus embedding + cosine
clustering in `packages/realtime-client/src/state/auto-attribution.ts`, which
does diarization from voice embeddings rather than from the waveform.

**Verdict: no, not in its current form.** Fast enough on CPU, but it gets the
speaker count right in only 18 of 30 clips. Median accuracy 98.2%, mean 75.8% —
bimodal, so the mean is not a description of typical behaviour.

Measured, not estimated. The harness is gone (scratchpad, deleted); the numbers
are reproduced in full below so this file stands alone.

## What was measured

|         |                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| Model   | `microsoft/VibeVoice-ASR`, Qwen2-7B decoder + acoustic/semantic σ-VAE encoders                               |
| Weights | `cstr/vibevoice-asr-GGUF` — third-party conversion, not Microsoft                                            |
| Runtime | [CrispStrobe/CrispASR](https://github.com/CrispStrobe/CrispASR) `0.8.31` (`d04ae021`), `--backend vibevoice` |
| Machine | i7-11700K, 8c/16t, AVX-512+VNNI, no `avx512_bf16`, no AMX, 32 GB                                             |
| Device  | CPU only — the RX 580 is Polaris/gfx803, dropped from ROCm                                                   |
| Corpus  | VoxVietnam test split, already on disk under `corpora/`                                                      |

The streaming siblings (`VibeVoice-ASR-Streaming-1.5B/7B`) were ruled out before
measuring: 10 languages, **no Vietnamese**, GPU-only, ~2s attribution latency.

## Clip construction

30 synthetic two-speaker conversations, ~62s each, 30.3 min total. Six
alternating turns per clip, each turn a **whole VoxVietnam utterance** (≥8s,
capped at 10s), 0.4s of silence between turns. 70 eligible speakers, no speaker
in more than two pairs.

Whole utterances matter. A first attempt spliced 8s slices out of the _middle_
of utterances; the decoder ran away on the resulting discontinuities and emitted
`"Đúng rồi."` ~120 times. That was an artifact of the clip builder, not the
model, and every number here comes from the utterance-aligned rebuild.

Ground truth is exact by construction, so no reference transcript is needed —
VoxVietnam is a speaker-verification corpus and has none. **No WER was
measured.**

## Scoring

10ms frames over ground-truth speech regions only (the inter-turn silence is
synthetic; scoring it would measure the gap generator). Speaker labels are
permutation-invariant, as in DER. Segments the model emits without a speaker —
`[Music]`, which VoxVietnam's interview audio does contain — count as wrong when
they land inside a speech region.

## Result

30 clips, `-t 8 --chunk-seconds 300`, two generation caps:

|                              | `-n` default (512) |      `-n 1536` |
| ---------------------------- | -----------------: | -------------: |
| Accuracy mean                |              75.8% |          79.2% |
| Accuracy median              |              98.2% |          98.2% |
| p25                          |              50.0% |          51.2% |
| min / max                    |     16.7% / 100.0% | 16.7% / 100.0% |
| Coverage mean                |              88.7% |          93.9% |
| Clips covering <90% of audio |               7/30 |           3/30 |
| Clips ≥90% accuracy          |              17/30 |          17/30 |
| Clips <60% accuracy          |              12/30 |           9/30 |
| **Correct speaker count**    |          **18/30** |      **18/30** |
| RTF mean                     |               1.50 |           2.05 |
| Peak RSS                     |             6.3 GB |         6.3 GB |

Decode ~5 tok/s, CPU 724% of 800% — memory-bandwidth bound, as a 7B model on
dual-channel DDR4 has to be.

### Two failure modes, and the token cap only touches one

`vibevoice_resolve_max_new_tokens` is `max(512, audio_seconds * 8)`, so a 62s
clip gets 512. Raising it to 1536 bought +3.4 points and cost 37% wall time.
Only 4 clips moved at all:

```
conv-08   50.4% -> 84.8%      conv-18   17.5% -> 51.2%
conv-09   45.9% -> 62.6%      conv-07   48.9% -> 65.3%
```

The other 26 were unchanged, because:

- **Runaway decode.** 7 clips ran to the raised 1536 cap and still covered only
  part of the audio. `conv-11` generated 1537 tokens and covered 10.09s of 62.4s
  either way. More budget only buys a longer loop.
- **Wrong speaker count — independent of the cap.** The label count was
  identical in **all 30 clips** across both runs. 6 clips collapse two people
  into one, 5 find three, 1 finds four. `conv-13` covers the full 62.4s and
  still finds one speaker: 50.0%, exactly chance at two speakers.

### Per-clip, `-n` default

`rtf`, `gen` tokens, `lab` speakers found (truth 2), `cov` seconds covered, `acc` %:

```
conv-00 rtf1.83 gen503 lab2 cov62.4/62.4  94.7   conv-15 rtf1.60 gen513 lab1 cov61.0/61.0  51.2
conv-01 rtf1.63 gen498 lab2 cov62.4/62.4  98.0   conv-16 rtf1.57 gen513 lab1 cov62.4/62.4  50.0
conv-02 rtf1.62 gen513 lab3 cov59.4/62.4  46.9   conv-17 rtf1.39 gen384 lab2 cov61.0/61.0 100.0
conv-03 rtf1.61 gen503 lab2 cov62.4/62.4  98.4   conv-18 rtf1.59 gen513 lab1 cov18.9/59.7  17.5
conv-04 rtf1.52 gen469 lab2 cov61.7/61.7  98.6   conv-19 rtf1.54 gen513 lab2 cov18.9/60.2  31.9
conv-05 rtf1.49 gen461 lab2 cov61.7/61.7  98.4   conv-20 rtf1.58 gen513 lab1 cov58.8/58.8  50.4
conv-06 rtf1.51 gen448 lab2 cov58.7/58.7  99.5   conv-21 rtf1.36 gen367 lab2 cov55.9/55.9  98.7
conv-07 rtf1.59 gen513 lab3 cov40.5/60.6  48.9   conv-22 rtf1.35 gen363 lab2 cov55.9/55.9  98.9
conv-08 rtf1.61 gen513 lab3 cov39.4/60.5  50.4   conv-23 rtf1.33 gen358 lab2 cov56.5/56.5  99.8
conv-09 rtf1.56 gen513 lab4 cov51.7/62.4  45.9   conv-24 rtf1.30 gen363 lab2 cov61.4/61.4 100.0
conv-10 rtf1.55 gen513 lab3 cov44.0/62.4  50.0   conv-25 rtf1.36 gen388 lab2 cov59.1/59.1 100.0
conv-11 rtf1.55 gen513 lab1 cov10.1/62.4  16.7   conv-26 rtf1.35 gen378 lab2 cov60.1/60.1 100.0
conv-12 rtf1.50 gen481 lab2 cov62.4/62.4 100.0   conv-27 rtf1.41 gen395 lab2 cov57.5/57.5  99.3
conv-13 rtf1.55 gen513 lab1 cov62.4/62.4  50.0   conv-28 rtf1.40 gen403 lab2 cov59.4/59.4  99.4
conv-14 rtf1.41 gen428 lab3 cov62.4/62.4  83.0   conv-29 rtf1.44 gen433 lab2 cov60.4/60.4  98.3
```

## Configuration that matters, if this is revisited

```bash
crispasr --backend vibevoice -m vibevoice-asr-q4_k.gguf \
  -f audio.wav -t 8 --chunk-seconds 300 -oj -of out
```

- **`--chunk-seconds 300` is not optional.** The CLI defaults to 30s chunks
  (`--chunk-overlap 3.0` makes them 32.5s) and **speaker IDs do not carry across
  a chunk boundary** — the same person becomes Speaker 0 in one chunk and
  Speaker 1 in the next. One pass is also faster: one prefill, not three. The
  model's own encoder limit is 300s
  (`CRISPASR_VIBEVOICE_ENCODER_CHUNK_SECONDS`), so this is a CLI default that
  does not suit this backend.
- **q4_k, not q8_0** — against the model card's own advice ("Q8_0 — near-F16
  quality, recommended if Q4_K sounds off"). On 9 clips q8_0 ran 1.5× slower
  (RTF 2.37 vs 1.63), needed 10.35 GB peak vs 6.3 GB, and degenerated on the
  multi-speaker clips. Mean over those 9 was ~70.9%. The remaining 21 were not
  run — the conclusion was not in doubt and the compute was not worth it.
- **Leave `-n` alone.** See the table.
- Input must be 24 kHz mono. This machine has no `ffmpeg` binary; PyAV (already
  a `services/local-stt` dependency) or `scipy.signal.resample_poly` both work.
- 16 GB of GGUF and a CrispASR build were deleted after measuring. Re-running
  means re-downloading `vibevoice-asr-q4_k.gguf` (4.5 GiB) and rebuilding.

## Why this does not replace what ships

`auto-attribution.ts` caps at `kMax = 2` because the bench measured that at k=3
the clusterer splits a two-person conversation into three in 76% of meetings and
exact-count collapses from 0.9967 to 0.2300. VibeVoice has no such guard, and
pays for it in exactly that way: 6/30 clips invent a third or fourth speaker,
6/30 merge two people into one.

The two numbers are **not directly comparable** — different metric (time-weighted
frames vs prefix-locked turns), different corpus, and these clips are synthetic.
What transfers is the shape: VibeVoice's ceiling is high (median 98.2%, several
clips at 100.0%) and its floor is chance.

These clips have no overlapping speech, no interruptions, and uniform 0.4s gaps.
Real conversation is harder, so **79.2% is an upper bound, not an expectation.**

## Unresolved

- Would a smaller model behave better? `vibevoice-bitnet` (TQ2_0 ternary, 1.6 GB)
  is already a backend in the same build. Language coverage listed as "7+" —
  needs checking for Vietnamese before it is worth measuring.
- Does the offline model do better on real recorded two-person audio than on
  spliced VoxVietnam? Nothing here answers that.
- Is the q8_0 degeneration a reproducible upstream bug worth reporting to
  CrispASR? There is a minimal repro (any of the multi-speaker clips) but it was
  never isolated from the GGUF conversion.
- No WER. If VibeVoice is ever reconsidered for transcription rather than
  diarization, that is the missing measurement.
