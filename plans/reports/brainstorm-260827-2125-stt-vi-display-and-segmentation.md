---
type: brainstorm
date: 2026-08-27
slug: stt-vi-display-and-segmentation
status: contract accepted; Q1 and segmentation fork resolved by user 2026-08-27
mode: --ultra (best-of-5 + verifier); winner cand-5, 93.5/100
---

# STT investigation — Vietnamese display quality and turn segmentation

## Summary

User read a Vietnamese news paragraph into web `/translate`. Got 2 turns, an
all-lowercase unpunctuated transcript with spelled-out numbers, 2 recognition
errors, and a "Who spoke?" nag on both. saydi.ai returned one correctly
punctuated segment.

**Eight observed defects, four distinct problems, only one of which is an STT
accuracy problem.** The English translation was already correct — Gemini
repaired the transcript — which proves the content survived the recognizer and
only its _Vietnamese rendering_ is missing.

## Findings

### PROVEN — source level

| #        | Defect                                | Cause                                                                                                                                                                                                                     |
| -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2/D3/D4 | no ITN, no truecasing, no punctuation | `services/local-stt/engines/zipformer_vi.py` `postprocess()` is `strip().lower()` + capitalize one char. Zipformer-30M emits bare uppercase BPE. Absent by construction, documented in `docs/development-journey.md` §4.5 |
| D8       | "Who spoke? · 0 marked"               | Designed. Enrollment-free attribution measured 23.0% EER vs a 10% bar, 49.5% coverage vs an 80% floor; gate verdict KILL (`plans/reports/gate-260825-0905-*`); `TAU_SUGGEST` ships disabled                               |
| —        | MT layer not implicated               | Gemini prompt rule 4 repairs machine-transcript artifacts; English output produced "5:00 PM" / "zero point four meters" from the spelled-out Vietnamese                                                                   |

### PROVEN — measured this session

**M1. The split is the 8s ceiling, not the hangover.** Transpiled the repo's
real `SpeechGate` and drove it with a trace matching the reported reading
(~11s, commas at natural places):

| Run | Config                             | Result                                                                                     |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| A   | as shipped, `maxUtteranceMs: 8000` | **2 turns**, first closes `forced` at 8.62s                                                |
| B   | ceiling removed                    | **1 turn**, closes on hangover                                                             |
| C   | ceiling 15s                        | **1 turn**, closes on hangover                                                             |
| D   | sensitivity, no ceiling            | a mid-sentence pause must reach **500ms** to split; read-aloud commas (180–300ms) never do |

`MAX_UTTERANCE_MS = 8_000` at `apps/web/src/hooks/use-streaming-translate.ts:45`.
The gate arms at 7.5s looking for a quiet block, finds only speech, then hits
the hard ceiling and **cuts mid-word at exactly 8.0s of turn time**.
`capture-pump.ts` names this outcome itself: _"the turn is cut mid-word. Worse
for translation quality than a pause would be."_

This is **structural**: under an 8s ceiling any utterance >8s splits, however
cleanly spoken. The constant's own comment says it was sized to match the
extension — i.e. for conversational meeting turns, not read prose.

Corrects the earlier inference that the cut landed at the comma after "0,4 m".
It did not; the boundary landed mid-phrase, which better explains
`và điểm mưa lớn` → `Thời điểm mưa lớn` (D6): Gemini reconstructed a plausible
opening for a mid-word fragment.

Caveat: span durations are an estimate of the user's pace, so 8.62s is not their
exact cut point. The A-vs-B/C contrast and the 500ms threshold do not depend on it.

**M2. The benchmark structurally cannot score D2/D3/D4.** Counted raw
`hyp_text`/`ref_text` in `benchmarks/stt/results/r1/`, 50 vi utterances/engine:

| Source                         | uppercase              | punctuation | digits   |
| ------------------------------ | ---------------------- | ----------- | -------- |
| VIVOS reference                | 50/50 ALL-CAPS         | **0/50**    | **0/50** |
| sherpa-zipformer-vi (shipping) | 50/50                  | 0/50        | 0/50     |
| fw-phowhisper-vi               | **0/50 all lowercase** | 50/50       | **0/50** |

