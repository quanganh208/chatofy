# Development journey — Chatofy

Project: **Chatofy** — a two-way vi↔en speech translation app (thesis).
Target machine for every measurement: **i7-11700K, 8 physical cores / 16 threads, 32 GB
RAM, Windows 11, CPU-only, no GPU**.

This document is the **consolidated record** of all research, benchmarks, design
decisions and measurements — merged from 12 separate reports (brainstorm, benchmark,
advisory, delivery, phase, weekly report) that were removed after the merge. Every
number below is **measured**, not estimated, except where it is explicitly marked as an
estimate.

Purpose: the single source for writing the thesis report — the methodology chapter, the
experiments chapter, the results chapter, and the lessons-learned section.

---

## 1. Problem and architecture

**Problem.** Translate spoken vi↔en conversation with latency low enough to feel
natural, running on an ordinary machine without a GPU.

**Starting point (before 18/07/2026).** Turn-based translation over REST: press the
record button → send the file → wait → listen to the result. STT and TTS both called
the ElevenLabs cloud. Only Vietnamese TTS was local (the VieNeu sidecar).

**End point (26/07/2026).** Hands-free conversation over WebSocket: speak naturally, no
buttons; the source text streams while you speak; a provisional translation follows
behind it; the translated audio plays ~0.9 s after you stop speaking. All speech
recognition + speech synthesis runs locally on CPU, with no API key.

```
apps/web (Next.js)  ──WebSocket /ws/translate──> apps/api (NestJS)
                                                    │
                             ┌──────────────────────┼───────────────────────┐
                             │                      │                       │
                    services/local-stt :8002   services/local-tts :8003   Gemini (cloud)
                    Zipformer-30M (vi)         Kokoro-82M (en)           machine translation
                    Moonshine base (en)        VieNeu v3 (vi)
                    sherpa-onnx + PyAV         sherpa-onnx + VieNeu
```

`POST /translate` (REST, synchronous) **keeps its behavior unchanged** — it is the
**measurement control for the thesis** and must not be modified. The
`/translate/baseline` page used to be where that control was run by hand; the page was
deleted together with `/translate/live` during the web cleanup, while the endpoint was
left untouched. Latency figures in this document are measured with
`benchmarks/realtime`, not through the browser.

**The system is not fully offline yet:** machine translation is still Gemini cloud.
Only speech is local.

---

## 2. Timeline

| Milestone | Date     | Content                                                       | Result                                                              |
| --------- | -------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1         | 18/07    | Research + benchmark STT/TTS models running on CPU            | Settled on Zipformer-30M (vi), Moonshine base (en), Kokoro-82M (en) |
| 2         | 23–24/07 | Integrate local speech into the real pipeline                 | 2 sidecars, 2 providers, `local` became the default                 |
| 3         | 24/07    | Pick the Gemini model by quota instead of by "tier"           | No more whole demo session dying when 1 model runs out of quota     |
| 4         | 25/07    | Latency-measurement spike + build the realtime WebSocket flow | Measured latency budget ≈1.13 s                                     |
| 5         | 25–26/07 | Fix the head-start bug, live source text, live translation    | p50 907 ms · p95 1582 ms                                            |

---

## 3. Phase 1 — Choosing speech models by benchmark (18/07)

### 3.1 Constraints set before the research

- Hardware: Windows, 8 physical cores, 32 GB RAM, **CPU-only**.
- Latency: ≤2 s for a 5–10 s sentence ⇒ **RTF ≤ 0.3**; batch (turn-based), streaming
  not needed yet.
- 2 specialised models (one for vi, one for en) — the registry already routes by
  language.
- Integrate following the Python FastAPI + uv sidecar pattern (like
  `services/vieneu-tts`).
- License must be usable for an academic thesis; state it clearly if non-commercial.

### 3.2 Method — research → benchmark → decide

Models are not chosen by published numbers. A 3-step process, repeated in 2 rounds
within the day (one round for STT, one round for TTS):

1. Survey candidates through papers / model cards / community benchmarks (2025–2026).
2. Build a **reproducible** benchmark harness, measured on **the actual target
   machine**.
3. Decide by quantitative thresholds set in advance; TTS adds a subjective A/B
   listening step.

Harness: 2 independent Python projects, `benchmarks/stt/` and `benchmarks/tts/`. Each
engine runs in **its own subprocess** (RAM isolation, no CPU contention), with 1
untimed warm-up pass, run twice to check variance, and decode parameters + thread count
written into the results for reproducibility. The harness is measurement-only — the
README states "never imported by the app".

Test sets: **VIVOS test** (vi, CC BY-NC-SA 4.0) and **LibriSpeech test-clean** (en,
CC BY 4.0), 50 utterances per language, seed 42. WER normalisation: NFC, lowercase,
strip punctuation, **keep Vietnamese diacritics**; numbers written as spoken.

### 3.3 STT candidates surveyed (published / estimated numbers, before measuring)

| Model                           | Lang | Params  | Published WER           | RTF                     | RAM        | License       | Engine                |
| ------------------------------- | ---- | ------- | ----------------------- | ----------------------- | ---------- | ------------- | --------------------- |
| Zipformer-30M-RNNT-6000h (hynt) | vi   | 30M     | 7.97% VLSP2025          | 0.025                   | ~150MB     | CC-BY-NC-ND ✗ | sherpa-onnx           |
| PhoWhisper-small (VinAI)        | vi   | 244M    | 11.08% VIVOS            | ~0.15–0.3 (est.)        | ~600MB     | BSD-3 ✓       | faster-whisper INT8   |
| PhoWhisper-base                 | vi   | 74M     | 16.19%                  | ~0.1–0.2 (est.)         | ~300MB     | BSD-3 ✓       | faster-whisper        |
| wav2vec2-base-vi-250h           | vi   | 95M     | 6.15% (needs 4-gram LM) | 0.165                   | ~250MB     | CC-BY-NC ✗    | transformers/ONNX     |
| Whisper-small multilingual      | vi   | 244M    | worse than PhoWhisper   | ~0.78 → **fails**       | ~600MB     | MIT ✓         | faster-whisper        |
| Moonshine tiny/base             | en   | 27M/61M | ~7.8% avg               | ~0.07–0.27              | ~200–800MB | MIT ✓         | ONNX RT / sherpa-onnx |
| whisper.cpp small.en Q4/Q5      | en   | 244M    | 3.05% LibriSpeech       | ~0.1–0.2 (extrapolated) | ~150–400MB | MIT ✓         | whisper.cpp           |
| Zipformer-en transducer         | en   | ~273M   | ~8%                     | ~0.167                  | ~270MB     | Apache-2.0 ✓  | sherpa-onnx           |
| Parakeet TDT 0.6B               | en   | 600M    | top of leaderboard      | ~1.38 → **fails**       | —          | CC-BY-4.0     | NeMo/ONNX             |
| Vosk en                         | en   | small   | 12–14% — poor           | ~0.3                    | low        | Apache-2.0    | vosk                  |

**A single one-for-all multilingual model: not feasible.** Whisper large-v3/turbo is too
slow on CPU; Parakeet v3 has no Vietnamese; Moonshine only has en. The research
confirmed that the "2 specialised models" decision was correct.

Three options were considered: **A** — sherpa-onnx, 1 runtime, 2 models (recommended);
**B** — faster-whisper, 1 runtime, 100% clean licenses but RTF unproven; **C** —
best-of-breed, 2 different runtimes (rejected: violates KISS when A is enough).
The user decided: **benchmark both A and B first, implement nothing in the app yet.**

### 3.5 STT benchmark results (50 utterances/language)

Vietnamese:

| Engine                  | WER %    | RTF (pooled) | p50 s | p95 s | Peak RAM | Load s |
| ----------------------- | -------- | ------------ | ----- | ----- | -------- | ------ |
| **sherpa-zipformer-vi** | **5.38** | **0.017**    | 0.07  | 0.09  | 223 MB   | 0.95   |
| fw-phowhisper-vi        | 7.71     | 0.332        | 1.33  | 1.40  | 972 MB   | 1.35   |

English:

| Engine                  | WER %    | RTF (pooled) | p50 s | p95 s | Peak RAM | Load s |
| ----------------------- | -------- | ------------ | ----- | ----- | -------- | ------ |
| **sherpa-moonshine-en** | 3.86     | **0.040**    | 0.22  | 0.34  | 418 MB   | 1.25   |
| fw-whisper-small-en     | **3.74** | 0.228        | 1.28  | 1.47  | 552 MB   | 0.85   |

Decision matrix (thresholds: RTF ≤ 0.3 · p95 ≤ 2 s):

| Engine              | Lang | RTF      | p95  | License                         |
| ------------------- | ---- | -------- | ---- | ------------------------------- |
| sherpa-moonshine-en | en   | PASS     | PASS | MIT                             |
| fw-whisper-small-en | en   | PASS     | PASS | MIT                             |
| sherpa-zipformer-vi | vi   | PASS     | PASS | CC-BY-NC-ND-4.0 (academic only) |
| fw-phowhisper-vi    | vi   | **FAIL** | PASS | BSD-3-Clause                    |

Variance between the 2 runs (pooled RTF): zipformer-vi 5.0% · moonshine-en 0.6% ·
whisper-small-en 0.0% · phowhisper-vi 0.4%.

Decode parameters (for reproducibility): all `num_threads: 8`, `greedy_search`, INT8.
Zipformer = `hynt/Zipformer-30M-RNNT-6000h` (encoder/decoder/joiner
epoch-20-avg-10 int8). Moonshine = `sherpa-onnx-moonshine-base-en-int8`.
PhoWhisper = `diepho/PhoWhisper-small-ct2` (`beam_size: 1`). Whisper =
`Systran/faster-whisper-small.en`.

**Decision:** Stack A wins decisively. Vietnamese: Zipformer beats PhoWhisper **on both
axes** — WER 5.38% vs 7.71% **and** RTF 0.017 vs 0.332 (~20× faster, 1/4 the RAM).
PhoWhisper-small INT8 **fails** the RTF threshold on this machine. English: Moonshine
matches whisper small.en on WER (0.12 points apart, within noise) but is **5.7×
faster**; Moonshine was chosen for the headroom and to share one runtime with the vi
slot.

The cloud baseline (ElevenLabs Scribe v2) was skipped this time because the benchmark
shell had no API key — this does not affect the decision (the thresholds are absolute).
The cloud↔local comparison was measured later, in phase 2 (section 4.4).

### 3.6 English TTS benchmark results (30 sentences, 5–20 words)

| Engine               | mean s | p50 s | p95 s    | RTF   | avg audio | Peak RAM | Load s |
| -------------------- | ------ | ----- | -------- | ----- | --------- | -------- | ------ |
| sherpa-piper-en      | 0.45   | 0.45  | **0.57** | 0.154 | 2.9 s     | 323 MB   | 1.61   |
| **sherpa-kokoro-en** | 0.97   | 0.99  | 1.18     | 0.323 | 3.0 s     | 619 MB   | 1.07   |

Variance: kokoro 1.1% · piper 0.5%. Both PASS the p95 ≤ 2 s threshold.
Kokoro = `kokoro-en-v0_19` (sid 0, speed 1.0, 8 threads), Apache-2.0.
Piper = `vits-piper-en_US-lessac-high`, MIT.

**Subjective A/B verdict (user, 18/07):** listened to 4 WAV pairs (s001/s003/s015/s027)
and chose **Kokoro-82M** — the quality gap is worth the extra latency. This is a
single-listener verdict; a multi-listener mini-MOS is the way to make it more rigorous
for the thesis.

**Decision:** Kokoro-82M is the English TTS model. Apache-2.0 (clean even for commercial
use). Piper is recorded as the **latency-first fallback** (p95 0.57 s, MIT) should
latency later matter more than quality.

### 3.7 Methodological findings (valuable for the experiments chapter)

**Published numbers were off in both directions, on the same day:**

- PhoWhisper-small was estimated to meet the RTF threshold; **measured, it fails**
  (0.332 > 0.3).
- Zipformer measured **0.017**, faster even than the cited 0.025.
- Kokoro measured on the 8-core machine was **much faster** than the published figure
  (measured on 4 EPYC cores) — it cleared the 2 s threshold that the initial research
  feared it would miss.

Conclusion: when choosing models to run on CPU, **benchmarking on the actual target
hardware is mandatory**; estimated numbers cannot be used to decide.

### 3.8 Technical incidents resolved

- **Segfault with no traceback on Windows.** The sherpa-onnx wheel does not ship
  `onnxruntime.dll`; Windows loaded the wrong ORT 1.17.1 from System32 (Windows ML) →
  a hard abort from a C-API mismatch, with no Python traceback. Traced with unbuffered
  logging + a DLL sweep; **fix: preload the venv's DLL via ctypes before any
  onnxruntime import**. This mechanism was later ported to both sidecars.
- The Zipformer HF repo lacks `tokens.txt` → generated it from `bpe.model`
  (sentencepiece).
- VIVOS moved its tarball path on HF (root 404) and the original AILAB mirror is dead →
  updated the URL + fallback, local cache, URL pinned in the manifest.

### 3.9 License obligations (must be stated in the thesis + README)

| Model                       | License             | Notes                                                                                                                                                                   |
| --------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zipformer-30M-RNNT (vi STT) | **CC-BY-NC-ND-4.0** | **Academic only**, commercial use prohibited. Replacement path if commercialised: PhoWhisper (BSD-3) through the same `SttProvider` contract, accepting ~1.3 s/sentence |
| Moonshine base (en STT)     | MIT                 | clean                                                                                                                                                                   |
| Kokoro-82M (en TTS)         | Apache-2.0          | clean                                                                                                                                                                   |
| Piper lessac-high           | MIT                 | fallback                                                                                                                                                                |
| VIVOS (test set)            | CC BY-NC-SA 4.0     | measurement only                                                                                                                                                        |
| LibriSpeech (test set)      | CC BY 4.0           | measurement only                                                                                                                                                        |

### 3.10 Comparing decoders on Vietnamese (28/08)

The Vietnamese engine ships with `greedy_search` decoding and no contextual biasing.
The question open since 18/07: what do beam search and hotword biasing buy? Measured
on the same old 50-utterance VIVOS set, in one session, changing only the decoder —
the model, INT8 and `num_threads: 8` stay fixed.

| Arm                                  | WER %    | CER %    | RTF (pooled) | p50 s | p95 s | Peak RAM |
| ------------------------------------ | -------- | -------- | ------------ | ----- | ----- | -------- |
| `...-vi-greedy` (control)            | 5.38     | 2.90     | **0.0158**   | 0.065 | 0.088 | 211 MB   |
| `...-vi-beam`                        | 5.38     | 2.94     | 0.0207       | 0.079 | 0.117 | 212 MB   |
| `...-vi-beam-hotwords` (**ceiling**) | **4.66** | **2.73** | 0.0211       | 0.084 | 0.117 | 211 MB   |

**Beam search buys nothing.** WER stays at exactly 5.38; CER gets **worse** by 0.04
points; the price is 1.31× the RTF. Beam changes 3/50 utterances: 1 gets better, 1
gets worse, 1 trades one error for another — exactly the shape of a null result, not
a small improvement.

**Hotwords buy 0.72 points of WER — but that is not the number you will see in real
use.** Measured against the beam arm alone (decoder held fixed): 3 utterances change,
**3 get better, 0 get worse**, and every improvement traces back to a phrase in the
list. That 48-phrase list **was generated from the test set's own reference
sentences** — it encodes knowledge that a live conversation does not have.

But it is **not a ceiling** either, and this arm cannot measure the ceiling: 81
phrases qualify, and the cap of 48 keeps the first 48 **in file order**. Measured: 24/50
utterances actually have a phrase in the list, 16/50 would be biased if the cap were
removed, and 10/50 do not qualify with or without the cap. So **16 utterances sit inside
the "ceiling" arm as unbiased controls**. The −0.72 points is therefore a **lower
bound** on what an oracle list can buy, not an upper bound. It may only be cited with
exactly this label: "the most that **this 48-phrase list** buys".

