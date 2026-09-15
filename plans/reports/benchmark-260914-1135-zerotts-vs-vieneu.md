---
title: 'Benchmark — ZeroTTS vs VieNeu-TTS v3 Turbo (Vietnamese TTS, CPU)'
date: 2026-09-14
plan: plans/260914-1135-benchmark-zerotts-vs-vieneu/
harness: benchmarks/tts-vi/
verdict: HOLD — ZeroTTS more intelligible, VieNeu faster, naturalness unmeasured
headline: Both engines swing 13-29pp WER between runs of identical input
---

# Benchmark — ZeroTTS vs VieNeu-TTS v3 Turbo (Vietnamese TTS, CPU)

Measured 2026-09-14 on the project machine: i7-11700K, 8 physical cores, 32 GB
RAM, **Ubuntu** (Linux 7.0.0-31-generic), CPU only. 8 inference threads per
engine, `onnxruntime` 1.27.0 pinned for both. Raw numbers: `report-speed.md`,
`results/*/`, `results/seed-sensitivity/`.

## Verdict: **HOLD** — do not swap yet; the MOS panel decides

ZeroTTS is **more intelligible** and **measurably slower**. Both differences are
real and they point opposite ways. Naturalness, the remaining input, has never
been measured for either engine.

| Dimension                           | Winner                               | Separated?                                     |
| ----------------------------------- | ------------------------------------ | ---------------------------------------------- |
| Intelligibility                     | **ZeroTTS**, median 9–10pp lower WER | Yes — both genders, bootstrap CI excludes zero |
| Synthesis speed (RTF, latency/word) | **VieNeu**                           | Yes — ranges do not overlap                    |
| Time to first _gapless_ audio       | —                                    | No — ranges overlap                            |
| Load time, peak RAM                 | **VieNeu**                           | Yes, small absolute differences                |
| Licence                             | —                                    | Tie; both permissive                           |
| **Run-to-run reliability**          | —                                    | **Neither. Both are bad.** See below           |
| Naturalness                         | **not measured**                     | —                                              |

**The question that settles it:** in a blinded `benchmarks/mos` panel on the
retained WAVs, does ZeroTTS sound at least as natural as VieNeu? If yes, swap. If
worse, the trade is genuinely contested.

## The finding that outranks the comparison

**Both engines' intelligibility swings enormously between runs of identical
input.** This was not on the plan and is the most product-relevant thing measured.

| Engine / voice      |   n | median |  mean |   min |   max | **spread** |
| ------------------- | --: | -----: | ----: | ----: | ----: | ---------: |
| zerotts / baotrang  |   8 |   9.55 | 14.12 |  6.98 | 36.34 | **29.4pp** |
| zerotts / quangminh |   8 |   7.19 |  8.24 |  4.31 | 17.04 | **12.7pp** |
| vieneu / Mai Anh    |   6 |  20.02 | 22.28 | 16.43 | 36.96 | **20.5pp** |
| vieneu / Thanh Bình |   6 |  16.32 | 17.93 | 12.73 | 30.39 | **17.7pp** |

Corpus WER %, conversational set, PhoWhisper-small. ZeroTTS passes vary by seed;
VieNeu passes are bare repeats, because it has no seed to set and varies anyway.

**VieNeu is the engine in production today**, and its WER ranges from 16.4% to
37.0% on the same 41 sentences with no input change. That is a reliability
property of the shipping system that nothing in this repo previously recorded,
and it matters more than which engine wins a benchmark.

The causes differ. ZeroTTS samples from the global RNG every frame, so its
variation is the sampler; seeding pins it exactly. VieNeu has no sampler at all
and is still not byte-reproducible — 0 of 41 outputs identical across two runs,
against ZeroTTS's 41 of 41. Why remains unexplained.

## Intelligibility — ZeroTTS wins, as a distribution

With spreads that large, comparing two single runs says almost nothing. The
comparison below is distribution to distribution (`analyze_variability.py`):

| Comparison                     |  median diff |          95% CI | separates | P(a ZeroTTS run beats a VieNeu run) |
| ------------------------------ | -----------: | --------------: | --------- | ----------------------------------: |
| female — baotrang vs Mai Anh   | **−10.47pp** | [−20.33, −0.21] | yes       |                           **83.3%** |
| male — quangminh vs Thanh Bình |  **−9.14pp** | [−16.94, −4.83] | yes       |                           **90.6%** |

Negative favours ZeroTTS. Both intervals exclude zero, so the central tendency
genuinely differs.

**But the distributions overlap.** ZeroTTS's worst run (36.34%) is worse than
VieNeu's best (16.43%). "ZeroTTS is more intelligible" is a statement about the
median, not a guarantee about any given utterance.

### What a single run looked like, and why that was not enough