Stronger than the recorded §8 lesson (which blames WER _normalization_): the
ground truth itself carries no punctuation, casing or numerals, so there is no
label to score against. A correct `17:00` scored against `MƯỜI BẢY GIỜ` counts
as **three substitutions** — fixing D2 would make the headline 5.38% WER _worse_.
Any acceptance criterion needs a new reference set, not a re-scoring.

**M3. A PhoWhisper swap would not recover casing or ITN.** Contrary to a premise
stated early in this investigation: as measured in this repo, PhoWhisper emits
punctuation on 50/50 but is all-lowercase on 50/50 with zero digits. It fixes D4
only, at 0.332 RTF (failing the 0.3 gate) and 972MB vs 223MB. On the same
utterance Zipformer read `LỘ TRÌNH` correctly where PhoWhisper gave `loại trình`.
Caveat: may be a property of the `diepho/PhoWhisper-small-ct2` conversion or of
VIVOS audio; it is nonetheless the only PhoWhisper evidence this project owns.

**M4. No local engine in this repo has ever produced a digit.** ITN is
unreachable by swapping between measured engines.

### PLAUSIBLE — still unmeasured

- **U2 → D1** ("Ghi nhận lúc" lost). `PRE_ROLL_MS = 320` protects only ~0.32s
  before speech is confirmed and `MIN_SPEECH_MS = 120` must elapse first — but
  recognizer deletion is equally plausible. _Check:_ capture the raw turn WAV,
  run it through `benchmarks/stt` offline. Head present ⇒ capture chain; absent
  ⇒ recognizer.
- **U3 → D5** (`ngập`→`ngọt`, `đi gặp gặp`). Decoding is greedy with no beam and
  no biasing; sherpa-onnx transducers support `modified_beam_search` and
  `hotwords_file`/`hotwords_score`, both unused. Unproven that beam/biasing fixes
  _these_ errors, and unproven how much is browser AGC/noise-suppression damage
  rather than the model. _Check:_ the same offline-vs-live WAV diff, plus one
  benchmark run with beam search.

## Accepted contract (winner, cand-5)

**Outcome.** One Vietnamese display block reading as written Vietnamese —
`17:00`, `0,4 m`, `30 phút`, `Phạm Văn Bạch`, commas and terminal period —
beside the English already correct, and one speaker prompt instead of two. Raw
engine transcript one toggle away. Time-to-first-audio indistinguishable from
today: nothing on the audio critical path moves.

**Is "match saydi.ai" the right target?** No, and the thesis should say so.
saydi.ai transcribes a finished recording — large punctuating model, whole-file
sentence boundaries, full-file diarization clustering — none available to a
system emitting first translated audio at p50 1163ms. Chasing its _architecture_
is a category error. Chasing its _observable Vietnamese display quality_ is
legitimate. Chasing its automatic speaker labels was already measured and rejected.

**Constraints.** Latency is the product (p95 already misses its 1.8s target).
Local-first covers STT+TTS, not MT. Gemini requests-per-turn must stay 1 (quota
is request-metered, ~1000/day). Zipformer stays CC-BY-NC-ND academic-only.
Thesis integrity: an LLM-repaired display must be labelled, and the benchmark
must keep measuring the raw engine.

**Non-goals.** Diarization parity; any engine swap (PhoWhisper/Nemotron/Scribe);
dual-loading a second vi model; changing `SPEECH_HANGOVER_MS`/`PRE_ROLL_MS`/
`MAX_UTTERANCE_MS`; a local punctuation-restoration model (parked as A2);
reworking the translation prompt; retro-fixing WER normalization.

**Approaches.**

- **A1 (recommended)** — repair the Vietnamese display inside the existing Gemini
  call: second output field, streamed _after_ the English clause so TTS start is
  untouched. _Worst case:_ Gemini silently improves content, not just formatting —
  turning a mis-recognized `ngọt` into a confident `ngập` the user never said.
  An honesty cost, not just an engineering one; mitigated by labelling + raw toggle.
- **A2** — local restoration behind the `postprocess()` seam. Preserves local-first
  and is fully explainable in a thesis, but depends on a permissively-licensed
  Vietnamese punctuation model existing at CPU-affordable RTF (unverified);
  without it, delivers ITN + proper nouns and **not** punctuation.
