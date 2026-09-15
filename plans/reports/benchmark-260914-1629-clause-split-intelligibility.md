---
title: 'Intelligibility on the path that ships — clause-split scoring'
date: 2026-09-14
harness: benchmarks/tts-vi/score_clause_split.py
results: benchmarks/tts-vi/results/clause-split/
parent: plans/reports/benchmark-260914-1135-zerotts-vs-vieneu.md
verdict: comparison unchanged; ZeroTTS's female arm loses 2.5-4pp on the shipped path
---

# Intelligibility on the path that ships

`run_engine.py` retains and scores whole-sentence audio.
`translation-session.service.ts` never synthesizes a whole sentence — it calls
`splitIntoClauses` and pushes one WAV per clause, back to back, no silence
inserted. So every WER figure in the main report describes audio no user hears.
This run scores the audio they do hear.

4 arms × 3 draws × 41 conversational sentences, PhoWhisper-small scoring.

## Outcome

**The engine comparison does not flip.** ZeroTTS stays ahead on both genders.

**But ZeroTTS's better-scoring voice gets measurably worse on the shipped path.**
`baotrang` loses 2.5–4.1pp of WER to clause splitting, in all three draws, with a
control that reads exactly zero. Nothing else separates.

Two byproducts, each touching an open question in the main report — one closes
it, one contradicts a claim it makes.

## How it was measured

Each sentence is synthesized three times in one process, one call apart: whole,
then clause-split (concatenated, matching `streamClauses`), then whole again as a
**control**. The control is the point of the design. A whole-versus-clause gap on
its own cannot be read, because VieNeu produces byte-different audio for
identical input — part of any gap would be the engine's own noise with no way to
see the shares. The control runs the same path twice and so measures what the
system does when _nothing changes at all_. An effect no larger than its control
is not an effect.

Measuring both paths in one process also removes the confound the main report
leaves open, where the same seed gave 5.75% in one call sequence and 6.98% in
another.

18 of the 41 sentences carry a single clause, where splitting is a no-op. They
stay in the corpus figure for comparability and are dropped from the
`split-affected` figure so the effect is not diluted by rows that cannot show one.

## Results

Corpus WER delta, clause minus whole. Negative means splitting helped.
"Separates" is the paired bootstrap over sentences, 95% CI excluding zero.

| Arm                 | split Δ mean |          range | control Δ mean | control range |  separates |
| ------------------- | -----------: | -------------: | -------------: | ------------: | ---------: |
| zerotts / baotrang  |  **+2.60pp** |  +1.23 … +4.11 |        −0.14pp | −0.62 … +0.41 | **2 of 3** |
| zerotts / quangminh |      −1.98pp |  −6.37 … +0.21 |        +0.14pp | −0.21 … +0.41 |     0 of 3 |
| vieneu / Mai Anh    |      +8.62pp | −2.05 … +25.05 |        +3.22pp | −2.87 … +7.80 |     0 of 3 |
| vieneu / Thanh Bình |      +0.00pp |  −6.37 … +3.29 |        +1.30pp | −3.29 … +6.98 |     0 of 3 |

On the 23 sentences that actually split:

| Arm                 | split Δ mean |         range |                control Δ mean |
| ------------------- | -----------: | ------------: | ----------------------------: |
| zerotts / baotrang  |  **+4.02pp** | +2.48 … +6.19 | **+0.00pp** (all three draws) |
| zerotts / quangminh |      −3.10pp | −9.91 … +0.31 |                       +0.10pp |
| vieneu / Mai Anh    |      −0.62pp | −5.88 … +4.95 |                       −1.34pp |
| vieneu / Thanh Bình |      +2.37pp | −8.05 … +9.60 |                       −4.23pp |

**`baotrang` is the one real effect.** Every draw is positive, the range clears
its control by an order of magnitude, and two of three draws separate under the
bootstrap. Clause splitting costs this voice roughly 4pp on the rows it touches.

**`quangminh` is not a second one.** Its mean is carried entirely by draw 11
(−9.91pp on affected rows). That draw's control was +0.41pp, so the audio
genuinely differed — this is not judge noise. But its bootstrap interval is
[−15.56, +0.79], spanning zero: real for those sentences, not robust to which
sentences are in the set. Two of its three draws sit at +0.31pp.

**Neither VieNeu arm can be measured.** No draw separates, and the intervals run
to ±25pp. The Mai Anh corpus mean of +8.62pp looks alarming and is not a finding:
it rests on draw 2 alone (+25.05pp, CI [−5.51, +75.06]), one of the wild runs the
main report already documents. VieNeu's own noise is larger than any splitting
effect this design could detect, so the honest statement is that **the shipped
path cannot be distinguished from the measured path for the incumbent** — not
that they are equal.