The main benchmark scored each arm once per run tag. Those numbers were:

| Arm                                 | WER r1 | WER r2 |
| ----------------------------------- | -----: | -----: |
| zerotts / baotrang                  |   5.75 |   6.57 |
| zerotts / quangminh                 |   6.78 |   6.78 |
| vieneu / Mai Anh                    |  14.78 |  17.25 |
| vieneu / Thanh Bình                 |  15.20 |  14.37 |
| _control: human speech, same judge_ | _7.71_ |        |

Paired bootstrap over sentences gave −9.03pp and −8.42pp, separating in both
genders — which is within a point of the −10.47 and −9.14 the full distributions
give. **The single-run estimate happened to land close to the truth, and was not
entitled to.** The measured seed produced 6.98% and 6.78% against distribution
medians of 9.55% and 7.19%, i.e. near the favourable end of both. Seeding made
the run reproducible; it did not make it representative. Only the seed sweep
turned a lucky number into a supported claim.

**Code-switching** is where the gap is widest. CER on the 9 rows with embedded
English, single run: ZeroTTS 6.56–7.69%, VieNeu 16.06–39.37%. CER rather than WER
because the normalizer splits `check-in` into two tokens, so word scoring on nine
sentences punishes tokenization as much as audio. Not re-measured across seeds,
so read it as indicative.

**VIVOS** (50 sentences, comparability arm) separated nothing — every interval
spanned zero. Both engines score far worse there (ZeroTTS 15.6–17.6%, VieNeu
16.9–34.2%) on news-register text with proper nouns. It is also redistributed
inside ZeroBench-TTS, so ZeroTTS may have seen it. It was never the arm the
verdict rests on, and in hindsight it cost 800 of the run's 1620 inferences for
no separating result.

## Speed — VieNeu wins, consistently

Conversational set, ranges across both tags and both voices.

|                            |              VieNeu |             ZeroTTS |
| -------------------------- | ------------------: | ------------------: |
| RTF (pooled)               |   **0.507 – 0.726** |       0.782 – 0.799 |
| Latency per word           | **0.120 – 0.185 s** |     0.163 – 0.175 s |
| p50 per sentence           |   **1.42 – 1.84 s** |       1.94 – 2.11 s |
| Load time                  |   **1.73 – 1.98 s** |       3.98 – 4.14 s |
| Peak RSS                   |  **1425 – 1542 MB** |      1670 – 1690 MB |
| Speaking rate (audio/word) |     0.231 – 0.255 s | **0.207 – 0.222 s** |

The RTF ranges do not overlap. Note the speaking-rate row: ZeroTTS talks faster,
and RTF is duration-normalized, so producing shorter audio for the same words
penalises it. Latency per word — not duration-normalized — still favours VieNeu
at its fast end and is roughly a tie at its slow end.

VieNeu's timing spread is wide (RTF 0.507–0.726 for one voice across tags) while
ZeroTTS's is tight (0.782–0.799 across everything), which is why the two tags are
reported separately rather than averaged.

## Time to first audio — the vendor's headline claim, and what it is worth

| Arm                                   |      first chunk |                               underrun | **gapless start** |
| ------------------------------------- | ---------------: | -------------------------------------: | ----------------: |
| ZeroTTS streaming                     | **138 – 140 ms** | +766 to +798 ms median, +1235 ms worst |  **910 – 938 ms** |
| ZeroTTS clause-split                  |   1028 – 1144 ms |                                      — |    1028 – 1144 ms |
| **VieNeu clause-split** (ships today) |    842 – 1256 ms |                                      — | **842 – 1256 ms** |
| VieNeu whole-sentence (context only)  |   1423 – 1842 ms |                                      — |                 — |

**The 70 ms claim is directionally real and practically void here.** ZeroTTS
delivers first audio in ~140 ms. But its chunk schedule opens with a single
12.5 fps frame — 80 ms of audio — and the engine cannot generate faster than real
time early in the stream, so playback runs dry. Time until audio plays to the end
without a gap is **~911 ms**, inside VieNeu's clause-split range. These have not
separated.

**9 of 164 streams** had total generation time exceeding their audio duration, so
most catch up eventually but not all: 0/41 for baotrang in r1, 2/41 quangminh r1,
2/41 baotrang r2, 5/41 quangminh r2.

Reporting the first chunk alone would have concluded a sevenfold TTFA improvement.
That conclusion would have been wrong.

**The comparison must be against clause-split, not whole-sentence.** The app
already splits translated text in front of the engine
(`apps/api/src/modules/translate/audio/clause-splitter.ts`). Using the
whole-sentence figure as the baseline would have overstated the incumbent by
roughly 1.7× and manufactured a ZeroTTS win.