The cap of 48 is still the right choice for a **shippable** list — it matches
`MAX_HOTWORDS = 48` in the MT-side context block, so one vocabulary list can feed
both ends. Measuring the true ceiling needs all 81 phrases, and that is a separate run.

All three arms are still about **14×** under the RTF threshold of 0.3. Cost was never
a reason to stay on greedy — and it is not a reason to leave it now either. **No
default changes**: `services/local-stt/engines/zipformer_vi.py` stays greedy. The
decision to stay on greedy now has numbers behind it instead of being a default nobody
had questioned.

The control arm reproduces r1's **aggregate numbers** (WER 5.38 · CER 2.90) but does
**not** reproduce r1 per utterance: 2/50 hypotheses differ, in opposite directions,
so the corpus WER lands on exactly the same number. Same `decode_params`, but r1
recorded 0.952 s load / 223.3 MB versus 0.531 s / 211.4 MB this time, and r1 and r2
are identical on all 50 utterances — so this is **drift between two measurement
sessions, not run-to-run nondeterminism**, and the 2 changed utterances are the same
order as the 3 that the beam arm changes. RTF drifted too: 0.0158 versus 0.0169
(6.9%, against the 5.0% recorded between r1 and r2). Both are exactly why the arms are
compared against a **same-session** control rather than against r1. r1/r2 and the
shipped engine id are not overwritten.

This section was measured on 28/08 and sits in the phase-1 benchmark chapter because
it uses the same test set and answers the same model-choice question, not because of
the date.

Sample size: 50 utterances / 558 reference words. 0.72 WER points = **4 words**. The
direction is clean (3/3 improvements, 0 regressions), but the magnitude is imprecise —
this set is too small to tell −0.7 from −0.4.

The per-utterance diff record was removed from the repo along with the `plans/` tree.
It can be re-run: `benchmarks/stt/` — `uv run python run_benchmark.py --decoder-arms`.

### 3.11 Real voice: the capture path decides, not the model (28/08)

Same sentence, same speaker, same model and same shipped configuration — only the
recording path differs.

| Recording | Capture path          | WER (spoken ref) % | CER % | WER (written ref) % | digits | punctuation | proper-noun caps |
| --------- | --------------------- | ------------------ | ----- | ------------------- | ------ | ----------- | ---------------- |
| `take-a`  | messaging app (Opus)  | 14.9               | 9.0   | 31.7                | 0      | 0           | 0                |
| `take-b`  | messaging app (Opus)  | 17.0               | 11.9  | 39.0                | 0      | 0           | 0                |
| `take-c`  | iPhone voice recorder | **4.3**            | 2.4   | 26.8                | 0      | 0           | 0                |

Three conclusions, and all three belong in the experiments chapter:

**1. The capture path is worth ~4× the model's own error.** 17.0% versus 4.3% on the
same sentence, with the model unchanged. No lever in the decoder budget buys that 12.7
point gap — §3.10 measured the best available lever at **0.72 points, and only with a
hotword list that knows the answer in advance**. `take-c` at 4.3% is **even lower than
the 5.38% VIVOS headline number**, on a real, never-seen voice with proper nouns. The
model is not the bottleneck.

**2. Errors land where the signal is poor, not where the vocabulary is hard.** `Hồ Chí
Minh`, `Ba Đình`, `Cộng hòa xã hội chủ nghĩa Việt Nam` are correct in all three takes.
What gets lost is unstressed function words and the verb `đọc` (read) (`đọc Tuyên
ngôn` → `lập thành` / `độc quy mô`). This is exactly the kind of error hotwords help
least with, because the lost words are common words that no biasing list contains.

**3. Digit form alone costs 9 word errors in one sentence.** `take-c` gets 2 words
wrong against the spoken ref and 11 against the written ref; all 9 extra errors are the
date: `2 9 1945` (3 tokens) versus `mùng hai tháng chín năm một chín bốn lăm` (9
tokens). Scoring the spoken ref **verbatim** against the written ref — that is, a
recognizer that makes no mistakes at all — separates the digit cost from `take-c`'s
own 2 errors:

| hypothesis, scored against written ref | S   | D   | I   | total | WER       |
| -------------------------------------- | --- | --- | --- | ----- | --------- |
| `take-c` (4.3% against spoken ref)     | 5   | 0   | 6   | 11    | **26.8%** |
| perfect recognizer (spoken ref)        | 3   | 0   | 6   | 9     | **22.0%** |

In other words: **a recognizer at 4.3% WER on the spoken ref still scores 26.8% on
written Vietnamese, and a perfect one still scores 22.0%** — those 22 points are the
date and nothing else.

Digits, punctuation and proper-noun capitalization are all **0 in all three takes**,
regardless of audio quality. A display error is not an audio error; a better
microphone cannot fix it. This is why a separate ruler is needed
(`benchmarks/stt/stt_bench/display_fidelity.py`) rather than trusting the WER table.

