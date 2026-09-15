# ZeroTTS vs VieNeu-TTS v3 Turbo — Vietnamese TTS on CPU

Measured 2026-09-14 and **re-measured 2026-09-15** on the project machine:
i7-11700K, 8 physical cores, 32 GB RAM, **Ubuntu** (Linux 7.0.0-31-generic), CPU
only. 8 inference threads per engine, `onnxruntime` 1.27.0 pinned for both. Raw
numbers: `report-speed.md`, `results/*/`, `results/seed-sensitivity/`.

> **The 2026-09-14 run measured the two engines on unequal terms** — ZeroTTS
> seeded and streamed, VieNeu unseeded and timed as clause-split synthesis in
> front of a streaming API the adapter did not use. The run was redone on
> 2026-09-15 with both engines seeded and both streaming; the speed, TTFA,
> reproducibility and verdict sections below are from that run. The unseeded
> run's raw figures are kept in `results/unseeded-baseline/`, and
> `plans/reports/benchmark-260915-1051-seeded-streaming-rerun.md` is the full
> account of what changed and why.

## Verdict: **KEEP VieNeu — and stream it**

ZeroTTS is **more intelligible**. VieNeu is faster on every timing dimension,
and on the one that decides a realtime product it is not close: ZeroTTS underran
on **every stream it produced, 164 of 164**, while VieNeu reaches gapless audio
four to five times sooner.

| Dimension                           | Winner                               | Separated?                                  |
| ----------------------------------- | ------------------------------------ | ------------------------------------------- |
| **Time to first _gapless_ audio**   | **VieNeu, 4–5×**                     | Yes — 221–257 ms against 937–1281 ms        |
| **Stream stability**                | **VieNeu**                           | Yes — ZeroTTS starved on 164 of 164 streams |
| Synthesis speed (RTF, latency/word) | **VieNeu**                           | Yes — ranges do not overlap                 |
| Load time, peak RAM                 | **VieNeu**                           | Yes, small absolute differences             |
| Intelligibility                     | **ZeroTTS**, median 9–10pp lower WER | Yes on conversational; no on VIVOS          |
| Run-to-run reliability              | tie                                  | Both bit-identical under a seed             |
| Licence                             | —                                    | Tie; both permissive                        |
| Naturalness                         | **not measured**                     | —                                           |

**The change worth making is not the swap.** The app waits 781–1193 ms for
VieNeu clause-split today; the same engine's own stream reaches gapless audio in
221–257 ms. The MOS panel is still worth running, but as a quality baseline for
the incumbent rather than as the gate on a change the rest of the evidence no
longer supports.

## The finding that outranks the comparison

**Both engines' intelligibility swings enormously between runs of identical
input.** This was not on the plan and is the most product-relevant thing measured.

| Engine / voice      |   n | median |  mean |   min |   max | **spread** |
| ------------------- | --: | -----: | ----: | ----: | ----: | ---------: |
| zerotts / baotrang  |   8 |   9.55 | 14.12 |  6.98 | 36.34 | **29.4pp** |
| zerotts / quangminh |   8 |   7.19 |  8.24 |  4.31 | 17.04 | **12.7pp** |
| vieneu / Mai Anh    |   6 |  20.02 | 22.28 | 16.43 | 36.96 | **20.5pp** |
| vieneu / Thanh Bình |   6 |  16.32 | 17.93 | 12.73 | 30.39 | **17.7pp** |

Corpus WER %, conversational set, PhoWhisper-small. ZeroTTS passes vary by seed.
The VieNeu passes were taken as bare repeats, which — now that the engine is
known to sample from the same unseeded global RNG — were a seed sweep in
disguise, drawing whatever seed the interpreter happened to hold.

**VieNeu is the engine in production today**, and its WER ranges from 16.4% to
37.0% on the same 41 sentences with no input change. That is a reliability
property of the shipping system that nothing in this repo previously recorded,
and it matters more than which engine wins a benchmark.