## What it means for the verdict

The intelligibility conclusion survives. ZeroTTS stays ahead on both genders and
nothing here reverses a sign.

What changes is the size of the female margin. The main report's headline pairs
`baotrang` against `Mai Anh`, and `baotrang` is the arm that pays for splitting.
Measured on the path that ships, its advantage is about 4pp smaller than the
whole-sentence figure implies. The male pair is unaffected.

Do not re-derive the engine gap from this run's absolute numbers. Three draws is
too few, and the main report's own seed sweep (8 draws) is the authority on level.
What this run measures well is the _paired delta between paths_, which is immune
to the draw being unrepresentative.

## Byproduct 1 — an open question closed

> _"ZeroTTS's output is reproducible for an identical call sequence at a fixed
> seed, but the same seed under a different sequence of preceding calls gave
> 5.75% in the main run against 6.98% in the seed sweep. Suspected ONNX Runtime
> state carried across calls in a process; not confirmed."_

**Not confirmed because it is not true.** ZeroTTS is byte-deterministic
regardless of call position:

- `scripts/check_call_position_determinism.py`: synthesizing the same text at
  position 1, again after an unrelated call, and again adjacent, gave identical
  SHA-256 digests **10 of 10** both ways.
- The retained probe run: `whole` versus `control` WAVs byte-identical **41 of
  41**, with two clause calls in between; and for single-clause sentences,
  `whole` versus `clause` identical **18 of 18**.

The engine is not the source of that discrepancy. Something else about the two
runs differed, and it is still unexplained.

## Byproduct 2 — a claim in the report that does not hold

> _"PhoWhisper is deterministic within a process (0/12 differences on a repeat
> pass) but 2 of 41 hypotheses differed between the two scoring processes."_

It is not deterministic within a process. Transcribing byte-identical audio in
one process (`judge_order.py`, run against the retained WAVs so no synthesis is
involved):

|                                            |    differed |
| ------------------------------------------ | ----------: |
| same file twice, back to back              | **1 of 41** |
| same file twice, one other clip in between | **2 of 41** |

So the within-process rate is comparable to the across-process rate the report
already records. An earlier 15-sentence probe here found 0 of 15 and agreed with
the report — the instability lives in specific sentences, and a small sample
misses them.

This is also what produced every nonzero control in the ZeroTTS rows. The audio
is identical, so those deltas are purely the judge. That makes the ZeroTTS
control a direct read of the judge's noise floor: **±0.6pp at corpus level.**

**One of the two unstable sentences is a code-switch row**, and it flips exactly
where that finding is measured:

```
conv-038  (same audio, same process)
  before: "có nhận thanh toán bằng visa hoặc master card không ạ."
  after : "đây có nhận thanh toán bằng vi da hoặc mát tơ cạt không ạ."
```

The code-switch CER gap rests on 9 sentences, measured on a single run. One of
those 9 transcribes either correctly or as garbage depending on nothing at all.
That subset needs repeats before any multiple is quoted from it.

## What this does not establish

- **The voice-selection confound is untouched.** ZeroTTS's voices were chosen for
  their "rõ ràng" labels, VieNeu's by listening for naturalness. This run
  compares paths within an arm; it says nothing about that asymmetry.
- **VieNeu's shipped path remains unmeasured, not measured-as-equal.** Its
  variance defeats the test.
- **Three draws per arm**, against the eight the main report's seed sweep uses.
  Adequate for a paired within-draw delta, not for absolute level.
- **Gaplessness is still not measured.** This run scores concatenated clause
  audio as if playback were seamless. Whether clause 2 arrives before clause 1
  finishes is a separate open item from the audit.

## Run notes

A first attempt ran two arms in parallel and was abandoned after 24 minutes
without completing a single draw: two engines at 8 intra-op threads each on 8
cores drove load to 30, and ONNX spin-wait burned the CPU on contention. Run
sequentially, a draw takes about 5 minutes. That attempt also lost its work
because `summary.json` was written once at the end; the script now checkpoints
after every draw and resumes.

## Unresolved questions

- If ZeroTTS is byte-deterministic at a fixed seed, what did differ between the
  main run's 5.75% and the seed sweep's 6.98%? The engine is now excluded, and
  judge noise at ±0.6pp does not cover a 1.2pp gap.
- Why does clause splitting cost `baotrang` 4pp when it costs `quangminh`
  nothing? A prosody or boundary artefact specific to that voice would be worth
  hearing before the MOS panel is designed.
- Should the code-switch subset be re-measured across draws, given one of its 9
  rows is judge-unstable in exactly the dimension being scored?
- Does the judge's within-process instability need a repeat-and-vote protocol, or
  is ±0.6pp small enough to leave alone now that it is quantified?