- **A3** — `modified_beam_search` + hotword biasing, sharing one list with the
  unused Gemini `<context>` block. Addresses D5 only. A null result is still a
  publishable comparison-chapter row.

**Recommendation — sequence.**

- **P0 (measure, gates everything).** ~~Settle whether the cut is `forced` or
  `hangover`~~ — **resolved by M1: it is the ceiling.** Remaining: run the
  captured turn WAV through `benchmarks/stt` offline and diff against the live
  transcript, settling U2 and the capture-vs-model half of U3 in one command.
- **P1 — A1 display repair.** Build the display-fidelity set and record the zero
  baseline _first_, so the thesis has a before number. Fallback to raw on any MT
  failure, covered by a test.
- **P2 — display-only turn merge.** Adjacent forced-cut turns from the same
  unmarked speaker render as one Vietnamese block with one prompt. Translation
  turns unchanged; `cutForced` rate asserted unchanged.
- **P3 (optional)** — one benchmark run with beam search ± hotwords.

**Acceptance criteria.** New display-fidelity set (≥20 vi utterances with real
digits, punctuation, proper nouns) scored _without_ `normalize_text` on numeral
exact-match ≥0.85, punctuation F1 ≥0.70, proper-noun capitalization ≥0.80,
against a recorded ≈0 baseline. Reproduction passage renders `17:00`/`0,4 m`/
`Phạm Văn Bạch`, screenshotted beside saydi.ai for the comparison chapter.
VIVOS WER unchanged at 5.38% (±0.0) as a regression guard. STT stage ≈58ms;
e2e p95 ≤ 2983ms + 5%. Gemini requests/turn = 1. Test proving raw-transcript
fallback. Raw transcript reachable and visibly marked as distinct.

## Ranking appendix (not blended)

| Cand | Score | Best idea the winner lacks                                                                                                                 |
| ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 4    | 91.5  | Sharpest thesis-integrity counterargument to A1: an LLM-repaired transcript "stops being evidence of what the local STT can do"            |
| 2    | 90.0  | Phase 0 built purely from existing artifacts; a `không phải` must-NOT-convert corruption test                                              |
| 1    | 83.5  | Divergence guard — reject repairs >25% token edit distance from raw, covering MT _paraphrase_ (winner's fallback covers MT _failure_ only) |
| 3    | 83.0  | Carry `held` audio across a forced cut to actually recover the lost boundary word                                                          |

## Decisions taken (user, 2026-08-27)

- **Q1 resolved: YES to the LLM-repaired Vietnamese display (A1)**, labelled as
  normalized, raw engine output kept one toggle away and still the thing the
  benchmark measures. A2 (local restoration) stays parked as the follow-on if the
  cloud dependency is later judged a thesis weakness.
- **Segmentation: display-only merge (P2)**. Adjacent forced-cut turns from the
  same unmarked speaker render as one Vietnamese block with one speaker prompt.
  Translation turns unchanged, no VAD constant moves, `cutForced` rate asserted
  unchanged. The 8s ceiling stays as-is and is documented as right-censoring
  turn length.

### Carried forward from a runner-up, now that A1 is chosen

cand-1's **divergence guard** becomes relevant and is recommended for the plan:
reject a repaired display line whose token edit distance from the raw transcript
exceeds ~25%, falling back to raw. The accepted contract's fallback covers MT
_failure_ only; this covers MT _paraphrase_ — which is precisely A1's named worst
case (a mis-recognized `ngọt` silently becoming a confident `ngập`). Recorded here
as an addition for the plan to price, not merged into the contract above.

## Unresolved questions

1. **Metrics JSONL almost certainly does not exist** — `metrics-jsonl-sink.ts` is
   "off unless a path is configured". `turn-metrics.recorder.ts:149` also logs
   `cut=forced|hangover` to console. Confirming on the user's _actual_ audio
   needs either the api console from that run or a re-record with the sink path set.
2. **Who records the display-fidelity set** — the user's own voice and domain
   (matches the real capture chain, unpublishable) or a public punctuated
   Vietnamese corpus (comparable, but clean close-mic audio that flatters the
   system)? Changes what the numbers mean.
3. **Should saydi.ai's automatic "Speaker 01" be matched at all?** Would mean
   reversing a measured KILL on new evidence, or labelling without evidence.
   Belongs in the comparison chapter either way.