The cause is the same on both sides, which took a second look to establish.
Both engines sample from the _global_ `np.random` every frame and neither exposes
a seed parameter. The original run seeded one of them, and reported the resulting
"ZeroTTS 41/41, VieNeu 0/41" as a property of the engines. Seeded identically,
both are now bit-identical across tags and across processes: 41/41 on the
conversational set, 50/50 on VIVOS.

A seed makes a measurement reproducible, not representative. The spread above is
still the evidence about level, and the shared seed happens to sit at ZeroTTS's
best draw of eight for `baotrang` and in the bad tail for `Mai Anh`.

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

The main benchmark scored each arm once per run tag. The unseeded run
(`results/unseeded-baseline/`) and the seeded re-run give:

| Arm                                 | unseeded r1 | unseeded r2 | **seeded r1** | **seeded r2** |
| ----------------------------------- | ----------: | ----------: | ------------: | ------------: |
| zerotts / baotrang                  |        5.75 |        6.57 |      **6.78** |      **6.98** |
| zerotts / quangminh                 |        6.78 |        6.78 |      **6.78** |      **6.78** |
| vieneu / Mai Anh                    |       14.78 |       17.25 |     **29.16** |     **29.16** |
| vieneu / Thanh Bình                 |       15.20 |       14.37 |     **14.78** |     **14.99** |
| _control: human speech, same judge_ |      _7.71_ |             |               |               |

The seeded column is where "reproducible is not representative" stops being an
abstraction. `Mai Anh` at the shared seed scores 29.16% against a distribution
median of 21.97% — the seed that pins ZeroTTS at its best draw of eight puts
VieNeu's female voice in its bad tail. **Read the distribution table above for
the gap, not this one.**

One more thing the seeded columns show: the r1 and r2 WAVs are byte-identical,
yet WER still moves 0.2pp between them (`baotrang` 6.78 → 6.98, `Thanh Bình`
14.78 → 14.99). That is the ASR judge's own nondeterminism, and it is the floor
on how small a WER difference this harness can honestly claim.

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
| RTF (pooled)               |   **0.497 – 0.641** |       0.865 – 0.977 |
| Latency per word           | **0.110 – 0.164 s** |     0.182 – 0.209 s |
| p50 per sentence           |   **1.26 – 1.86 s** |       2.09 – 2.41 s |
| Load time                  |   **1.72 – 1.83 s** |       4.09 – 4.54 s |
| Peak RSS                   |  **1544 – 1622 MB** |      1647 – 1702 MB |
| Speaking rate (audio/word) |     0.221 – 0.256 s | **0.207 – 0.222 s** |

Both arms now synthesize an extra full stream per sentence on this set, so each
is doing more work than in the unseeded run. The comparison between them is
unaffected: both carry the same extra load.

The RTF ranges do not overlap. Note the speaking-rate row: ZeroTTS talks faster,
and RTF is duration-normalized, so producing shorter audio for the same words
penalises it. Latency per word — not duration-normalized — still favours VieNeu
at its fast end and is roughly a tie at its slow end.

Both engines' timing spreads are wide enough across tags that the two are
reported separately rather than averaged.

## Time to first audio — the vendor's headline claim, and what it is worth

Medians over the conversational set, both tags. Every arm below streams: the
2026-09-14 version of this table had no VieNeu streaming row because the adapter
declared the engine incapable of it.

| Arm                                   |      first chunk |     underrun p50 |    underrun worst | **gapless start** |        starved |
| ------------------------------------- | ---------------: | ---------------: | ----------------: | ----------------: | -------------: |
| **VieNeu streaming**                  |     221 – 257 ms |   −119 to −92 ms |    −17 to +350 ms |  **221 – 257 ms** |      20 of 164 |
| **VieNeu clause-split** (ships today) |                — |                — |                 — |     781 – 1193 ms |              — |
| ZeroTTS streaming                     | **144 – 153 ms** | +796 to +1134 ms | +1245 to +2351 ms |     937 – 1281 ms | **164 of 164** |
| ZeroTTS clause-split                  |                — |                — |                 — |    1232 – 1476 ms |              — |