Sample size: 1 sentence, 3 takes, 1 speaker. 47 words, so **1 wrong word ≈ 2.1 WER
points**. The direction is clean; the magnitude is not. And the two capture paths
differ in several variables at once (codec, bitrate, the app's own processing) —
enough to rank levers, not enough to identify which knob.

**Unanswered:** is the browser's capture path — the one that actually ships — closer to
the iPhone take or to the messaging-app takes? None of the recordings here went through
a browser.

The detailed record was removed from the repo along with the `plans/` tree. The audio
is personal data and is not committed, so this measurement cannot be independently
reproduced — the numbers above are all that remains of it.

### 3.12 Display baseline: perfect recognition, zero display (28/08)

A dedicated set for what WER cannot see. 22 Vietnamese utterances in the user's voice,
recorded through **the same browser capture path** the product uses (same AGC / noise
suppression / microphone distance), with references written in real orthography.
115.2 seconds, 311 words.

Scored against the **shipped** output (Zipformer INT8, greedy, `postprocess()` verbatim):

| Metric               | Baseline   | Denominator                |
| -------------------- | ---------- | -------------------------- |
| digit recall         | **0.0000** | 0 / 42 digits              |
| hallucinated digits  | **0**      | —                          |
| punctuation F1       | **0.0000** | ref 39 marks, hypothesis 0 |
| proper-noun caps     | **0.0000** | 0 / 22 recognized          |
| proper-noun coverage | 0.8800     | 22 / 25 declared           |

Not a single digit, punctuation mark or capital letter survives to the screen. The
zeros here are **structural**, not near a threshold — there is no fractional score to
erode.

**The most valuable result came from a very cheap split.** Splitting the set by
whether the reference contains digits separates the display cost from recognition
errors, without having to hand-write spoken-form references:

| Subset         | Utterances | WER against written reference |
| -------------- | ---------- | ----------------------------- |
| with digits    | 20         | 54.84%                        |
| without digits | 2          | **0.00%**                     |

The two digit-free utterances are recognized **word for word** — and still score **0
on all three display metrics**: `hà nội`, `đà nẵng`, `trường sa`, `hoàng sa`, `việt
nam` are all lowercase, with no commas and no final period.

That is the whole chapter's argument in two sentences: **perfect recognition, zero
display.** The two properties are orthogonal, so no work on the recognizer — decoder,
model swap, or a better microphone — can move this number.

So the 50.75% corpus WER is almost entirely **digit form**, not errors. Citing it
requires the split above; on its own it reads like a broken recognizer, when the
recognizer is not broken.

Limitations that must be stated alongside: 1 speaker, 22 utterances — give the sample
size next to every number. The recording page does display `track.getSettings()` but
**does not write it to the manifest**, so it can no longer be proven whether the
browser actually enabled all three constraints; what the data does prove is that the
audio is good (two utterances at 0.00% WER).

Reproduce: `benchmarks/stt/` — `uv run python scripts/run_display_baseline.py`.
The audio is personal data and is **not committed**, so the numbers cannot be
independently reproduced.

### 3.13 Display repair: the three zeros moved, and the price of measuring (28/08)

Each finished turn fires **one** separate request on `gemma-4-31b-it`, entirely off the
audio path. It rewrites the **source sentence** in that same language — punctuation,
capitalization, digits — **without changing a single word**, and is rejected outright
if it does.

| Metric              | Baseline | After repair | Threshold |
| ------------------- | -------- | ------------ | --------- |
| digit recall        | 0.0000   | **0.8810**   | ≥0.85     |
| punctuation F1      | 0.0000   | **0.7222**   | ≥0.70     |
| proper-noun caps    | 0.0000   | **0.8636**   | ≥0.80     |
| hallucinated digits | 0        | **0**        | —         |

Scored on what **the reader actually sees**: 2/22 repairs were rejected by the guard
and fell back to the raw text, so proper-noun caps is 0.8636 rather than the 1.0000 the
model achieved on its own. That is the price of the guard, recorded at its true price.

#### A finding worth carrying into the thesis

The **first** scoring run gave recall 0.6429 with **26 hallucinated digits**. But all 15
misses and 26 extras were **formatting conventions**, not invented numbers:

| reference  | first repair                   |
| ---------- | ------------------------------ |
| `17:00`    | `17 giờ`                       |
| `6:45`     | `6 giờ 45 phút`                |
| `2/9/1945` | `ngày mùng 2 tháng 9 năm 1945` |

All of them are correct written Vietnamese. **Not a single number was invented.** The
prompt said "write numbers as you would when writing" without saying which of several
valid conventions this product uses — so the model picked a different convention, and
the ruler counted it wrong twice: once as a miss, once as an extra. It is exactly the
trap the benchmark `README` warned about, and here it was the entire signal.

Stating the convention in the prompt: recall **0.64 → 0.88**, hallucinated digits
**26 → 0**.

**A convention only one side knows is not a convention.**

#### The guard that misread (`repair-divergence.ts`)

The threshold is **0**, and that is a measurement, not a stance: all 22 repairs have a
residual of exactly 0.0000 after exempting the word-to-digit conversion, so there is no
tolerance to buy. Three silent bugs had to be fixed before it worked correctly:

1. `[^\W\d_]` in JavaScript **matches ASCII only** (unlike Python). It drops every
   accented letter, splitting `tôi` into `t` + `i` — which makes `má` and `mà`
   **equal**, i.e. blind to exactly the kind of error the guard exists to catch.
2. `không` is both "the number 0" and the most common negation word. With a flat list,
   `không phải` (is not) → `0 phải` — exactly the hallucination case the README uses
   as its example — scores a clean **0.0000**.
3. The patch for (2) then rejected 3 valid repairs. Fixed further by letting a phrase
   be "vouched for" by an adjacent number word.
4. **That vouching itself reopened hole (2)** — found by code review. The vouching words
   allowed were "filler" words, so `tôi không đồng ý` (I don't agree) → `Tôi 0 đồng
ý.` was accepted at a residual of **exactly 0**: the negation becomes a digit and
   appears on screen as the speaker's words, reversing the meaning.

   **My tests stayed green the whole time.** I had written exactly one `không` case,
   and that case happened to pick a neighbouring word (`phải`) outside the dictionary —
   it passed by luck, not by rule. It now runs `it.each` over four different
   neighbouring words, because the neighbouring word is what decides.

5. **The patch for (4) was still not enough** — I found this myself by writing 27
   attack cases and _running_ them, instead of reasoning. Two ordinary Vietnamese
   sentences still got through at residual 0: `hai mươi không đủ` (twenty is not
   enough) → `20 0 đủ.` and `lúc mười giờ không phải mười
một giờ` (at ten o'clock, not eleven) → `Lúc 10:00 0 phải 11:00.` Here `không` is not
   vouched for by a neighbour — it gets _absorbed into_ a phrase that already has a
   counting word (`mươi`) and rides along.

   The rule that actually discriminates is **the word AFTER**: a spoken zero only ever
   leads a longer number (`không phẩy bốn`, `không tám tám ba`), so another number
   follows it; a negation is followed by what it negates (`đủ`, `phải`, `đúng`) or by
   nothing.

6. **And a third hole kills every context-based rule** — found by review. `nó
không trăm phần trăm đúng` (it is not a hundred percent right) → `Nó 0 100 phần trăm
đúng.` The thing _being negated_ is itself a number, so `không` sits right next to
   a numeral the repair is rewriting. Lexically, `không trăm` ("not a hundred") and a
   zero leading a numeral are **identical**. No context rule can separate them — and I
   had written two such rules.

   What does separate them is **SHAPE**: a spoken zero is always _absorbed into_ its
   numeral (`không phẩy bốn` → `0,4`) and never stands alone; a digitized negation
   always stands alone, because there is no number for it to join. One line, replacing
   both earlier rules (deleted outright, not layered on top), and it carries over to
   English.

Lesson: **one test case for a context-dependent rule is not a test of that rule** — it
is a test of one context. And **three fixes for one class of bug, each defeated by the
next case**: twice I _reasoned_ about the patch instead of _attacking_ it, and both
times the reasoning was right and the code was wrong.

Mutation test: 12 mutants, all 12 killed.

#### Three plan assumptions refuted by measurement

| The plan said                    | Measured                                          |
| -------------------------------- | ------------------------------------------------- |
| ~6.9s, "a few seconds later"     | median **25.1s**, max **92.6s**                   |
| no concurrency cap needed        | one is needed — a repair outlives its turn ~25×   |
| version coupling must be decided | `embedSpeaker` already solved it in the same file |

The latency number affects the thesis wording: "the display is polished N ms after the
turn, at no cost to the first audio" is still true, but N is **tens of seconds**, so it
improves re-reading, not live listening.

#### Limitations that must be stated alongside

- **Partly in-sample.** The prompt was revised **twice** based on these same 22
  utterances. These are fitted-to-the-dataset numbers, not held-out numbers — a
  citation must say so.
- WER against the **written** reference drops 50.75% → 12.54%. That drop is **a
  consequence of the written reference**, not evidence that recognition improved;
  against the **spoken** reference the same repair pushes WER the other way — which is
  exactly why display has to be measured separately.

Reproduce: `benchmarks/stt/` — `dump_display_hypotheses.py` → `repair_display_hypotheses.mjs`
→ `score_display_repair.py`. The audio is personal data and is **not committed**.

---

### 3.14 Taking the model off the display path: deterministic in-process ITN (29/08)

§3.13 measured a repair that **worked correctly** but was rejected, and the reason was
not accuracy but **timing**: over 22 utterances, median **25.1 s**, max **92.6 s**, and
**minimum 10.0 s** — not once did it arrive within 10 seconds. The reader had long
since moved past that line. The question originally asked was _"Isn't there a way to
display the text correctly straight away, without needing a repair?"_, and the answer
turned out to be: **never from the recognizer, but yes for the display — and without
any model at all.**

Digits are produced **deterministically, in-process, before the line is drawn**. No
network, no API key, no second event.

| Metric              | Baseline | LLM (§3.13)         | **ITN**            |
| ------------------- | -------- | ------------------- | ------------------ |
| digit recall        | 0.0000   | 0.8810              | **1.0000** (42/42) |
| hallucinated digits | 0        | 0                   | **0**              |
| punctuation F1      | 0.0000   | 0.7222              | **0.0000**         |
| proper-noun caps    | 0.0000   | 0.8636              | **0.0000**         |
| latency per turn    | —        | 25.1 s (max 92.6 s) | **0.21 ms** p95    |

**Two metrics got worse, and they are in the table because they really did get
worse.** Punctuation and proper-noun caps drop back to 0: `Phạm Văn Bạch` displays as
`phạm văn bạch`. ITN only typesets digits and touches nothing else. That was a price
accepted before the work began, not an oversight discovered afterwards.

**Three tiers of evidence, not to be merged** — writing "verified on held-out data"
overstates the weakest tier:

| tier                                          | what it proves             | limit                                                               |
| --------------------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| in-sample (22 utterances)                     | achieved recall            | one voice; the ITN was written while reading this very set          |
| negative held-out (50 VIVOS + 50 LibriSpeech) | **no hallucinated digits** | both references have 0 digits ⇒ recall cannot be scored             |
| round-trip held-out (59 vi + 26 en, text)     | recall on unseen data      | **contains no recognition errors** — measures grammar, not pipeline |

Held-out recall: **vi 1.0000 (59/59), en 1.0000 (23/23), 0 hallucinated digits.**

Nine of those sentences deliberately carry no digits. A line whose reference has 0
digits cannot score recall and can only fail — exactly what is needed to guard a
reading that was once wrong: `mười năm` (ten years) as 15, `open twenty four seven` as
2047, `no one came` as `no 1 came`, `a hundred and twenty` as `a hundred and 20`, `năm
hai` as 52.

**English has no in-sample numbers at all.** No English display reference set exists,
and the 50 held-out moonshine utterances contain 0 digits — they can score
hallucination but not recall. English recall rests only on the text round-trip set.
This is the weakest point of this whole section; a citation must say so plainly.

VIVOS WER is **unchanged: 5.38%** (CER 2.90%), re-run after the change. It has to be —
ITN never touches `sourceText`, the only thing WER reads.

#### Three tiers of measurement catch three different kinds of bug

This is the argument for building all three, not just one:

- **In-sample** catches grammar bugs: `tháng chín năm một chín bốn năm` was read as
  month 951945, and a lone `mười` could not be parsed, so every `mười giờ` (ten
  o'clock) lost its clock.
- **Negative held-out** catches **4 invented-number bugs**, none of them reachable from
  the 22 in-sample utterances: `MƯỜI MỘT MƯỜI HAI MƯỜI BA` → `43` (three numbers merged
  into a fourth number nobody said), `PHÒNG BA LE HAI` → `PHÒNG 3 LE 2` (a proper name),
  `CHỊ HAI` → `CHỊ 2` (a birth-order form of address), `HAI CHA CON` → `2 CHA CON` (an
  idiom).
- **Round-trip held-out** catches **4 more bugs** that the other two tiers cannot see:
  `850.000 đồng một đêm` → `đồng 1 đêm` (the unit of the PRECEDING number vouched for
  the FOLLOWING one), `hai nghìn không trăm hai mươi sáu` → a truncated `2000` (twice:
  in a year and in a date), and `nineteen ninety eight` never came out as 1998.

Every fix rule can be stated as a fact about the language, not as a line of data:
`mười` takes no multiplier (`hai mười` is not Vietnamese); a lone number needs evidence
beside it, and an **ambiguous** number needs a real classifier rather than a location
noun (`phòng`, `tầng`) — because Vietnamese names rooms and people by birth order;
evidence is read from the **right**, because the classifier follows the number;
`không` is only part of a number when a place-value word follows it (`không trăm` is
the empty hundreds place of every year 2001–2099, while `không đủ` is a negation).

#### The most expensive thing is not recall

`không` is both **the number 0** and the most common **negation**. Digitizing it does
not make a sentence wrong — it **reverses** the sentence, on screen, in the speaker's
own words, with nothing to flag it. So the whole design runs on one rule:

> **A candidate span produces exactly one number, or nothing. Never a
> fragment.**

Ambiguity turns into **lost recall**, never into a wrong digit. The earlier prototype
produced `2.000 500` for `hai nghìn năm trăm` (two thousand five hundred) precisely
because it printed the part it understood when the rest did not fit.

#### Side effects

- **`gemma-4-31b-it` leaves the system entirely** — every model list, prompt,
  benchmark and doc. The conversation path never had it; it only survived to serve the
  display-repair request. `POST /translate` now has only the two flash models and
  **fails explicitly** when quota runs out, instead of answering slowly with a 6.9 s
  model while the numbers table assumes 553 ms.
- **An attack surface removed, not coverage reduced.** 9 "rewrite in the same
  language" prompt-injection cases were deleted because that surface no longer exists:
  there is no prompt left on the display path. An injected answer in a _translation_
  shows up because it is in the wrong language; in a _repair_ it does not — it is a
  fluent sentence, in the right language, sitting exactly where the speaker's words go.
  Putting a model back on that path means putting the 9 cases back.
- **The display measurement runs in CI for the first time.** The old step 2 spent real
  quota, so it could never run automatically; the new step 2 costs 0.21 ms and needs
  no key, so the held-out gates now run on every push.

Reproduce: `benchmarks/stt/` — `dump_display_hypotheses.py` →
`node scripts/itn_display_hypotheses.mjs` →
`score_display_repair.py --input data/display-itn.jsonl --field itn --no-guard`;
held-out gates: `itn_holdout_check.mjs`, `itn_roundtrip_recall.mjs`. No API
key needed. The audio is personal data and is **not committed**; the two held-out sets
**are committed**.

### 3.15 Fixing content loss on the turn path: diagnosis from prod measurements (12–13/09)

**Symptom.** On the prod deployment (`ssh.quanganh208.dev`), a single user in a
single tab reported STT as "far too slow, losing words and content badly" while CPU
and RAM were almost idle.

**Diagnosis — every number measured read-only on prod.** Single-turn STT is not slow:
a 6–8 s clip decodes in 70–200 ms (RTF ≈ 0.012–0.025). What is slow is the **causal
chain of a single user's turns**, not the lock:

1. Gemini had no timeout at all (p50 723 ms, **max 8943 ms** measured in the repo).
2. A slow turn holds its slot; `MAX_IN_FLIGHT = 3` fills up; the server rejects with `too_many_turns`.
3. The client retries 4 × 750 ms and then **throws away the whole pending buffer** — one
   `console.warn`, nothing on screen.
4. Up to 4 uncancellable speculations per turn, each a full-turn decode plus a
   Gemini request charged against the quota — both pushing the queue and burning
   quota, which makes step 1 worse.

Alongside that, the sidecar **serialised every decode behind one `threading.Lock` per
engine** — 6 concurrent requests took exactly the wall time of 6 sequential turns (a 6×
FIFO staircase), with the machine 72% idle and CPU peaking at 447% on one core. This is
the ceiling for multiple users, not the cause of a single user's symptom. The Cloudflare
tunnel was cleared: steady state on a reused connection is 55–64 ms; the initial
207/978 ms figures were the per-connection TLS/QUIC handshake.

**What shipped (PR #132, 5 commits).**

- **A deadline on every outbound call**: 6 provider fetches go through `fetchWithDeadline`
  (STT/embed/voices 5 s, TTS 15 s, ElevenLabs 30 s) + Gemini
  `httpOptions.timeout` 20 s. A stuck dependency fails one turn instead of pinning 1/6
  of the global slots.
- **Honest accounting on the client**: `sentMs`/`sequence` only advance when a frame
  actually leaves the socket; rejected frames are kept and resent in order; orphaned audio
  has a counter + log; turns dropped at the pending ceiling show an "unheard" marker.
- **Lane semaphore for the sidecar**: lock → `Semaphore(4)` over **one** single
  recognizer. An experiment with 120 concurrent decodes through one recognizer produced
  **byte-identical** transcripts on both engines — a pool of recognizer copies (223/418 MB
  each) is not needed, and the OOM risk disappears. Saturation returns 503 after a 2 s
  wait, with no invisible queueing.
- **Partial cadence stretched by decode cost**: `max(300 ms, 3 × lastDecodeMs)`
  — a conclusion the repo had measured itself earlier but never implemented.

**Two assumptions refuted by measurement.** Capping speculation at 1-in-flight broke 4
specs — blocking renewal killed exactly the reusable guess (measured 870 ms head start);
reverted. Raising `LOCAL_STT_THREADS` 4→8: ~25% slower, burning 3× the CPU (1325%) —
ONNX intra-op oversubscription; a 1/2/3/4/8 sweep confirmed 4 is optimal, reverted.

**Before / after — same conditions** (en→vi, one person / one tab, output muted,
real session on prod; baseline 29 turns 13/09 09:35, after the fix 104 turns 13/09
10:06, same `TURN_METRICS_PATH` sink):

| Metric                                         | Before             | After                               | Target   |
| ---------------------------------------------- | ------------------ | ----------------------------------- | -------- |
| End of speech → first translated text, **p50** | 1180 ms            | **953 ms**                          | —        |
| **p95**                                        | 4264 ms            | **1448 ms** ✅                      | ≤3500 ms |
| max                                            | 4702 ms            | **3969 ms**                         | —        |
| `rejected` + `dropped` turns                   | 0 + 0              | **0 + 0** ✅                        | 0        |
| `heldMs`                                       | 0                  | **0** ✅                            | ≤2%      |
| Turns cut at the ceiling                       | 48% (14/29)        | **21%** (22/104)                    | —        |
| 6-deep sidecar probe, peak CPU                 | 1.03× serial, 447% | 0.66–0.90× serial, **940–1513%** ✅ | ≥550%    |

Notes on reading the table: (1) the 6-deep probe ratio has not reached the ≤0.60× target —
a single ONNX session has a pool of 4 intra-op threads, and 4 concurrent decodes share
exactly that pool; a threads 1/2 sweep gave a 0.61–0.70× ratio but worse absolute wall
time, so we **keep threads=4**: under the real load (one person, ≤2 overlapping decodes)
the gain is real, and the wall at the 5th+ decode is intra-op pool contention, not the
lock. (2) The 5 `error` turns after the fix were all "No speech detected" (gate opened by
noise, ~500 ms captured) — benign, the same kind as the baseline's 2 error turns. (3) The
capture ratio cannot be computed because there is no session recording to serve as the
denominator; every measurable loss channel = 0. (4) Per-model rate after the fix was
22.6 / 33.5 req/min versus 21.7 / 28.8 before — Gemini demand was **not silently cut**,
which is the desired direction.

Operations note: CD does not pass the `-f` override, so the turn-metrics bind mount has
to be re-attached by hand after every deploy (`~/.config/chatofy/turn-metrics.override.yml`
from the runner checkout `~/actions-runner/_work/chatofy/chatofy`).

To reproduce: `benchmarks/realtime/analyze-continuous.mjs` on the two files
`~/chatofy-metrics/turn-metrics-prefix-baseline-20260913.jsonl` and
`turn-metrics.jsonl` on prod; concurrency probe:
`python3 /tmp/stt-concurrency-probe.py clip.wav en 6 3` on prod (the script reads the
cgroup v2 `cpu.stat` to sample CPU during the burst).

---

## 4. Phase 2 — Integrating local speech into the pipeline (23–24/07)

### 4.1 Work contract

**Outcome:** with `AI_STT_PROVIDER=local` + `AI_TTS_PROVIDER=local` (the new
default), `POST /translate` runs both directions without calling ElevenLabs and without
needing `ELEVENLABS_API_KEY`.

**Non-goals (stated explicitly to prevent scope creep):** local machine translation ·
streaming STT · mobile recording · a local/cloud toggle in the UI · **removing the
ElevenLabs provider** (kept for the cloud↔local comparison in the thesis) · merging
VieNeu into the new sidecar.

### 4.2 Settled design decisions

Settled by the user: **2 fully separate sidecars** (`local-stt` :8002, `local-tts` :8003) ·
audio decoded **server-side with PyAV** (the client does not change a line) · provider
chosen **only via env**, with the default in `env.schema.ts` changed to `local`.

Settled autonomously (delegated by the user), 9 decisions with rationale:

| #   | Decision                                                                                              | Rationale                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| D1  | Load models **eagerly** at startup; `/healthz` returns 503 `loading` until ready                      | 1.3 GB / 32 GB is negligible; avoids a latency cliff on the first request                                 |
| D2  | Sidecars accept only `vi`/`en`, everything else gets 400                                              | `languageCodeSchema` already locks this at the contract layer — this is defence in depth                  |
| D3  | Measure end-to-end latency **once** at acceptance, without building a new harness                     | The benchmark harness is measurement-only and is not pulled into the runtime                              |
| D4  | `LOCAL_*_THREADS` defaults to **8**; set `OMP_NUM_THREADS`/`MKL_NUM_THREADS` before importing engines | 8 physical cores beat 16 hyperthreads (earlier spike); the pipeline is sequential so no core contention   |
| D5  | `POST /transcribe` multipart · `POST /synthesize` JSON → `audio/wav`                                  | Multipart makes the new provider almost a copy of the ElevenLabs provider — consistent call sites         |
| D6  | `audio/decode.py` resamples **explicitly** to 16 kHz mono float32                                     | The web mic is 48 kHz and the models were trained at 16 kHz — implicit resampling must not decide quality |
| D7  | Each sidecar has its own `models/` + `scripts/download_models.py`                                     | Keeps the harness↔app boundary                                                                            |
| D8  | `LOCAL_TTS_VOICE_ID` defaults to 0; an invalid voice → **fall back to default**, not an error         | The API is public, so it must tolerate unexpected input                                                   |
| D9  | `pnpm dev:all` runs every process                                                                     | The default is now local ⇒ `pnpm dev` is no longer enough                                                 |

Accepted trade-offs: 3 sidecars in dev; ~30 lines of helper code duplicated between the
2 services. **No** shared Python package — YAGNI.

### 4.3 End-to-end results (6 turns/direction, through `POST /translate`, 0 errors)

| Direction | p50         | p95     | min     |
| --------- | ----------- | ------- | ------- |
| vi→en     | **1663 ms** | 1976 ms | 1418 ms |
| en→vi     | **2337 ms** | 2662 ms | 2059 ms |

Breakdown by stage (p50 from the same run):

| Stage                          | vi→en             | en→vi              |
| ------------------------------ | ----------------- | ------------------ |
| STT (local)                    | 53 ms — Zipformer | 186 ms — Moonshine |
| **Translation (cloud Gemini)** | **916 ms**        | **921 ms**         |
| TTS (local)                    | 748 ms — Kokoro   | 1402 ms — VieNeu   |

**The conclusion that steered the rest of the project:** once speech moved local,
**cloud translation became the most time-consuming stage** of a vi→en turn (~55%).
Every further latency optimisation has to target it, not speech.

Benchmark ↔ real run comparison:

| Component    | Benchmark (isolated)   | In the service          |
| ------------ | ---------------------- | ----------------------- |
| Zipformer vi | p95 0.09 s             | ~53 ms p50              |
| Moonshine en | p95 0.34 s             | ~186 ms p50             |
| Kokoro en    | p95 1.18 s · RTF 0.323 | ~748 ms p50 · RTF ≈0.42 |

STT sits within the benchmark range. Kokoro's RTF is ~28% worse inside the service —
as expected, because the benchmark measures the engine in its own subprocess, without
the HTTP layer. It is still comfortably below the p95 ≤ 2 s threshold.

### 4.4 Local ↔ cloud comparison per stage

Measured through **the real provider classes**, 3 runs per side, same audio and same
sentence. Deliberately **not** through `POST /translate`: machine translation is not
changed by this work and the free tier allows only 20 requests/day, so going through it
would measure the wrong thing and die on quota.

| Stage  | Local p50  | Cloud p50 (ElevenLabs) | Conclusion             |
| ------ | ---------- | ---------------------- | ---------------------- |
| STT vi | **84 ms**  | 1117 ms                | local **13.3×** faster |
| STT en | **178 ms** | 1285 ms                | local **7.2×** faster  |
| TTS vi | 1235 ms    | **348 ms**             | cloud 3.5× faster      |
| TTS en | 1126 ms    | **255 ms**             | cloud 4.4× faster      |

Transcript accuracy on the same audio — **the same words on both sides**, cloud adds
punctuation:

```
vi/local  "Xin chào hôm nay trời rất đẹp"
vi/cloud  "Xin chào, hôm nay trời rất đẹp"
en/local  "The weather is beautiful today and I would like to walk in the park."
en/cloud  "The weather is beautiful today, and I would like to walk in the park"
```

**The first draft of this conclusion was wrong and has been reversed.** It compared
**one** cloud turn (5216 ms vi→en) with the local p50 and concluded local was ~3× faster
overall. That n=1 sample carried the cloud client's cold-start cost. The honest picture
is **a trade-off, not a win**: local recognition is much faster at the same word
accuracy, but **local speech synthesis is much slower**. The reasons to choose local are
**cost, privacy, and the ability to run offline** — not raw speed.

(Note when citing: TTS latency scales with output length, so the fixed 13-word sentence
used in this table runs longer than the short translations in the end-to-end table.)

### 4.5 Findings during integration

1. **Vietnamese transcripts came out in ALL CAPS, without punctuation.** Zipformer emits
   `NGỌN LỬA BẠO ĐỘNG…`. The benchmark's WER normalisation **lowercases and strips
   punctuation**, so this defect **never showed up in the numbers** — it only surfaced
   when displayed to the user. Handled with a `postprocess()` hook on `SttEngine`,
   overridden for Vietnamese to apply sentence case. **Proper nouns stay lowercase**
   ("tôi đi hà nội" (I go to Hanoi)); a real fix needs a capitalisation/punctuation
   restoration model.
2. **The "flaky" Gemini errors were actually the daily quota running out.** The provider
   wrapped SDK errors but **never logged `cause`**, so the real reason was hidden. Adding
   a single log line revealed it at once: `RESOURCE_EXHAUSTED`,
   `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, **quotaValue 20**. Not a bug,
   not a network error. Speech still works after it runs out; only `/translate` fails.
3. **No limit on input audio length for STT.** A few MB of Opus ≈ nearly an hour of
   speech, holding the engine lock for the whole decode, with no supervisor restart
   after an OOM. Capped with `LOCAL_STT_MAX_AUDIO_SECONDS` (default 300) → 413.
4. **The STT log line recorded the wrong provider.** `PipelineTranslatorService` logged
   `profile.sttModel` (hard-coded `scribe_v2`), so local transcripts were logged as
   `stt(scribe_v2)`. Left unfixed, **every number in this report would have been
   attributed to the wrong provider**.
5. **An existing `.env` silently kept the cloud path.** Changing the default only affects
   unset variables. The first end-to-end turn still went to ElevenLabs; it was caught
   only because the response returned `audio/mpeg` instead of `audio/wav`.
6. **PyAV works fine on Windows/Python 3.11** — the plan's only unverified assumption.
   `av` 18.0.0 installs from a wheel and decodes 48 kHz stereo webm/opus → 16 kHz mono
   float32 correctly. No ffmpeg subprocess fallback needed.

### 4.6 Code review results (24/07)

Scope: 8 commits, 63 files, +4777/−2075. Conclusion: **no deadlocks, no races, no
shared-state bugs** between the two engines sharing a process; **per-engine locking is
correct** (not nested, no lock held across an await); **PyAV decoding is correct**
(resampling, flush, error ordering; corrupt input neither hangs nor returns 500).

Three confirmed defects, fixed:

1. **The e2e suite no longer compiled** — one spec still imported the deleted
   `VieNeuTtsProvider`. **Invisible to `pnpm typecheck`** because the `apps/api`
   tsconfig excludes `test/` and jest's `rootDir` is `src`. Only `test:e2e`
   compiles it, and a suite that does not compile breaks the whole run.
2. **Switching to ElevenLabs broke en→vi** — the web client sends the Vietnamese preset
   name as `voice`, and the provider interpolated it straight into the request path →
   404 → 503 on every Vietnamese turn. The per-language routing exception that had just
   been removed had been masking this. Fixed with the same rule the local sidecar
   already uses: an unrecognised voice falls back to the default.
3. **No cap on STT input length** (item 4.5.3).

Two side findings: the `translate` e2e has **two assertions that can never pass**
(the fake TTS provider does not declare `outputMimeType`) — pre-existing on `main`;
and **nothing proved the STT sidecar can recognise speech** — the old test fed a
synthetic tone, and for a tone an empty transcript is the correct answer. Added a
round-trip test: synthesise a sentence → recognise it again → assert the words
survive, in both languages.

### 4.7 Debt carried forward from this phase

- **Local TTS is now the slowest stage** (1.1–1.2 s vs 0.25–0.35 s for ElevenLabs).
  Piper is the latency-first option measured for English; **nothing equivalent has been
  benchmarked for Vietnamese yet**.
- Restoring Vietnamese capitalisation/punctuation — needs a model or a change to the
  Gemini contract.
- `GeminiTranslationProvider` classifies 429 as a **transport** error when it is a
  **response** error.
- **No provider has a request timeout** — a hung sidecar will hang the whole turn up to
  undici's default ~300 s.
- **ONNX thread oversubscription under multiple users**: per-engine locking deliberately
  lets vi and en run concurrently ⇒ 2×8 threads on 8 cores. Every number in this document
  is **single-concurrency**; multi-user behaviour has not been measured.

---

## 5. Phase 3 — Choosing the Gemini model by quota (24/07)

**Before:** each quality level mapped hard to one model. Because the free tier counts
quota **per model**, one model running out of quota killed the whole demo session.

**After:** the provider takes an **ordered list of models**, only falls through to the
next model when rejected for quota, and returns **the name of the model that actually
answered** so the pipeline can log it. At the same time, the "speed/quality knob", which
had already stopped having any real effect, was removed.

Actual limits on the account (from the dashboard, 25/07):

| Model                 | RPM | TPM  | RPD                |
| --------------------- | --- | ---- | ------------------ |
| Gemini 2.5 Flash      | 5   | 250K | **20 — exhausted** |
| Gemini 3.5 Flash Lite | 15  | 250K | 500                |
| Gemini 3.1 Flash Lite | 15  | 250K | 500                |
| Gemma 4 31B           | 30  | 16K  | 14,400             |
| Gemma 4 26B           | 30  | 16K  | 14,400             |

Two consequences that matter for the realtime part: **the two flash-lite models together
= 30 turns/minute** before gemma has to be touched; and although gemma has double the
RPM, it takes **6.4 s/sentence**, so it is only a lifeline, not something to use for
conversation.

---

## 6. Phase 4 — Real-time conversation flow (25–26/07)

### 6.1 Initial diagnosis — and the most important reversal of the project

The initial requirement: "realtime like Gemini Live". The analysis produced a
counter-intuitive conclusion:

> **"Choppiness" is a UI feedback problem, not a latency problem.**

The system's audio at that time was p50 ~1.5 s after the end of speech — **faster**
than Gemini Live Translate. Gemini Live feels seamless because **the screen never stands
still**: text keeps flowing the whole time the user is speaking. Chatofy's screen was
**completely dead** for the entire time someone spoke, and then everything poured out at
once. The same physical latency, two completely different feelings.

Consequence: live flowing text is **not the "make it pretty" part** — it is exactly the
thing being sought. And there is a second, more surprising consequence: **live
translated text is also the strongest latency lever left**, because each provisional
translation is a head start, and the last one can be used directly as the official
version when no new audio follows it — which takes the ~550 ms of machine translation
off the critical path entirely.

One limitation was stated plainly from the start: **"hearing the translation while you
are still speaking" on 1 device + an external speaker is physically impossible without
AEC.** No software trick gets around it.

### 6.2 Phase 0 — spikes measured before designing

**(a) sherpa-onnx `OfflineTts` streaming callback: the API exists, but it is useless.**

| Text                   | TTFC    | Total   | Chunks |
| ---------------------- | ------- | ------- | ------ |
| 1 sentence, 25 chars   | 0.469 s | 0.469 s | **1**  |
| 1 sentence, 71 chars   | 1.104 s | 1.104 s | **1**  |
| 2 sentences, 145 chars | 1.034 s | 2.076 s | 2      |

sherpa-onnx **only cuts chunks at sentence boundaries**. A typical conversation turn is
1 sentence ⇒ streaming TTS via the callback saves **0 ms**.

**(b) Clause splitting at the application layer — the real lever.** Split at commas
ourselves, then call `generate()` on each part:

| Sentence (Kokoro, en)                                           | 1 block | Clause split | Reduction |
| --------------------------------------------------------------- | ------- | ------------ | --------- |
| "Hello, how much does this cost?"                               | 0.648 s | **0.340 s**  | −48%      |
| "I would like to book a table for two people at seven tonight." | 0.931 s | **0.689 s**  | −26%      |
| "Excuse me, could you tell me where the train station is?"      | 0.907 s | **0.393 s**  | −57%      |

| Sentence (VieNeu, vi — measured for the first time)                                                | 1 block | Clause split | Reduction |
| -------------------------------------------------------------------------------------------------- | ------- | ------------ | --------- |
| "Xin chào, cái này giá bao nhiêu?" (Hello, how much does this cost?)                               | 0.899 s | **0.373 s**  | −59%      |
| "Tôi muốn đặt một bàn hai người lúc bảy giờ tối nay." (I'd like a table for two at seven tonight.) | 1.061 s | **0.813 s**  | −23%      |
| "Xin lỗi, cho hỏi ga tàu ở đâu ạ?" (Excuse me, where is the train station?)                        | 0.856 s | **0.449 s**  | −48%      |

**Every split was gapless** — the audio of part 1 is always longer than the time to
generate part 2, so playback is continuous without stutter. Total time rises ~20–30%
from per-call overhead, but that does not affect the experience because the user is
already hearing audio from the TTFA mark. VieNeu has considerable variance (sentence 3:
median 0.449 s but one run at 0.873 s) — a larger sample is needed before publishing a
p95.

**(c) Benchmark of the 3 models in the fallback chain** (6 samples/model, real API):

| Model                 | blocking p50 | streaming p50 | chunks p50 |
| --------------------- | ------------ | ------------- | ---------- |
| gemini-3.5-flash-lite | 820 ms       | 553 ms        | 2          |
| gemini-3.1-flash-lite | 612 ms       | 557 ms        | 1          |
| gemma-4-31b-it        | 6354 ms      | 6884 ms       | 1          |

Reading by column: the gap between 3.5 and 3.1 **exists only in the blocking column**; in
the streaming column the two models **tie (553 vs 557 ms)**. So the 208 ms that looked
like "the model's price" is actually **the cost of the blocking call**. ⇒ Use
`generateContentStream` (gains ~270 ms); the order of the two flash models is a decision
about **quality**, not latency. But **chunks p50 = 1** — the whole translation arrives in
one chunk ⇒ **do not build a pipeline that pushes MT phrase by phrase into TTS**; there
are no phrases to push.

**(d) A new risk: the free tier is limited to 15 requests per MINUTE**, not just 500/day.
Measured directly: **429 after exactly 15 requests in 10.7 s**, `retryDelay: 52s`. The
per-minute limit is what actually strangles realtime conversation — 15 turns/minute = 1
turn every 4 seconds.

Along with it, a defect in the code at the time: `isQuotaExhaustedError()` treated
**every** 429 as "daily quota exhausted" and fell through to the next model, **completely
ignoring `retryDelay`** ⇒ it burned through the whole fallback chain in one minute and
returned 503, when waiting 4 seconds would have been enough. The more realtime was used,
the faster it dropped to gemma at 6.9 s — **the system was slowest exactly when speed
mattered most**. Replaced with `quotaCooldownMs()`, which reads `retryDelay`, remembers a
cooldown per model, and **skips calling** a model that is currently blocked.

**(e) Partial transcripts by re-decoding — right for vi, capped for en**
(median of 3 runs, 300 ms cadence budget):

| Buffer          | vi (Zipformer-30M)  | en (Moonshine base) |
| --------------- | ------------------- | ------------------- |
| 0.5 s           | 14 ms               | 15 ms               |
| 1 s             | 22 ms               | 118 ms              |
| 3 s             | 49 ms               | 159 ms              |
| 5 s             | 88 ms               | 236 ms              |
| 8 s             | 114 ms              | 277 ms              |
| 12 s            | 161 ms              | **456 ms — broken** |
| 15 s            | 214 ms              | **582 ms — broken** |
| duty cycle @3 s | **14%** of one core | **40%** of one core |

Moonshine costs ~3× Zipformer and breaks the 300 ms budget from a ~10 s buffer ⇒ the
re-decode cadence has to **stretch with buffer length**, not stay fixed.

**The conclusion above has been superseded — 2026-09-16.** It was right for the design
at the time, and the duty gate (`interval = max(300ms, decode × 2)`) was its
implementation. A real speaking session showed the cost: the text cadence fell from 3.3
to 1.7 updates/second **within a single sentence** when someone spoke at length, because
each partial read re-decodes the whole window, so the cost grows with sentence length,
and then the multiplication doubles it.

Re-measured on **dense** speech — the old table used isolated clips and never reached an
8–9 s buffer:

| Buffer | vi p50 | en p50 | gate ×2 | cadence | gate ×1 | cadence |
| ------ | ------ | ------ | ------- | ------- | ------- | ------- |
| 1 s    | 55 ms  | 102 ms | 300 ms  | 3.33    | 300 ms  | 3.33    |
| 5 s    | 107 ms | 210 ms | 420 ms  | 2.38    | 300 ms  | 3.33    |
| 9 s    | 152 ms | 289 ms | 579 ms  | 1.73    | 300 ms  | 3.33    |

English peaks at **289 ms at a 9 s buffer** — the longest turn the client sends — still
below the 300 ms floor. What caused the gradual slowdown was **the multiplication**, not
the decode cost. `PARTIAL_DUTY_DIVISOR` back to **1**; the cadence is flat at every
sentence length.

The trade-off, stated plainly: at divisor 1 the duty ceiling **disappears** (the interval
is measured from the start, so `d × 1` has already been paid by the time the read
finishes). Lane pressure measured with two people speaking at once + final turns +
continuous TTS: 388 requests, **503 = 0**.

A **sliding window + stitch-by-text-overlap** design was considered and rejected by the
measurement gate before any line of product code was written: Moonshine has a fixed cost
floor so shrinking the window does not help, and stitching was wrong 15% of the time (vi)
/ failed to join 37% (en), because a window that opens mid-word makes the recogniser
return a **different** word rather than a truncated one. The detailed record was removed
from the repo together with the `plans/` tree; the probe that produced these numbers is
still at `benchmarks/stt/scripts/streaming-arms/overlap_probe.py`, with raw results in
`benchmarks/stt/results/r8-overlap/`.

**(f) Latency budget after measurement (vi→en):**

```
t=0      speech ends
t=150ms  VAD suspects end of sentence → STT final (90ms)
t=240ms  fire gemini-3.5-flash-lite (streamed)
t=793ms  Gemini returns the whole translation (553ms, one chunk)
t=1133ms Kokoro's first clause reaches the speaker (340ms)
```

**≈ 1.13 s p50.** Thanks to **VAD overlap + clause splitting + streaming calls**, not a
phrase pipeline or a TTS callback. Removing each lever: drop VAD overlap +350 ms ·
back to blocking +267 ms · drop clause splitting +300…500 ms.

### 6.3 The project's most valuable bug: a speed-up that shipped but never ran

The `speculate()` mechanism — translating the start of a sentence ahead of time at the
silence mark — **had shipped, had green tests, and even had its own entry in the
handoff report claiming "saves 350 ms"**.

The causal chain:

```
speech-gate.ts:119-129   silenceMs accumulates, speaking stays true
capture-pump.ts:110-112  if (state === 'in-turn') onAudio(block)   ← silent blocks are STILL sent
                         state only changes at onSpeechEnd = END of hangover
translation-session.service.ts:197   bufferedBytes += audio.length
translation-session.service.ts:273   atBytes === bufferedBytes      ← never matches
```

The client keeps sending audio throughout the 500 ms hangover ⇒ `bufferedBytes` always
grows after the speculate mark ⇒ the comparison is always false ⇒ **the early
translation is always thrown away**. Nothing "fails": the work is simply redone, and the
latency it was built to save is never saved.

**Why it slipped past every gate.** The two tests that "prove" it **build a sequence of
events that production cannot produce**: they call `speculate()` and then `end()` with
no frame in between; the e2e test sends exactly 1 frame. Typecheck, lint, build, unit,
e2e — all green. This is the **second time** a bug escaped to `main` in exactly this way
(the previous one: the half-duplex flag was set at the start of speech instead of the
end).

**The fix.** The client **holds back** silent blocks instead of sending them; if speech
resumes → flush them intact and in order; if the turn ends → drop them.
`SpeechGate.push()` returns whether the block is speech, so that `CapturePump` does not
re-derive the threshold itself (two copies would drift apart).

**Code review caught a bug in the fix itself:** the first version discarded `held` at
`onSpeechEnd`, so **the tail of a word below the RMS threshold never reached the
recognizer** — voiceless final consonants are 10–20 dB quieter than vowels, and
Vietnamese has unaspirated final /t/, /k/, /p/. `SPEECH_MARGIN` was turned from a knob
for _timing_ into a knob for _recognised content_, and **no test saw it** because they
count callbacks rather than compare transcripts. Fix: flush `held` right before firing
`onProbableEnd`.

### 6.4 The first measurements and two rounds of fixes driven by numbers

After the fix, the project had real end-to-end measurements for the first time (32
fixtures, 3 warm-up turns discarded; i7-11700K, **STT+TTS+API+driver running on the same
machine** = upper bound on CPU contention):

|                                        | p50         | p95     |
| -------------------------------------- | ----------- | ------- |
| Overall, 32 turns                      | **1163 ms** | 2983 ms |
| When speculation was usable (19 turns) | 870 ms      | 2171 ms |
| When speculation was lost (13 turns)   | 1760 ms     | 3727 ms |

Per stage (API logs, n=45): STT p50 **58 ms** (p95 84, max 102) · Gemini translate
p50 **723 ms** (p95 1947, max 8943) · TTS per clause p50 **527 ms** (p95 1125).
⇒ STT is not the bottleneck; **Gemini is the most expensive and most variable stage**,
and it is the reason p95 misses the target — it depends on the network, not the machine.

The usable head-start rate converges around **59%** across 3 independent methods (real
server 19/32 · offline replay 7/12 · prediction). Cost: 45 requests for 35 turns =
**22% overhead** from failed speculation.

**"1.13 s or 1.5 s" — answered.** The 1.13 s figure predicted in Phase 0 was **right**
(measured 1163 ms, off by 3%), but **the system never reached it** until the head-start
bug was fixed. The 1.5 s figure was an estimate for the no-overlap case; the real
measurement for that case is **1760 ms**, so 1.5 s was optimistic.

The next two changes **must go together**:

1. **Re-guess at every pause instead of guessing once.** The reason for one-shot was
   quota, and that reasoning **points the wrong way**: a guess survives only when no
   audio follows it, so a turn with a mid-sentence pause spends its guess at the first
   pause and then **still** has to translate again at the end — 2 requests spent for
   nothing.
2. **Split the model ladder.** Measured after changing only (1): p50 991 ms but **p95
   jumped to 10112 ms** — the extra requests pushed `3.5-flash-lite` past its 15/minute
   cap, the shared ladder fell through to gemma, and 2 turns took 10081 ms and 18537 ms.
   Fix: guesses go `[3.1, 3.5]`, finals go `[3.5, 3.1]`, **both drop gemma** (a 6.9 s
   model is a reasonable fallback for REST, but in a conversation the speaker has
   already walked away). REST keeps the full ladder.

|                     | One-shot, shared ladder | Re-guess, shared ladder | **Re-guess + split ladder** |
| ------------------- | ----------------------- | ----------------------- | --------------------------- |
| p50                 | 1163 ms                 | 991 ms                  | **859 ms**                  |
| p95                 | 2983 ms                 | 10112 ms                | **1849 ms**                 |
| max                 | 3727 ms                 | 19003 ms                | **1911 ms**                 |
| Reuse rate          | 59%                     | 75%                     | **75%**                     |
| Gemma calls         | 0                       | 2 (10 s, 18 s)          | **0**                       |
| Slowest translation | 8943 ms                 | 18537 ms                | **1055 ms**                 |

### 6.5 Live source text and live translated text

Source text: the server re-decodes the growing buffer during the `listening` phase and
emits `server.transcript.partial`. Measured in a real browser, on a 6.9-second sentence:

```
 633ms  Hôm qua
 970ms  Hôm qua tôi
1258ms  Hôm qua tôi có đặt
1861ms  Hôm qua tôi có đặt phòng qua mạng
3150ms  … nhưng chưa nhận được xác nhận
4450ms  … nên tôi muốn kiểm tra
5893ms  … không biết còn phòng không
```

**17 updates** within one turn. After that the turn is finalised as usual, the live line
disappears, and the official translation appears.

Live translated text, same sentence:

```
4049ms  I booked a room online yesterday but have not received a confirmation yet.
        ← English appears while the speaker is STILL talking
6406ms  … so I would like to check if there is still a room available.
        ← official translation
```

**2.4 seconds** earlier than the official translation.

Two deliberate design decisions:

- **Only long turns get a provisional translation** — threshold ≥3 s of speech, spaced
  ≥2.5 s or ≥12 new words apart, at most 3 times per turn. A 2-second sentence already
  has its real translation after ~900 ms; guessing ahead of it spends a metered request
  in exchange for nothing.
- **A guess is never spoken aloud.** The sentence is not finished, so the translation is
  a guess that later speech can overturn — **text can be replaced quietly, speech
  already spoken cannot.**

**Nearly broken a second time by quota — and this time the numbers caught it
immediately.** The first version used `3.1-flash-lite` for provisional translations, the
same model that leads speculation:

|                     | Provisional on `3.1` | Provisional on `3.5` |
| ------------------- | -------------------- | -------------------- |
| p95                 | **2787 ms**          | **1582 ms**          |
| Rate limits         | **7**                | **0**                |
| Slowest translation | **15764 ms**         | 938 ms               |

Total requests rose only 50→56 ⇒ **the problem is not the total but the bunching**:
provisional translations happen _while_ the turn is in progress, at the same time as
speculation, on the same model. Meanwhile `3.5` sits idle — because 75% of turns reuse
speculation, the final path is rarely called. Moving to the idle model was all it took.

### 6.6 A phase dropped, with numbers as witness

The plan called for **a dedicated recognizer for the partial loop**, out of concern that
the per-engine lock would block the main decode path. The shared-engine version was
built first and measured: **422 partial reads over 32 turns, STT p50 still 58 ms**
(baseline: 58 ms), max 136 ms (baseline 102 ms). The final path **did not slow down**.
The problem does not exist ⇒ the whole phase was dropped, avoiding changes to the Python
sidecar and to `SttProvider` (an interface with 2 implementers and 7+ consumers) to
guard against a problem that had never been observed.

### 6.7 Verification in a real browser — a first for the project

Playwright + Chromium, a **production** build (`next start`, no HMR). Exactly one thing
replaced: `navigator.mediaDevices.getUserMedia` returns a `MediaStream` built from a WAV
fixture. Everything below it is real — AudioWorklet, the Web Audio clock, the resampler,
the socket, the UI.

| Turn              | Mid-sentence pause | Speculation | First audio |
| ----------------- | ------------------ | ----------- | ----------- |
| plain-01          | no                 | USED        | 1021 ms     |
| plain-01 (repeat) | no                 | USED        | 873 ms      |
| pause-03          | 2 times            | lost        | 1749 ms     |

The offline harness predicted that `plain-*` would be reused and `pause-03` lost — the
browser gave exactly that; the 873↔1749 ms gap matches the 870↔1760 ms measured through
the driver. **Three independent measurement methods converge.**

After applying re-guess + split ladder, rerunning in the browser: `plain-01`
702 ms · **`pause-03` 949 ms** (previously 1749 ms) — **800 ms** faster, precisely on the
type of turn the old design could never win.

This is also exactly where the 3 Critical bugs of the previous round lived (mic hanging
after 1 block, half-duplex reopening at the wrong time) — now there is evidence they do
not recur.

### 6.8 The final numbers

Full table in section 7. Summary: p50 **907 ms**, p95 **1582 ms**, max 1757 ms,
**0/32 turns above 1800 ms**, 75% reuse, 0 rate limits.

The two interface targets not met (source text 633 ms, UI idle 753 ms) miss by
133–253 ms, and most of the 753 ms gap is because **the recognizer has not heard any new
words yet**, not because the system is stalled — partials still arrive steadily every
300 ms. Lowering the cadence to 200 ms would cost CPU without fixing the cause.

---

## 7. Before / after summary table (for the results chapter)

Measurement conditions: 32 turns, Vietnamese voice fixtures generated with VieNeu,
i7-11700K 8 cores, STT + TTS + API + driver **running on the same machine** (upper bound
on CPU contention).

| Metric                               | Start of week (19/07) | End of week (26/07) | Target   |
| ------------------------------------ | --------------------- | ------------------- | -------- |
| End of speech → first audio, **p50** | 1663 ms (REST)        | **907 ms** ✅       | ≤1200 ms |
| **p95**                              | 1976 ms               | **1582 ms** ✅      | ≤1800 ms |
| Turns above 1800 ms                  | —                     | **0/32** ✅         | —        |
| Head-start reuse rate                | 0% (dead mechanism)   | **75%** ✅          | ≥70%     |
| Rate-limit hits                      | frequent              | **0** ✅            | 0        |
| First source text shown              | none                  | 633 ms ❌           | ≤500 ms  |
| Longest idle UI gap                  | whole turn            | 753 ms ❌           | ≤500 ms  |
| STT vi                               | 1117 ms (cloud)       | **84 ms** (local)   | —        |
| STT en                               | 1285 ms (cloud)       | **178 ms** (local)  | —        |
| Speech API key dependency            | required              | **not needed**      | —        |

Quality gates, end of term: `jest` api **173 pass** · e2e 26 pass / 7 skip ·
`vitest` web **32 pass** / 1 skip · `pnpm build` + `typecheck` green 10/10 ·
`pnpm lint` **6 workspaces** 0 errors · `knip` exit 0 · `turbo test` 6/6 ·
real browser: live source text, live translated text, turn finalisation, mic reopens,
0 errors.

Start of term: 82 api tests, **no tests for `apps/web`**, **no lint for
`apps/web`**, CI ran only lint/typecheck/build.

---

## 8. Methodological lessons (the part worth putting in the thesis)

1. **Benchmarking on the actual target hardware is mandatory.** On the same day,
   published numbers were off in **both directions**: PhoWhisper missed the threshold
   even though it was estimated to pass; Zipformer and Kokoro were both faster than
   published.

2. **Re-measure after a fix; do not trust the reasoning.** Twice in one week, a change
   that looked like an improvement made p95 worse because of quota (10112 ms and
   2787 ms), **and both times it only showed up on re-measurement**. The cause was not
   the total number of requests (50→56) but **bunching in time on the same model**.

3. **Tests can "prove" things production cannot produce.** The head-start bug survived
   typecheck, lint, build, unit and e2e because two tests built an event sequence that
   cannot happen for real. Tests that count callbacks cannot catch bugs in _content_;
   tests that assert a lower bound cannot catch duplication or reordering.

4. **One dead assertion can hide two bugs.** `expect(...).not.toHaveBeenCalled`
   without `()` is a property access and checks nothing; adding `()` makes the test fail
   for real because the test itself was also wrong (missing `mockClear()`).

5. **A measurement's normalisation can hide product bugs.** WER normalisation lowercases
   and strips punctuation ⇒ the "transcript IN ALL CAPS" bug never appeared in the
   benchmark table and only surfaced when shown to users.

6. **A wrapped error without its `cause` logged cannot be diagnosed.** "Gemini being
   flaky" was in fact the daily quota; one log line revealed it immediately.

7. **All three Critical bugs of the previous round lived in untested client code**,
   while typecheck/lint/build were all green ⇒ added vitest + eslint for `apps/web`, and
   extracted the turn-taking policy into a pure module so event ordering can be tested.

8. **Only convergence of several independent measurement methods is trustworthy** —
   offline replay, the driver harness and the real browser gave the same conclusion
   (873↔1749 vs 870↔1760 ms).

9. **Diagnosing the right problem matters more than optimising the right way.** "Choppy"
   was about interface feedback, not audio latency.

10. **Dropping a phase also needs evidence** — 422 partial reads proved the final path
    did not slow down.

---

## 9. Accepted constraints and trade-offs

- **Zipformer-30M's CC-BY-NC-ND license**: academic use only, must be stated in the
  thesis + README. Replacement if commercialised: PhoWhisper (BSD-3), ~1.3 s/sentence.
- **Gemini quota is the tightest constraint.** 59 requests for 32 turns in ~190 s;
  0 rate limits in the final run but **the margin is very thin**, depending on 75% of
  turns reusing speculation. ~1000 req/day ≈ 35–40 minutes of conversation — enough for
  a demo, **not enough for a product**.
- **Provisional translations will be wrong and correct themselves in front of the
  committee** — accepted deliberately, and for the text only. Have an answer ready.
- **The first turn through a cold stack takes ~9 seconds** (8995 ms, then 650, 829 ms)
  ⇒ a few warm-up turns must be run before the demo.
- **Local TTS is slower than cloud** (section 4.4) — traded for cost, privacy, offline.
- **The fixtures are TTS voices** that pause exactly at punctuation ⇒ 75% is a
  **ceiling**, not an estimate for real human voices.
- **Every number is single-concurrency**, measured on a machine running both client and
  server.

---

## 10. Outstanding work

1. **Full duplex is on for the web — licensed by device verification, not by the
   40-turn procedure (19/08).** The mic is now honored throughout while a translation is
   playing: `fullDuplex: true` is set directly in `apps/web/src/hooks/use-streaming-translate.ts`,
   with no env flag gating it any more.

   **The basis, and its exact scope.** The demo machine is a MacBook; it was checked
   directly that the speaker stream never bleeds into the mic being captured — the
   machine's hardware AEC plus the `echoCancellation: true` that `getUserMedia` already
   enables is enough. It must be said plainly that this is **not** the 40-turn procedure
   designed below: no half-duplex control arm, no table of numbers, no recorded n. It is
   a check on exactly one device, and the conclusion applies only to that device. The i7
   rig (separate speakers + desktop mic, software AEC only) is **not measured** — if the
   defence is on that machine, use headphones, and professional simultaneous
   interpreting is done with headphones anyway.

   **What replaces the fence.** A counter appears next to the level meter **as soon as
   it is non-zero** (`cascade-panel.tsx`), and at 0 it takes no space. It is the only
   trace an acoustic loop leaves. A non-zero reading is confirmed through the transcript
   — the loop writes the app's own translation into it, which cannot be mistaken.

   **The on-screen label is `heard during playback`, deliberately not "echo".** This is
   the easiest place in this whole section to overclaim, so say it precisely: full
   duplex is turned on **precisely so that** people can talk over the translation and
   still be heard, and the mic is honored throughout that window — so a barge-in
   confirms `SpeechGate` exactly like speaker bleed does. Nothing at this layer can tell
   the two apart. Calling it "echo" would raise an alarm every time the feature works
   correctly, and people stop reading an alarm like that — exactly the price paid when it
   is the only thing replacing the build-time fence.

   Three things to state when reporting that number: (a) on the single-turn path, the
   counting window starts at end of speech, not when the speaker sounds, so it includes
   ~900 ms of room sound; (b) it is "sound heard while our audio could reach the mic",
   not "echo" in the narrow sense — on the web there is no longer a half-duplex control
   arm to subtract that term; (c) on the web it counts both **barge-in** and room sound,
   so when running the measurement procedure **do not talk over the translation while it
   is playing** — talking over it once ruins the number for that turn.

   **The 40-turn procedure still has value, for other devices.** Written up in
   `benchmarks/realtime/README.md` (the tracked location). Summary: 20 turns at the exact
   volume and distance that will be used for real, a different sentence each turn
   because self-triggering depends on the content played; record the volume, the
   mic–speaker distance, the device, and the number of `session_busy` observed (the
   server-side guard can produce a **false** 0). **Read it one way only**: failing on a
   hard rig says nothing about an easier machine, and must not be written up as
   "closing the full-duplex direction".

   **The measurement flag went with it.** `NEXT_PUBLIC_MEASUREMENT_MODE` is gone: the
   client always sends `client.turn.metrics`, and the server-side `TURN_METRICS_PATH` is
   the only switch deciding whether that line gets written to disk.

   **The half-duplex path still exists in the library** (`fullDuplex: false` is the
   `CapturePump` default) — the extension and the single-turn path still use it, and a
   client on an unverified device can still turn it off. Only the web has it hard-on.

   **Update (extension):** echo _counting_ there has its own tool —
   `apps/extension/src/echo-monitor.ts` opens a separate mic stream and counts blocks
   above a threshold **while the translation is playing**, with a fixed threshold instead
   of an adaptive floor (an adaptive floor would learn the speaker as background and stop
   counting). The number goes into JSONL via `client.turn.metrics` and is printed by
   `benchmarks/realtime/analyze-continuous.mjs`. In the extension the _digital_ echo loop
   does not exist by construction, so `fullDuplex: true` has been on from the start; what
   remains is the **acoustic** loop through the user's own mic, which the extension cannot
   control and can only measure.

2. **The cost of committing early — measured for the first time (18/08).** The question
   blocking the clause-cutting direction: how much does quality drop when translating
   piece by piece _while the person is still speaking_? A text-only experiment, same
   model, same prompt, 12 utterances (6 per direction) from
   `benchmarks/live-translate/data/manifest.json`, scored with chrF++:

   | Arm                                           | vi→en         | en→vi         | overall           |
   | --------------------------------------------- | ------------- | ------------- | ----------------- |
   | whole sentence (today)                        | 71.85         | 53.91         | 62.71             |
   | cut at punctuation (**optimistic bound**)     | 69.47 (−2.38) | 53.64 (−0.28) | 61.49 (**−1.22**) |
   | proportional cut ~3 s (**pessimistic bound**) | 67.50 (−4.35) | 51.20 (−2.71) | 59.25 (**−3.46**) |

   Read it as **a range of −1.2 … −3.5 chrF++ points**, not a single number: the real
   rule will cut on silence, which falls between these two cuts. Cutting at punctuation
   is **blind** to exactly the hypothesis under test — Vietnamese sentence-final
   particles sit right _before_ the punctuation mark, so they are never split from their
   clause — so it is a lower bound on the damage.

   **vi→en loses ~1.6–8× as much as en→vi**, in exactly the direction feared: Vietnamese
   transcripts have no punctuation, so the particle is the only polarity signal. A
   concrete case was caught in `vi-001`, proportional cut: _"security against attacks,
   **no** can be merged by tricks"_ — the word **"không"** (not) fell on a chunk boundary
   and produced a crippled negation.

   Caveats when citing: n=12 (small), the reference is a **pseudo-reference that has not
   been post-edited** (`manifest.referenceProvenance`), and absolute scores are not
   comparable with published numbers — only the **differences** between arms are the
   result. To regenerate:
   `node benchmarks/live-translate/segment-vs-whole.mjs --limit 12 --run` then
   `uv run python benchmarks/live-translate/score-segments.py <rows>`.

3. ~~**No client-side metrics channel yet**~~ — **paid off.** `client.turn.metrics`
   (`packages/types/src/events/ws-events.ts`) sends the speech start/end marks, capture
   duration, playback marks, backlog, `cutForced`, `outcome` and the echo count; the
   server writes it into the same JSONL file as its own line, distinguished by `source`.
   Join on `sessionId`, **never on timestamp** — the two sides keep their own clocks. The
   line is sent when the turn **closes**, not when playback finishes: rejected / dropped
   / failed turns never play, so waiting for playback would drop exactly those turns and
   coverage would turn into a "playback success rate" that looks better precisely when
   the pipeline breaks.
4. **Not yet measured on real human voices** (section 9).
5. **Multi-user behaviour not yet measured** — ONNX thread oversubscription. The tooling
   exists (the global cap `MAX_CONCURRENT_TURNS_GLOBAL`, an analysis script that reads
   req/minute **per model**); the RTF measurement with 1/2/3 **sockets** has not been run
   yet.
6. `apps/api` lint still scans only `src/`, so `test/` is not linted.
7. ~~**CI runs no tests**~~ — **paid off.** CI now has four jobs: Lint, Type
   check, Build **and Test**.
8. The live translated text thresholds (3 s / 2.5 s / 12 words / 3 times) were derived
   from the quota constraint, **not from measuring user perception**.
9. Vietnamese capitalisation/punctuation restoration; provider timeouts; classifying 429
   as a response error (section 4.7).

---

## 11. Questions for the supervisor

1. **Is it worth pursuing the remaining p95?** The only remaining route is to reduce the
   dependency on Gemini — local machine translation, caching, or accepting the current
   number. The remaining latency is network variability, which no client-side constant
   can reach.
2. **Does the thesis need a full cloud vs local A/B table for all three stages?** It
   already exists for STT and TTS; doing it for translation would cost significant quota.
3. **What is the acceptable level for provisional translations correcting themselves in
   front of the user?** A small survey could be run if needed.
4. **Is Vietnamese capitalisation/punctuation restoration needed?** Proper nouns are
   currently still lowercase ("tôi đi hà nội" (I am going to Hanoi)). Fixing it properly
   needs one more model.
5. **CC-BY-NC-ND license for the Vietnamese STT model** — needs official confirmation
   that it is acceptable for the thesis.
6. TTS quality was scored by **a single A/B listener**; is a multi-listener mini-MOS
   needed to be rigorous enough?

---

## 12. Original data sources (for reproducing the numbers)

| Figure                                        | Regenerate with                                                                                                                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STT WER/RTF/RAM                               | `benchmarks/stt/` — `uv run python run_benchmark.py --run-tag rN`; raw results in `benchmarks/stt/results/`                                                                                                             |
| Vietnamese decoder comparison (3 arms)        | `benchmarks/stt/` — `uv run python scripts/build_hotwords_vi.py` then `uv run python run_benchmark.py --decoder-arms --run-tag r3-decoder-arms`                                                                         |
| Display ruler (digits/punctuation/case)       | `benchmarks/stt/stt_bench/display_fidelity.py` — `uv run pytest tests/test_display_fidelity.py`; does **not** go through `normalize_text`. Baseline: `scripts/run_display_baseline.py` (§3.12)                          |
| Real voices, 3 capture paths (§3.11)          | The audio is personal data, **not committed** — the numbers cannot be reproduced independently. The record of how it was measured was removed along with the `plans/` tree; §3.11 keeps the numbers and the conclusions |
| Display repair, before/after (§3.13)          | `benchmarks/stt/` — `dump_display_hypotheses.py` → `node scripts/repair_display_hypotheses.mjs` → `score_display_repair.py`; spends real Gemma quota, audio not committed                                               |
| Misinterpretation guard (threshold = 0)       | `apps/api/.../providers/repair-divergence.spec.ts`; the calibration is in the output of `repair_display_hypotheses.mjs` (22/22 = 0.0000)                                                                                |
| Prompt-injection defence for repair           | `benchmarks/prompt-injection/` — `node run.mjs`; the `repair` arm runs separately on the shipped model and does **not** reuse the translation corpus                                                                    |
| TTS latency/RTF + WAVs for A/B listening      | `benchmarks/tts/` — same approach; `benchmarks/tts/data/sentences-en.txt` is committed                                                                                                                                  |
| Per-model Gemini latency                      | `bench-gemini-models.mjs` (real API, spends quota)                                                                                                                                                                      |
| Vietnamese conversation fixtures              | `benchmarks/realtime/generate-fixtures.mjs` (VieNeu; WAVs not committed)                                                                                                                                                |
| Usable head-start rate (offline)              | `packages/realtime-client/src/audio/capture-pump.replay.spec.ts`                                                                                                                                                        |
| End-to-end p50/p95                            | `packages/realtime-client/src/audio/pipeline-latency.measure.spec.ts`, opt-in `MEASURE_PIPELINE=1` (spends real quota)                                                                                                  |
| Per-turn metrics                              | `services/turn-metrics.recorder.ts` — 1 JSONL line/turn, opt-in via `TURN_METRICS_PATH`; records **every** ending path with a `reason`, plus the client line (`source: 'client'`)                                       |
| Speech duration (coverage denominator)        | `benchmarks/realtime/vad-reference.mjs <wav>` — offline VAD, does **not** use `SpeechGate`; see the note below                                                                                                          |
| Coverage / drift / req-per-minute-per-model   | `benchmarks/realtime/analyze-continuous.mjs <turns.jsonl> --speech-ms N`                                                                                                                                                |
| Playback order when turns arrive out of order | `packages/realtime-client/src/audio/ordered-playback.replay.spec.ts` (with a control test that must **fail**)                                                                                                           |
| Browser verification                          | Playwright + Chromium on the `next start` build, replacing `getUserMedia` with a `MediaStream` built from WAV                                                                                                           |
| Extension on a real call                      | `pnpm --filter extension build` → load unpacked `.output/chrome-mv3`                                                                                                                                                    |

**The coverage denominator must be independent of the gate.** `vad-reference.mjs` uses a
threshold derived from the energy distribution of **the whole file** plus hysteresis and
a minimum-duration rule — not the streaming-style adaptive floor of `SpeechGate`. Taking
the denominator from the gate itself would make speech the gate misses leave **both** the
numerator and the denominator, and a gate that hears nothing would score 100%.

Detailed engineering journals for the two benchmark days: `docs/journals/`.
Current architecture: `docs/system-architecture.md` · `docs/codebase-summary.md`.

**Note when citing numbers in the thesis:** every isolated benchmark number (RTF 0.017 ·
Kokoro p95 1.18 s) was measured on this machine while idle. The partial loop running in
the background changed the measurement conditions — do not mix isolated benchmark numbers
with realtime-pipeline numbers in the same table without stating the conditions clearly.

---

## ZeroTTS vs VieNeu v3 Turbo — Vietnamese TTS benchmark (14/09/2026)

> **This section has been superseded by the 15/09 section below for speed, TTFA and
> reproducibility.** The 14/09 run compared the two engines under unequal conditions:
> ZeroTTS was seeded and measured streaming, while VieNeu was unseeded and had its TTFA
> measured by clause splitting even though the engine has a streaming API. It is kept
> verbatim because it is the history of the measurement.

**The measurement conditions differ from every number above: this machine now runs
Ubuntu**, no longer Windows 11 as the start of this document records. Same CPU
i7-11700K, 8 threads, `onnxruntime` 1.27.0 pinned for both engines. Do not mix the
numbers below into the older tables without stating this.

Harness: `benchmarks/tts-vi/`. Full report: `benchmarks/tts-vi/results/report.md`.

### The most important finding is not in the comparison table

**Both engines vary heavily between runs on the same input.** This was not part of the
plan, and it matters more for the product than the original question did.

| Engine / voice      |   n | median |  mean | lowest | highest | **spread** |
| ------------------- | --: | -----: | ----: | -----: | ------: | ---------: |
| zerotts / baotrang  |   8 |   9.55 | 14.12 |   6.98 |   36.34 | **29.4pp** |
| zerotts / quangminh |   8 |   7.19 |  8.24 |   4.31 |   17.04 | **12.7pp** |
| vieneu / Mai Anh    |   6 |  20.02 | 22.28 |  16.43 |   36.96 | **20.5pp** |
| vieneu / Thanh Bình |   6 |  16.32 | 17.93 |  12.73 |   30.39 | **17.7pp** |

Corpus WER %, 41-sentence dialogue set, PhoWhisper-small as the ruler. The ZeroTTS runs
differ by seed; the VieNeu runs are plain repeats, because it has no seed to set and
still differs.

**VieNeu is the engine running in production**, and its WER slides from 16.4% to 37.0%
on the same 41 sentences with unchanged input. This is a reliability property of the
running system that had never been recorded anywhere in this repo.

The two sides have different causes. ZeroTTS samples from the global `np.random` every
frame, so the variation comes from the sampler; a seed pins it completely (41/41
byte-identical). VieNeu has no sampler at all and still produces output that differs
byte for byte (0/41). Not yet explained.

### Intelligibility — ZeroTTS wins, judged by distribution

| Comparison                     |  median diff |          95% CI | separated | P(one ZeroTTS run beats one VieNeu run) |
| ------------------------------ | -----------: | --------------: | --------- | --------------------------------------: |
| female — baotrang vs Mai Anh   | **−10.47pp** | [−20.33, −0.21] | yes       |                               **83.3%** |
| male — quangminh vs Thanh Bình |  **−9.14pp** | [−16.94, −4.83] | yes       |                               **90.6%** |

Negative means ZeroTTS is better. Neither confidence interval contains 0.

**But the two distributions overlap:** ZeroTTS's worst run (36.34%) is worse than
VieNeu's best run (16.43%). "ZeroTTS is easier to understand" is a statement about the
median, not a guarantee for each sentence.

**Methodology lesson.** The main run measured each arm only once and got −9.03pp and
−8.42pp — less than a point off the −10.47 and −9.14 of the full distribution. The
numbers happened to be right, but **there was no basis for trusting them**: the seed
used gave 6.98% and 6.78% while the medians are 9.55% and 7.19%, i.e. it landed on the
favourable side of both distributions. A seed makes a measurement _reproducible_, not
_representative_.

### Speed — VieNeu wins, the two ranges do not overlap

|                            |           VieNeu |           ZeroTTS |
| -------------------------- | ---------------: | ----------------: |
| RTF                        |  **0.507–0.726** |       0.782–0.799 |
| p50 per sentence           |  **1.42–1.84 s** |       1.94–2.11 s |
| Load time                  |  **1.73–1.98 s** |       3.98–4.14 s |
| Peak RAM                   | **1425–1542 MB** |      1670–1690 MB |
| Speaking rate (audio/word) |    0.231–0.255 s | **0.207–0.222 s** |

ZeroTTS speaks faster, and RTF is normalised by duration, so producing shorter audio for
the same number of words counts against it.

### TTFA — the easiest place to draw the wrong conclusion

| Arm                                     |    first chunk |                   underrun | **to gapless audio** |
| --------------------------------------- | -------------: | -------------------------: | -------------------: |
| ZeroTTS streaming                       | **138–140 ms** | +766…+798 ms (worst +1235) |       **910–938 ms** |
| **VieNeu clause splitting** (live path) |              — |                          — |      **842–1256 ms** |
| VieNeu whole sentence (reference only)  |   1423–1842 ms |                          — |                    — |

ZeroTTS produces its first audio after ~140 ms — the advertised 70 ms is right in
direction. But the first chunk holds only 80 ms of audio, and the engine cannot yet
generate in real time at the start of the stream, so the listener hears gaps. Time to
gapless playback is **~911 ms**, inside the VieNeu clause-splitting range — **not
separated**. **9/164 streams** take longer to generate in total than the audio lasts.

Reporting only the first chunk would conclude "7 times faster". Wrong.

**The comparison must be against the clause-splitting arm**, because the app already
splits clauses before feeding the engine; using the whole-sentence number as the
baseline would inflate the incumbent by about 1.7 times.

### Checking the vendor's numbers

| Claim                 | Measured                                      | Verdict                                                                              |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| 70 ms to first sample | 138–140 ms first chunk; **911 ms to gapless** | Half right                                                                           |
| RTF 0.50×             | **0.78–0.80**                                 | Not reproducible                                                                     |
| WER 1.03%             | median 7.2–9.6%                               | **Not comparable** (they use PhoWhisper-large + whisper-large-v3 and take the `min`) |
| UTMOSv2 2.91          | deliberately not measured                     | —                                                                                    |

### Licensing — looked up, and it does **not** separate the two

VieNeu v3 Turbo is **Apache-2.0** for both code and weights, and the model card permits
commercial use of audio from the preset voices. ZeroTTS is MIT. The "see upstream" line
in `README.md` was only stale, not a risk — fixed.

### Verdict: **DEFERRED** — no swap yet, waiting on a MOS panel

ZeroTTS is easier to understand (median 9–10pp lower, wins 83–91% of randomly drawn
pairs) but clearly slower. What is missing is **naturalness**, never measured for either
engine. The deciding question: in a blind `benchmarks/mos` panel on the WAVs already
kept, does ZeroTTS sound at least as natural as VieNeu?

A question more worth pursuing than the engine swap: **why does VieNeu swing between
16.4–37.0% WER across runs** with no sampler at all? That is the system actually running.

---

## Re-measured under equal conditions — both engines seeded, both streaming (15/09/2026)

The 14/09 run had two harness bugs, both against the incumbent engine. `vieneu` 3.3.0
**has a sampler** (`temperature=0.8, top_k=25, top_p=0.95,
repetition_penalty=1.2` — exactly the defaults ZeroTTS uses) and **has `infer_stream`**.
The old adapter declared `"seed": None, "stochastic": False`, `supports_streaming = False`.

The harness was fixed and everything rerun: a shared seed `measure.SEED` for both
engines, both measured streaming, and the streaming path warmed up before timing too
(previously only `synthesize` was warmed, so the first-call cost of the streaming decoder
landed in the `stream_ttfa_s` number itself). The old numbers are kept in
`benchmarks/tts-vi/results/unseeded-baseline/`.

### TTFA — where the conclusion flips

41-sentence dialogue set, medians, ms. "Gapless" = first chunk plus the worst lag after
it, i.e. how long the player must buffer to play the whole sentence without stalling.

| Arm                                 | first chunk |     median lag | **to gapless audio** | streams with underrun |
| ----------------------------------- | ----------: | -------------: | -------------------: | --------------------: |
| **VieNeu streaming**                |     221–257 |       −119…−92 |          **221–257** |                20/164 |
| VieNeu clause splitting (live path) |           — |              — |             781–1193 |                     — |
| ZeroTTS streaming                   | **144–153** | **+796…+1134** |             937–1281 |           **164/164** |
| ZeroTTS clause splitting            |           — |              — |            1232–1476 |                     — |

ZeroTTS emits its first sample ~100 ms earlier and then **underruns in all 164/164
streams**, with a median lag of 0.8–1.1 seconds. VieNeu runs about 100 ms _ahead_ of
the listener and reaches gapless audio 4–5 times faster.

**The most valuable number for the product is not about swapping engines:** the VieNeu
already running, if it calls `infer_stream` instead of clause splitting, cuts the wait
from 781–1193 ms to 221–257 ms — 3–5 times faster, with no engine change.

### Speed and reproducibility

|                  |           VieNeu |      ZeroTTS |
| ---------------- | ---------------: | -----------: |
| RTF              |  **0.497–0.641** |  0.865–0.977 |
| p50 per sentence |  **1.26–1.86 s** |  2.09–2.41 s |
| Load time        |  **1.72–1.83 s** |  4.09–4.54 s |
| Peak RAM         | **1544–1622 MB** | 1647–1702 MB |

**Reproducibility is now a tie.** With the same seed, r1 and r2 are byte-identical: 41/41
on the dialogue set, 50/50 on the VIVOS set, run in two separate processes. The old
conclusion "ZeroTTS 41/41, VieNeu 0/41" was a property of the harness, not the engine.

Two details worth keeping: VieNeu's streaming output is not byte-identical even with the
same seed, but it differs by at most **1.5e-06** (below 1 LSB of 16-bit) because
`infer_stream` chunks by `time.perf_counter()`; and with identical WAVs, WER still moves
**0.2pp** between two scoring runs — that is noise in the ASR scorer itself.

### Intelligibility — ZeroTTS still wins, but do not quote a single seed's number

| Arm                 | WER seeded r1 | WER seeded r2 | median over seed distribution |
| ------------------- | ------------: | ------------: | ----------------------------: |
| ZeroTTS / baotrang  |         6.78% |         6.98% |                        10.27% |
| ZeroTTS / quangminh |         6.78% |         6.78% |                         7.60% |
| VieNeu / Mai Anh    |        29.16% |        29.16% |                        21.97% |
| VieNeu / Thanh Bình |        14.78% |        14.99% |                        16.63% |

The shared seed 20260914 happens to be the **best of 8** draws for `baotrang` and falls
in the bad tail for `Mai Anh`. So the 22pp gap for the female voice in the table above is
illusory; **the median gap is still ~10pp (female) and ~9pp (male)** as the earlier report
said. A seed makes a measurement _reproducible_, not _representative_.

### Verdict: **KEEP VieNeu, and move to streaming**

For a zero-latency realtime goal, the deciding dimension is time to gapless audio, and
that dimension does not favour ZeroTTS: on this CPU it cannot stream Vietnamese without
stalling, not occasionally but on every stream. ZeroTTS only still wins on
intelligibility.

The next step in the product, independent of any engine swap: have
`services/local-tts` call `infer_stream`, seed that call, and revisit the clause
splitter in `apps/api/src/modules/translate/audio/clause-splitter.ts` — it exists to
work around exactly the streaming API the engine already has.

The full report was removed from the repo together with the `plans/` tree. The
conclusions and deciding numbers are right here; the harness and raw results can be
rerun from `benchmarks/tts-vi/`.

## Context biasing: reopening the decoder question with a real conversation (18/09/2026)

Section 3.10 closed the decoder question on 28/08 with the verdict **stay on greedy**,
measured on 50 VIVOS sentences. This section does not overturn that verdict — it shows
what that test set **cannot** see, and adds a branch that runs only when the user
declares their own terms.

### The error that is in no test set

Analysing a production conversation with full recordings (`f35c2816`, 4:30, 53 turns,
vi→en) against an independent reference transcript: **every serious error is
code-switching**. The Vietnamese engine has no output path for English words, so it
produces the nearest-sounding Vietnamese syllables, and translation then treats them as
real Vietnamese and "corrects" them into fluent English with the wrong meaning:

| Actually said                                          | Recognised as                               | What the reader sees            |
| ------------------------------------------------------ | ------------------------------------------- | ------------------------------- |
| "một cái giải **poker**" (a poker tournament)          | "một cái giải **quốc cơ**"                  | "a national championship"       |
| "thực tập ở siêu thị **Target**" (interning at Target) | "siêu thị **ta ghép** … search **ta ghét**" | recovered by chance             |
| "tôi đi học ngành **retail**" (I studied retail)       | "tôi đi học ngành **vì theo**"              | "I studied this major because…" |
| "Yo what's up baby"                                    | "Dấu sắp bệnh tật"                          | "Signs of impending illness"    |

VIVOS is read speech with no code-switching — 0/50 sentences can contain this error.
That is why the beam-hotwords branch of 28/08 bought only 0.72 WER points: it was
measuring the wrong kind of error. WER barely sees this class of error either: "poker" is
**one** word out of 867, but losing it changes the meaning of the whole sentence.

### Re-measured, two harnesses, same direction

On the 53 turn windows of that same conversation, against the reference transcript. The
two harnesses cannot be compared with each other (one feeds float samples directly, the
other goes through HTTP + PyAV), so each table compares only within itself.

In-process harness:

| Arm                                                | WER   | RTF    |
| -------------------------------------------------- | ----- | ------ |
| greedy (shipping)                                  | 0.150 | 0.0171 |
| beam, no hotwords                                  | 0.137 | 0.0248 |
| beam + 13 phrases fitted to this conversation @1.5 | 0.136 | 0.0233 |
| beam + **28 common English words**                 | 0.148 | —      |
| beam + **20 long, distinctive words**              | 0.150 | —      |

Endpoint harness, the exact code path that will ship:

| Arm                                       | WER   | RTF            |
| ----------------------------------------- | ----- | -------------- |
| no bias (greedy)                          | 0.159 | 0.0225         |
| biased with this conversation's 4 phrases | 0.142 | 0.0306 (1.36×) |

**A fixed background list is a loss.** This is the result most worth recording: biasing
toward a word nobody says is paid for in real Vietnamese — "giải quốc cơ" becomes "giải
ok", "nó là" (it is) becomes "đó là" (that is), "tai nghe nào" (which headphones) becomes
"tai nghe là". 10/53 sentences change, most of them for the worse, and nothing is
rescued, because the English this speaker uses is his own vocabulary, not anyone's common
words.

**A user-declared list is a gain.** With the same 4 phrases, "giải poker" and "siêu thị
target … search target" come out right, and whole-set WER drops 1.7 points in the same
harness.

### Decision

`greedy_search` **remains the default** — a turn that declares no phrases decodes exactly
as it did yesterday, so every number already published for this engine still describes
it. Alongside it sits a second `modified_beam_search` recognizer with
`hotwords_score=1.5`, selected **only** when the turn carries phrases. Cost: **+59 MB
RSS** (measured separately: first recognizer +91 MB, second +59 MB) and 1.36× RTF for the
biased turns only.

The phrase source is `TranslationHints.hotwords` — a field that already existed, that the
client already collected, and that until now only reached the translation prompt. Its own
doc comment says "a hotword earns its place precisely because the recognizer mishears
that word", yet the recognizer never received it. Now it reaches the recognizer first,
and still reaches translation as before.

The 1.5 threshold is a measured range: at 3.0 the pull damages neighbouring words (the
multi-word phrase "FIRST IN FIRST OUT" truncated the clause containing it). The pull also
spreads to adjacent words: a list with "TARGET" but without the neighbouring "SEARCH"
breaks the latter into "SH" — so a good glossary should cover the English region around a
phrase, not only the phrase itself.

The detailed record was removed from the repo together with the `plans/` tree. The
1.5–2.0 range and both warnings above live in
`services/local-stt/engines/zipformer_vi.py` (`HOTWORDS_SCORE`). The hotword arm can be
rerun with `benchmarks/stt/` — `uv run python run_benchmark.py
--decoder-arms --run-tag r3-decoder-arms` — but that is a ceiling taken from the test set
itself, not the glossary-driven sweep that produced this range.

## Both ends of the conversation: where speech leaks out of the session (18/09/2026)

The same production conversation as the section above, but this time comparing **the
recording against the transcript** instead of the transcript against a human ear. Both
ends of the tape have speech that belongs to no turn, and the two ends have entirely
different causes.

### Start of the tape — startup order

`ConversationSession.start()` runs `openMicrophone()` first, and only then loads the
worklet and connects the socket. `apps/web` attaches `MediaRecorder` inside
`openMicrophone`, so **recording** starts at the first await while **capture for
translation** starts after the last one. Measured on this conversation:
`audioOffsetMs = 171`, the first speech burst at media 0.00–1.70 s (peak RMS 0.17,
"Alo anh em" (hey guys)), the first saved turn at media 2.672 s. At least 1.70 seconds
of speech is in the file but not in the transcript.

Not a speech gate bug: the gate initialises `noiseFloor = MIN_NOISE_FLOOR` (0.004) and
only adapts during silence, so a 0.17 RMS burst would open a turn immediately if samples
reached it.

Fixed in two steps, because the first step closed one gap and opened a smaller one. The
first step moves the microphone to the end: no more recorded-but-not-captured audio, but
speech during the socket handshake is lost in **both** places. The second step connects
the worklet to the microphone as soon as the microphone opens — before the socket even
exists — and buffers blocks into a capped buffer (`MAX_PREBUFFER_MS` 20 s, oldest
dropped first, same size and same reasoning as the pipeline's `MAX_PENDING_MS`). Once the
pipeline is up, the buffer is replayed in order before switching to the live handler,
both in one synchronous run so no block slips in between.

### End of the tape — a turn-close reason misread as the server's

`TurnPipeline` retries `too_many_turns` and then invents the close reason
`'too_many_turns'` for a turn that never had a session id. `isServerReason()` excluded
only three invented reasons — `never_started`, `dropped_pending`, `stopped` — so the
fourth was read as server-confirmed, `abandonTurn()` did not run, and the turn vanished
without a trace: no live line, no abandoned label, no saved row. Meanwhile the recorder,
which taps the microphone independently, still kept that speech.

The timing evidence rules out the 20-second drain hypothesis: `endedAt - startedAt` =
270.807 s versus `audioOffsetMs + audioDurationMs` = 270.817 s, a ~10 ms difference,
meaning `stop()` ran in the same tick as `finish()`.

Fixed in two parts. One, add that reason to the exclusion list. Two — because reporting a
loss is not the same as not losing — relax the retry limit: previously `MAX_PENDING_MS`
held 20 seconds of audio while `MAX_REFUSAL_RETRIES` (4 attempts × 750 ms) stopped
sending at second 3, i.e. 17 seconds holding something already given up on. Now there is
a single limit, read from the same constant that governs how long audio lives.

What could **not** be proven: why there was a refusal in the first place. The API keeps
sessions in memory and the container had restarted, so the logs from the night of 16/09
are gone. The loss mechanism does not depend on that answer — any exhausted budget
silently loses a turn — but the trigger remains open.

### Patching the data rows

All of the fixes above apply only going forward. The two missing turns of conversation
`f35c2816` were cut from the recording itself and run through the product's exact
pipeline — the Vietnamese sidecar for `sourceText`, `gemini-3.5-flash-lite` for
`targetText` — and inserted at positions 0 and 54. A `pg_dump` was taken before writing,
the insert ran in one transaction, and positions were shifted through negative values
because of the unique index `(conversationId, position)`.

## Real TTS streaming: VieNeu `infer_stream` on the live path (21/09/2026)

The 15/09 verdict ("keep VieNeu, and move to streaming") has now been carried out.
Previously, the API split the translation into clauses and waited for each clause's
complete WAV before sending the first byte. Now the whole turn is sent once to
`POST /synthesize/stream`, and PCM is pushed to the WebSocket as soon as the engine
produces it.

Each model is handled as follows:

- **VieNeu:** streams frame by frame via `infer_stream`, with a per-voice seed.
- **Kokoro:** still clause-split, but the splitting now lives in the sidecar.
  sherpa-onnx only emits audio at sentence boundaries. Its callback on 1.13.4 also
  contradicts the docstring: returning 0 means STOP. So the callback is not used.
- **Local STT:** cannot stream. Both exports are non-streaming
  (`'non-streaming zipformer2'`, Moonshine encodes the whole segment).
- **Gemini translation and Gemini Live:** already stream.
- **Summary:** does not need streaming.
- **ElevenLabs:** out of scope because it is about to be removed.

### Per-voice seed

Each voice swept 8 seeds on the 41-sentence dialogue set (vieneu 3.8.1, PhoWhisper-small).
The chosen seed is kept only if it beats the median seed on VIVOS, the held-out set.

| Voice      | Dialogue WER (8 seeds) | Chosen seed | VIVOS: chosen seed / median seed |
| ---------- | ---------------------: | ----------: | -------------------------------: |
| Mai Anh    |            6.37–13.35% |  11 (6.37%) |                  13.08% / 15.59% |
| Thanh Bình |           13.76–24.85% | 44 (14.78%) |                  13.44% / 18.82% |

Thanh Bình's best seed on the dialogue set is 11. That seed loses to the median seed on
VIVOS by 0.18 points (19.00% versus 18.82%). Following the rule as set, the second-ranked
seed, 44, was taken, and it beats the median seed by 5 points.

### Measured on the running sidecar, over HTTP

Running `benchmarks/tts-vi/scripts/measure_sidecar_stream.py`, medians (ms):

| Voice          | first chunk | to gapless audio | streams with underrun | first clause (old path) |
| -------------- | ----------: | ---------------: | --------------------: | ----------------------: |
| Mai Anh        |         192 |          **192** |                  0/41 |                     616 |
| Thanh Bình     |         179 |          **179** |                  0/41 |                     584 |
| Kokoro (en, 9) |         660 |              660 |                  0/30 |                     674 |

For Vietnamese, streaming is 3.2 times faster than the old path and no stream underruns.
English is not faster, as expected, and not slower either.

After a client disconnects midway, the next request receives its first byte after
0.42 s. When two Vietnamese requests are sent concurrently, the second queues for about
4.5 s and still returns 200.

### Measured on real turns, same fixture, `main` versus the branch

15 English LibriSpeech sentences, translated into Vietnamese, cascade path only. The
metric is the TTS segment, `firstAudioAt − translatedAt` from the turn metrics, to keep
machine-translation latency out of the comparison.

|                           | median |    worst | errors |
| ------------------------- | -----: | -------: | -----: |
| `main` (clause splitting) | 586 ms | 1,634 ms |      0 |
| branch (stream)           | 231 ms |   443 ms |      0 |

**The "cut ≥ 400 ms" target was not met: the cut is only 355 ms.** The `main` baseline
measured on this machine is 586 ms, lower than the 781–1193 ms from the benchmark the
target was based on. The tail of the distribution dropped the most (1.6 s to 0.44 s),
because multi-clause turns previously had to wait for the entire first clause.

### Two things red-teaming and tests caught

- **Holding the lock for the whole turn is a deliberate choice.** It keeps the seed
  reproducible and the prosody continuous. The cost is that a second turn in the same
  language must wait, up to 15 s.
- **"If the client stops reading, the lock is released after 5 s" is not true over TCP.**
  The kernel's socket buffer swallows several MB, so the sidecar never sees
  backpressure. On localhost, an idle client holds the lock until the end of a 50 s
  turn. The practical limit is the 60 s cap per stream, together with the API's overall
  deadline. The old integration test "passed" because it disconnected by accident:
  `next(res.iter_raw())` drops the generator, and httpx closes the response when the
  generator is collected.

## STT on real audio: streaming is not the answer, Parakeet for English finals (25/09/2026)

Context: the user felt STT was "not really doing well yet" and suggested moving to a
streaming model. Before choosing a model, I measured on **all 6 recorded prod
conversations** (4 vi, about 9.2 minutes; 2 en, about 3.1 minutes) instead of on
VIVOS/LibriSpeech. The full report is at
`plans/reports/brainstorm-260925-1152-streaming-stt-prod-audio-evaluation.md`, and the
scripts are in `benchmarks/stt/scripts/prod-audio-arms/`.

### The reference has to be checked too

Whisper large-v3 **cannot be used as the Vietnamese reference**: it hears "fan cứng"
(die-hard fan) as "vang cứng", and "anh Hoa Lang Thang" (a name) as "tính hoài liên
thang". The Vietnamese reference is therefore ElevenLabs Scribe v2 (approved by the
maintainer), cross-checked against PhoWhisper-large. These two references disagree by
**20.4% WER**, so Vietnamese differences below about 3 points are noise.

### Two rankings that point in opposite directions

On VIVOS, the running Zipformer-30M scores 5.4% while pcs (PengChengStarling's
multilingual streaming Zipformer) scores 13.4%. On prod audio it is the reverse: pcs
19.0% and prod 22.1%. **A clean test set does not represent this product.**

### Streaming only wins when fed continuously

The pcs result of 19.0% is from feeding the whole recording continuously. When replayed
through the client's actual `CapturePump`, with the same options as prod (matching the
prod log: 17 turns, 8 forced cuts for bcf4d748), each turn opens a new stream:

| vi, vs ElevenLabs             | continuous | per turn | per turn, 6 s primer |
| ----------------------------- | ---------: | -------: | -------------------: |
| Zipformer-30M (running)       |          — |     22.3 |                    — |
| pcs (streaming, multilingual) |       19.0 | **35.8** |                 31.6 |
| hyntS (streaming 30M variant) |       22.3 |   28.4\* |                    — |
| Zipformer 70k hours (offline) |          — |     21.9 |                    — |
| Nemotron-3.5 / Moonshine-vi   | 44–47 / 37 |        — |                    — |

\* hyntS and the primer column were measured on ideal cuts (silences ≥ 0.3 s in the reference), not on replayed turns.

Paired bootstrap by turn (each reference word is assigned to the turn containing its midpoint, so absolute numbers are higher than whole-recording scoring): pcs is worse than the running model by **+13.7 points, 95% CI [+8.9, +18.8]**;
Zipformer 70k hours differs by −0.3 [−1.9, +1.3], not significant. Making pcs win would
require changing the architecture to one continuous recogniser per direction. That
touches speaker attribution and turn boundaries, in exchange for 3 points that sit inside
the noise band. **Vietnamese stays as it is.** It also turns out that turn cutting is
not the main source of Vietnamese errors: prod 22.1 vs ideal cuts 23.4.

### English: a batch model, not streaming

On real replayed turns, Parakeet-TDT-0.6b-v2 int8 scores **3.4 vs 7.4** WER for
Moonshine-base. Bootstrap by turn: −4.0 points, 95% CI [−7.3, −0.9]. The model outputs
punctuation and casing, and is licensed CC-BY-4.0. It fixes exactly the errors seen in
prod, such as "English learners" (prod wrote "Star Nuggets") and "walking to school or
washing". Parakeet-unified streaming was ruled out because of RTF 1.7 on this CPU.

Parakeet fully replaces Moonshine, for both live partials (re-reading the window every
300 ms) and finals. The initial plan was to split into two models per turn, because
Parakeet costs about 1.5× Moonshine per decode. Measurement showed that was unnecessary:
a single model still fits within the 300 ms cadence. Load was measured on the real
sidecar (4 threads, 4 lanes as in prod), both directions at once, firing partials every
300 ms without waiting for the previous one to finish (heavier than the real scheduler):

|                | Moonshine | Parakeet |
| -------------- | --------: | -------: |
| en final p95   |    215 ms |   327 ms |
| en partial p95 |    191 ms |   284 ms |
| 503            |         0 |        0 |
| Peak RSS       |    721 MB | 1,363 MB |

Parakeet accepts 10 ms audio segments, so `MIN_AUDIO_MS` remains only because of
Zipformer. There is no rollback flag: returning to Moonshine means reverting the commit.

Still open: English has only one reference so far (Whisper). A second reference,
ElevenLabs for the 2 en recordings, has not been approved yet.

## Raising the speaker-attribution thresholds to 0.50/0.45, a 300 ms silence gate, and recording the decision not to ship the relative cut rule (29/09/2026)

Context: 5 real vi→en conversations showed four faults — `tauAssign` 0.375 merged two
voices whose cross-voice cosine was 0.38–0.58; non-speech segments (music, jingles)
produced phantom text and minted a phantom voice; turns on broadcast audio hit the 8 s
ceiling because the music bed never dropped below the absolute floor; and lowercase "ai"
was translated as "who". Plan:
`plans/260929-0353-two-speaker-attribution-segmentation-keywords`.

### Ruler table: old vs 0.50/0.45, both scored after the 300 ms gate

Run through `run_attribution_rulers.py --config 0.50/0.45 --min-speech-ms 300`, via the
shipped TS reducer itself (`attribution-reference.mjs --pipeline`), not a reimplementation:

| Ruler        | Old thresholds 0.375/0.325 (acc / exact) | New thresholds 0.50/0.45 (acc / exact) |
| ------------ | ---------------------------------------: | -------------------------------------: |
| ViYT clean   |                           0.910 / 90/100 |                     **0.945 / 96/100** |
| ViYT far     |                           0.873 / 89/100 |                     **0.910 / 95/100** |
| Old prod (8) |                              0.827 / 5/8 |                        **0.921 / 7/8** |

Perturbation over 20 seeds (arrival order shuffled, p=0.2): minimum exact on ViYT clean
96, ViYT far 94 — both clear the ≥ 90/89 bar. On the 5 real conversations
(`rulers/conversations`): 2499c493 (2 voices) reaches exact 1/1 (vs 0.725 when scored at
the old thresholds — this is the original merge case that raising the thresholds fixes),
2bed5c89 (1 voice) exact 1/1. **1cd04a39 (1 voice) still predicts 2 voices** at both
the old and new thresholds — see the "phantom silence" item below.
The test `test_attribution_rulers.py::test_single_voice_conversation_predicts_one_label
[conversations/1cd04a39-…]` is left failing, not loosened.

### 300 ms lost-turn threshold: accepted by the maintainer

| Ruler                                                 |  Turns lost | % turns |  Seconds lost | % seconds |
| ----------------------------------------------------- | ----------: | ------: | ------------: | --------: |
| ViYT clean                                            |     92/2337 |    3.9% | 23.6/5006.2 s |      0.5% |
| ViYT far                                              |     92/2337 |    3.9% | 23.6/5006.2 s |      0.5% |
| Old prod (8 recordings)                               |      17/221 |    7.7% |   3.2/497.5 s |      0.6% |
| 5 real conversations (83 windows, window-level ruler) | 0/78 speech |      0% |           0 s |        0% |

Old prod exceeds the 5% bar on turn count (but is under 1% of duration); ViYT and the 5
real conversations are under both bars. **The maintainer accepted the 300 ms floor
(29/09/2026)** on the numbers above — the turns lost in old prod are extremely short
turns (under 300 ms of actual speech), not turns with content; 0 speech windows across
the 5 real conversations were lost to the gate.

### `SPLIT_COSINE` re-sweep, kept at 0.35

`split_cosine_sweep.py` runs through the real `groupByVoice`/`findInternalPauses` (esbuilt
from `speaker-change-split.ts`) over all stored turns of the 5 recordings, at the
0.50/0.45 clusterer bars:

| Threshold | False cuts + missed voice changes (2 multi-voice sessions) | False cuts in 1-voice sessions |
| --------- | ---------------------------------------------------------: | -----------------------------: |
| 0.35      |                                                          3 |                              0 |
| 0.40      |                                                          3 |                              0 |
| 0.45      |                                                          1 |                              1 |

0.45 wins on the first column but makes one false cut in a 1-voice session itself — it is
rejected by the rule set in advance (no added false cuts in 1-voice sessions). No
candidate wins both columns, so `SPLIT_COSINE` stays at 0.35 — decoupled from
`tauAssign`/`tauNew`, no longer sitting "between the two clusterer thresholds" as the
old comment said (that was a coincidence, not a design constraint).

### Cutting at relative silence: measured, **not shipped**

The idea (plan phase 07): within the 1.5 s lookahead, when the absolute pause rule is
blind (the music bed never reaches the floor), add a cut where the level falls below 40%
of the turn's median RMS for ≥ 60 ms. It was implemented to spec with TS/Python parity
green, but the numbers measured on the 5 real recordings say otherwise: **the rule never
fired once** — the replay is byte-for-byte identical to the current gate. Cause: 13/14
turns of the heaviest session have a silence below the absolute floor just 20–1000 ms
after the turn opens, i.e. an ordinary breath, not a rare case — and because the
"quiet seen" flag (`sawQuiet`) latches for _the whole turn_ from then on, the relative
rule is disabled before it can arm in the final 1.5 s, on almost every turn.

A variant was tried (latching only from arming onward, on `kongming`'s advice): ceiling
cuts in the heaviest session dropped 12 → 7 (bar ≤ 3, still not met), in-word cuts
dropped 25 → 21 (bar < 5, still not met) — but it broke exactly the two "clean" sessions
the rule must not touch: 2bed5c89 changed its cut mix (the relative rule fired), and
1cd04a39's phrase-safe cuts dropped 15 → 14. This variant was rejected; the
literal-to-spec version (safe, but nearly inert on real evidence) is the one kept.

**Decision: do not ship.** The code in `speech-gate.ts` stays as in `origin/main`;
only the replay tool `scripts/cut_placement.py`, with its test and the parity fixture
override, was committed. Cut counts on the current gate (unchanged), 5 recordings:

| Session   | Total forced | Ceiling | Lookahead | In-word | Phrase-safe |
| --------- | -----------: | ------: | --------: | ------: | ----------: |
| 1cd04a39  |           18 |       3 |        15 |       3 |          15 |
| 2499c493  |           10 |       4 |         6 |       6 |           3 |
| 2bed5c89  |            3 |       2 |         1 |       2 |           1 |
| 5b679761  |           13 |      12 |         1 |      10 |           3 |
| 74410b70  |            7 |       5 |         2 |       4 |           3 |
| **Total** |       **51** |  **26** |    **25** |  **25** |      **25** |

Bar A3 (5b679761 ceiling ≤ 3, global in-word < 5) is not met on this evidence, and not
for lack of tuning — the flag that keeps the rule safe on clean sessions is the very flag
that disables it on sessions with a music bed. A different mechanism is needed (for
example a local windowed median instead of a single one taken at arming time, or
evaluating each segment of the turn separately) — an open design question for later,
not an implementation bug.

### "ai" → AI: no regression, no privacy leak

Graded via `deepseek-flash` (the production provider), with 4 turns of prior context:

- 21/21 (100%) lines flagged AI-context from 2 real sessions, 3 runs — 21/21 both before
  and after adding the note (this session pair was already translated correctly; the note
  broke nothing).
- Who-control: 30/30 observations (10 synthetic sentences × 3 repeats), 0 flips, clearing
  the ≥ 29/30 bar.
- Prompt-injection: before the note 152/156 (4 behavioural failures), after the note
  **156/156, 0 behavioural failures** — the 3 real "là ai" (who is) attack cases and the
  new control case are all 3/3.
- Glossary adherence did not regress past the bar: 41/43 (95.3%) vs 42/43 (97.7%) before
  — exactly meeting the "≥ before minus 1" bar.
- One of the spec's four attack cases turned out to be mislabelled, not a failure of the
  note: the sentence uses a yes/no question frame ("có phải là X không" (is it X)) — this
  frame cannot take "ai" to mean "who" and still mean "bạn là ai" (who are you), so
  translating it as "are you an AI?" is grammatically correct in an AI context, not an
  error to fix. This case was reclassified as a control.

### The gate does not filter a few short windows: accepted as a reference gap

Measured on ≥ 20 segments without Scribe words, ≥ 1.5 s long, from 5 real webm recordings:

- 14/22 (63.6%) are filtered by the gate, below the ≥ 95% bar.
- 3/5 "noise" windows of the window-level ruler are filtered by the gate, below the ≥ 4/5 bar.
- Median deviation `|sileroMs − vad harness × 1000|`: 162 ms, 12 ms over the ≤ 150 ms bar.
- One 670 ms window has no Scribe words but carries 442 ms of speech according to Silero
  (66% of the window) and a short non-empty translation — it mints a phantom voice in
  the 1cd04a39 ruler, identically at both the old and new thresholds.

Direct inspection of each unfiltered window/segment: every one has Silero-detected speech
_and_ the decoder produces short, plausible text — not garbage. **The maintainer accepted
this as a reference gap (most likely real, short speech that Scribe assigned no words to
— interjections or backchannels), not a gate fault.** The red test
`test_single_voice_conversation_predicts_one_label[1cd04a39]` stays as a recorded open
item, not loosened.

### Staged rollout — carried out (29/09/2026)

The merge triggers an automatic deploy, with `prod.env` set to `STT_MIN_SPEECH_MS=0`
before merging. After deploy: CI and Deploy on `main` are green, the Silero hash in the
container matches the pinned hash, `/healthz` returns `ok` with `languages`, and
`printenv STT_MIN_SPEECH_MS` prints 0.

Instead of live spoken sessions, both stages were checked by **replaying the five
recordings** through the actual client code (`ConversationSession`, capture pump, speaker
attributor) into the production WebSocket, under the maintainer's account, in real time,
one session after another.

|                              | 2499c493 | 1cd04a39 | 2bed5c89 | 74410b70 | 5b679761 |
| ---------------------------- | -------- | -------- | -------- | -------- | -------- |
| Speakers (Scribe)            | 2        | 1        | 1        | 3        | 2        |
| Client labels, gate off      | 2        | 2        | 1        | 2        | 2        |
| Client labels, gate 300 ms   | 2        | 2        | 1        | 2        | 2        |
| Finals, gate off → on        | 14 → 14  | 26 → 25  | 19 → 19  | 11 → 11  | 16 → 16  |
| Error banners, gate off → on | 0 → 0    | 1 → 0    | 0 → 0    | 0 → 0    | 0 → 0    |

- Stage 1 (gate off): no crash; the only banner is the opening turn of 1cd04a39, before
  the first word, where STT returned empty (`gated=false`), the expected behaviour with
  the gate off.
- Stage 2 (set to 300, recreating only the API container): that turn becomes a silent
  `no_speech` ending, with no banner; it is the only `no_speech` ending. The only final
  lost is a 660 ms split fragment with no speech, dropped by the gate; the number of
  completed turns is unchanged in every session.
- "ai" in the source: 2499c493 10/10 translated as "AI"; 74410b70 6/7 as "AI", 1 other,
  0 as "who".
- Still open, as accepted: the phantom label in 1cd04a39 remains (down from 2 turns to
  1); 74410b70 yields 2 labels for 3 voices, exactly the `kMax` = 2 limit.

Rollback is still setting `STT_MIN_SPEECH_MS=0` in `prod.env` and recreating the API
container.

### Server numbers re-measured, separated from parallel-agent load

`/transcribe` latency with vs without `min_speech_ms=300` on a ~7.4 s clip, 50 calls at
concurrency 2, re-measured when the machine was less busy: Δp95 across two runs was
**+10.2 ms** and **+20.6 ms** respectively — within the +25 ms budget (the earlier
measurement, under load from parallel phases, was +28.3 ms).
