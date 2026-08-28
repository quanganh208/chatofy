---
title: "Decoder comparison: beam bought nothing, and the ceiling wasn't one"
date: 2026-08-28
summary: 'Three vi decode arms measured; beam is a null result, hotwords gained 0.72 pt but the arm cannot measure a ceiling'
---

# Decoder comparison: beam bought nothing, and the ceiling wasn't one

## What happened

Ran Phase 6 of the vi transcript plan: three decode arms over the existing
50-utterance VIVOS vi set, same session, model files / INT8 / `num_threads: 8`
held fixed so only the decoder varied.

| Arm                  | WER % | CER % | RTF    |
| -------------------- | ----- | ----- | ------ |
| greedy (control)     | 5.38  | 2.90  | 0.0158 |
| modified_beam_search | 5.38  | 2.94  | 0.0207 |
| beam + 48 hotwords   | 4.66  | 2.73  | 0.0211 |

**Beam search is a null result.** WER identical to the digit, CER 0.04 pt worse,
1.31x the compute. It changed 3 of 50 utterances: one better, one worse, one
trading one error for another. Publishing that is the point — staying greedy is
now evidence-backed instead of an unexamined default.

**Hotwords gained 0.72 pt WER** (measured against the beam arm so the decoder is
held constant): 3 changed, 3 improved, 0 regressed, every gain traceable to a
list phrase in that utterance's reference.

All three arms sit ~14x inside the RTF 0.3 gate. Cost was never why the engine
decodes greedily, and is not a reason to move.

## Three things I got wrong and had to fix

**1. The hotword arm cannot measure a ceiling — I called it one anyway.** The
list caps at 48 phrases taken in _manifest order_. 81 pairs qualify, so the 33
discarded are simply the ones appearing late in the file. Measured consequence:
24 of 50 utterances carry a phrase, 16 would be biased if the cap were lifted,
10 never qualified. **Sixteen utterances sat inside the "ceiling" arm as an
unbiased control**, which makes -0.72 pt a _lower_ bound on an oracle, not an
upper one. The review caught the class of error and undercounted it (said 17
utterances); the real figure is 26 unbiased, 16 of them purely from truncation.

**2. "The control reproduces r1 exactly" was aggregate-only.** WER and CER match,
but 2 of 50 hypotheses differ in offsetting directions — which is _why_ the
corpus number lands on 5.38 twice. r1 logged 0.952 s load / 223.3 MB against this
run's 0.531 s / 211.4 MB; r1 and r2 are identical to each other on all 50, so it
is cross-session drift, not nondeterminism. At 2 utterances that is the same
order as the 3 the beam arm moved — which is the real argument for a same-session
control, and stronger than the RTF argument I originally wrote.

**3. I wrote dead code and a test that could not fail.** `select_hotwords` had a
`seen` dedup set, but a phrase reachable twice has both syllables occurring
twice, which makes them non-hapax and disqualifies the pair first — unreachable.
The test named after it asserted `[]` for a fixture with no hapax syllables at
all, so it passed for an unrelated reason and would have passed with the logic
deleted. Found it myself while re-reading; confirmed by running both variants
over the real corpus (identical output) before touching any write-up.

## Decision

Promote nothing. `services/local-stt/engines/zipformer_vi.py` still decodes
greedily. The arms carry their own engine ids under their own run tag, so r1/r2
are neither overwritten nor re-scored.

Kept the 48 cap: it mirrors `MAX_HOTWORDS = 48` in the MT prompt builder, so one
user vocabulary could feed both the recognizer and the translation context. That
is the right choice for a _shippable_ list; measuring a true ceiling wants all 81
and is a different run.

Tracked `data/hotwords-vi.txt` (one negation in a `data/*` pattern — a negation
cannot re-include a file under an excluded _directory_). `decode_params` records
only a filename, so without it the input behind 4.66 WER was not recoverable from
the repo.

## Next steps

Phases 2 and 3 both need the user's own voice through the browser capture chain
and cannot proceed without it. Phase 3 would settle whether the reported
`ngập`->`ngọt` errors are the model or the capture chain; this run adds weak
evidence for the capture chain, since on clean close-mic audio a 4x wider search
finds nothing better.

Two open questions worth a line in the thesis: r1/r2 record no platform or
library version, and the 12 MB / 0.42 s gap says the environment differed — the
result header should carry both. And whether a ceiling arm should use all 81
phrases rather than a shippable 48 is a product call, not a benchmark outcome.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