On VIVOS, clause-split TTFA is slower than whole-sentence for 5 of 8 arms and
faster for 3, all by 1–3%. Those references carry no punctuation, so splitting is
a no-op and the difference is noise, not overhead.

## Vendor claims, reconciled

| Claim                       | Measured here                                 | Verdict                                             |
| --------------------------- | --------------------------------------------- | --------------------------------------------------- |
| 70 ms to first audio sample | 138–140 ms first chunk; **911 ms to gapless** | Partly — real as a first chunk, not as usable audio |
| RTF 0.50×                   | **0.78–0.80**, very consistent                | Not reproduced                                      |
| WER 1.03%                   | median 7.2–9.6% across seeds                  | **Not comparable** — see below                      |
| UTMOSv2 2.91                | deliberately not measured                     | —                                                   |

The WER row cannot be compared. The vendor used PhoWhisper-**large** with
whisper-large-v3 and took the per-utterance minimum; this is PhoWhisper-**small**
alone, so absolute WER is higher for _both_ engines by construction. It is
meaningful only as a comparison between the two engines on identical sentences.

The vendor named no CPU alongside its figures, so the RTF gap could be hardware.

## How the two judges were used

**PhoWhisper-small scores; Zipformer-vi checks; they are never combined.** The
vendor's min-of-two protocol was deliberately not copied: `min` moves the delta
between two TTS systems in a direction that cannot be stated in advance, our two
judges are far less symmetric than the vendor's pair, and it would discard the
per-judge human-speech controls.

Control floors on the same 50 VIVOS utterances, human speech:
**PhoWhisper-small 7.71%**, **Zipformer-vi 5.38%** (`docs/development-journey.md`).

The two judges disagree on magnitude by 4–7× — Zipformer scores synthetic speech
far lower (1.03–5.56%) than PhoWhisper (5.75–34.23%) — which is why only one of
them scores. On the conversational set both judges rank ZeroTTS above VieNeu at
engine level, in both tags. On VIVOS they disagree in `r1` and agree in `r2`,
consistent with VIVOS separating nothing.

**The judge has its own noise.** PhoWhisper is deterministic within a process
(0/12 differences on a repeat pass) but 2 of 41 hypotheses differed between two
scoring processes on byte-identical audio.

## Licences — resolved, and they do not separate the engines

|                     | Code       | Weights        | Commercial use                              |
| ------------------- | ---------- | -------------- | ------------------------------------------- |
| VieNeu-TTS v3 Turbo | Apache-2.0 | **Apache-2.0** | Explicitly permitted for preset-voice audio |
| ZeroTTS             | MIT        | **MIT**        | Permitted                                   |

`README.md` recorded VieNeu as "see upstream" and flagged it as a
commercialization risk; that row was out of date, not a risk, and has been
corrected. ZeroTTS's ZeroBench-TTS _dataset_ is CC-BY-NC-4.0, but that covers the
dataset only and nothing here redistributes it.

## What this does not establish

**Naturalness.** WER measures intelligibility; a flat, robotic voice that
articulates clearly scores well. VieNeu's voices were chosen by listening. All
WAVs are retained under `results/<tag>/wav/<engine>/<voice>/<set>/`.

**UTMOSv2 was deliberately not measured** — `benchmarks/mos/README.md` records
that UTMOS is English-trained and not valid for Vietnamese.

**Which decoder was scored.** WER describes ZeroTTS's whole-sentence decoder
(`decode_full.onnx`). The streaming path uses `decode_step.onnx`, measured
equivalent within a 3.87e-06 peak delta over four sentence/voice pairs at equal
length, so the figures transfer.

**The conversational set is author-chosen and in-domain**, not adversarial, and
its author is also the person reading the result. It spells numerals out in
words, because the shared normalizer leaves digits as written.

**Sample rate is not a differentiator** — both engines output 48 kHz.

## Unresolved questions

- Does ZeroTTS sound at least as natural as VieNeu? The only remaining input to
  the swap decision; needs the `benchmarks/mos` panel.
- **Why does VieNeu vary run to run at all?** It has no sampler, produces
  byte-different output on identical input, and swings 16.4–37.0% WER in
  production configuration. This is the most actionable open question here and it
  concerns the shipping system, not the challenger.
- ZeroTTS's output is reproducible for an identical _call sequence_ at a fixed
  seed, but the same seed under a different sequence of preceding calls gave
  5.75% in the main run against 6.98% in the seed sweep. Suspected ONNX Runtime
  state carried across calls in a process; not confirmed.
- Would a larger `first_chunk_frames`, or a short client-side buffer, turn the
  140 ms first chunk into gapless audio below VieNeu's clause-split figure? This
  is the one change that could flip the TTFA column.
- The code-switch subset (9 sentences) was measured on a single run only.