**The 70 ms claim is directionally real and practically void here.** ZeroTTS
delivers first audio in ~148 ms, about 100 ms sooner than VieNeu. But its chunk
schedule opens with a single 12.5 fps frame — 80 ms of audio — and the engine
cannot generate faster than real time, so playback runs dry on **every stream
measured**, by eight tenths of a second to over a second at the median. Time
until audio plays to the end without a gap is 937–1281 ms against VieNeu's
221–257 ms. These separate, in the incumbent's favour.

Reporting the first chunk alone would have concluded a sevenfold TTFA
improvement. That conclusion would have been wrong by a factor of roughly
twenty-five in the opposite direction.

**The comparison must be against clause-split, not whole-sentence.** The app
already splits translated text in front of the engine
(`apps/api/src/modules/translate/audio/clause-splitter.ts`). Using the
whole-sentence figure as the baseline would have overstated the incumbent by
roughly 1.7× and manufactured a ZeroTTS win.

**And clause-split is a baseline, not the engine's floor.** The splitter exists
to work around a streaming API `vieneu` turns out to have. Its own stream is
three to five times faster than the split path the app waits for today, which is
the largest latency gain this benchmark found and needs no engine swap.

On VIVOS, clause-split TTFA is slower than whole-sentence for 5 of 8 arms and
faster for 3, all by 1–3%. Those references carry no punctuation, so splitting is
a no-op and the difference is noise, not overhead.

## Vendor claims, reconciled

| Claim                       | Measured here                                      | Verdict                                             |
| --------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| 70 ms to first audio sample | 144–153 ms first chunk; **937–1281 ms to gapless** | Partly — real as a first chunk, not as usable audio |
| RTF 0.50×                   | **0.87–0.98**                                      | Not reproduced                                      |
| WER 1.03%                   | median 7.2–9.6% across seeds                       | **Not comparable** — see below                      |
| UTMOSv2 2.91                | deliberately not measured                          | —                                                   |

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

**Which decoder was scored.** WER describes each engine's whole-sentence
decoder. ZeroTTS's streaming path uses `decode_step.onnx` against
`decode_full.onnx`, measured equivalent within a 3.87e-06 peak delta; VieNeu's
`infer_stream` differs from `infer` by at most 1.5e-06 with identical acoustic
tokens. Both deltas are below a 16-bit LSB, so the figures transfer to the
streamed path on both engines and no third scoring arm exists.

**VieNeu's streamed output is not bit-identical even at a fixed seed**, for a
reason that is in the package rather than in the sampler: `infer_stream` sizes
each decode chunk from `time.perf_counter()`, so chunk boundaries follow machine
speed. The audio agrees to 1.5e-06; only the chunking moves.

**The conversational set is author-chosen and in-domain**, not adversarial, and
its author is also the person reading the result. It spells numerals out in
words, because the shared normalizer leaves digits as written.

**Sample rate is not a differentiator** — both engines output 48 kHz.

## Unresolved questions

- Does ZeroTTS sound at least as natural as VieNeu? Needs the `benchmarks/mos`
  panel. It no longer gates a swap, but it is the only quality figure the
  incumbent has never had.
- ~~Why does VieNeu vary run to run at all?~~ **Answered:** it samples from the
  unseeded global RNG, exactly as ZeroTTS does. Seeded, it is bit-identical
  41/41 and 50/50.
- Should the seed sweep be re-run on a set of **shared** seeds, now that both
  engines take one? That is the comparison the intelligibility verdict actually
  rests on, and it has never been run on common ground.
- ZeroTTS's output is reproducible for an identical _call sequence_ at a fixed
  seed, but the same seed under a different sequence of preceding calls gave
  5.75% in the unseeded run against 6.98% in the seed sweep. Suspected ONNX
  Runtime state carried across calls in a process; not confirmed.
- Would a larger `first_chunk_frames`, or a client-side buffer, close ZeroTTS's
  0.8–1.1 s underrun? It would have to close all of it: the stream starved on
  164 of 164 sentences, not on a tail.
- The code-switch subset (9 sentences) was measured on a single run only.
