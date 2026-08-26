---
title: Checkpoint 1 returned KILL for per-turn speaker attribution
date: 2026-08-24
summary: 'eres2netv2 at 23.0% EER against a 10% bar, and dead-zone coverage 49.5% against an 80% requirement. Audited two ways before reporting; a naive bench would have said MARGINAL.'
---

# Checkpoint 1 returned KILL for per-turn speaker attribution

eres2netv2 at 23.0% EER against a 10% bar, and dead-zone coverage 49.5% against an 80% requirement. Audited two ways before reporting; a naive bench would have said MARGINAL.

## The result

`run_pairwise.py`, 100,044 embeddings over VoxVietnam's 150-speaker test split, ~80 min.

Gate cell (far-field, 2s), against PASS <=10% / KILL >15%:

| model        | clean 2s | far-field 2s |
| ------------ | -------- | ------------ |
| eres2netv2   | 21.1%    | **23.0%**    |
| campplus     | 20.5%    | **23.1%**    |
| wespeaker_en | 31.3%    | **34.8%**    |

**KILL.** And the dead zone is worse than the EER: 0.278 wide, swallowing 47% of same-speaker and
54% of different-speaker turns. Coverage 49.5% against Phase 4's >=80%. Even a perfect clustering
algorithm downstream leaves half the turns unattributed.

## Auditing a verdict that ends the feature

A KILL is the expensive direction to get wrong, so it got the scrutiny reserved for suspiciously
good numbers. Two doubts, both concrete, both tested rather than argued.

**Did the truncation window do it?** The screen takes each clip's first n seconds and BYPASSES
`segment.py` — which the plan explicitly requires, and which exists for exactly this reason.
VoxVietnam is in-the-wild YouTube and TikTok, so clips can open with music or silence. Measured:
clip starts are almost all speech (leading window a median 4% quieter than the loudest window; only
4% of clips more than 50% quieter), and switching to the loudest window moves EER 18.7% -> 18.4%.
Bounded at 0.3 points against a 13-point shortfall. The bypass is still a real methodological gap —
a speech gate would also drop non-speech WITHIN a window — but it cannot be the explanation.

**Did the pair rigour do it?** Yes, and this is the most useful number of the day. Sampling with no
gap rule gives **14.3%**; the gap>=25 rule gives 20.1% on the same subset. Channel inflation is
worth 5.8 EER points. A bench that had paired naively would have reported MARGINAL and sent us to
the TEN VAD remediation lever instead of stopping. The rigour changed the verdict — and even the
inflated 14.3% fails the 10% bar, so it sharpened the conclusion rather than manufacturing it.

**Every known bias points the same way.** Negatives are matched on nothing (Vietnam-Celeb-H matches
gender AND dialect, which is harder); no browser DSP anywhere; residual same-video pairs would
inflate further. The true number is at least this bad.

## What actually failed

Not the models' ability to hear speakers — eres2netv2 separates same from different by +0.30 mean
cosine. What fails is **variance**: at +-0.21 the same-speaker distribution's lower tail reaches
deep into the non-target one. "Right on average, unreliable per turn" is precisely the regime where
per-turn attribution collapses while enrollment or longer-context approaches could still work.

That distinction decides which options are worth re-opening, which is why it belongs in the record
rather than a bare KILL.

## Bugs found and fixed while building this

- **Hand-rolled acoustics were wrong.** An image-source RIR implementation had RT60 tracking the
  array bound at ~0.75x array length, barely responding to wall absorption — it was measuring its
  own array size. Caught by sweeping parameters, not by tests: acoustics has no analytic oracle the
  way EER does. Replaced with pyroomacoustics, local version deleted rather than patched.
- **Coherent reflection louder than the direct path.** Source and mic both sat on the room's centre
  line, so side-wall reflections summed. `apply_rir` aligned on `argmax` and put the direct arrival
  ~200 samples late. Fixed by moving the geometry off-centre AND by detecting the first significant
  arrival instead of the loudest.
- **`np.convolve` with a 13,800-tap RIR** roughly doubled the screen's wall time. `fftconvolve` is
  15x faster and numerically identical (3e-7).
- **Block-buffered stdout** meant an 80-minute run showed an empty log throughout, making a stalled
  run indistinguishable from a slow one. `flush=True` on the progress line.
- **`pkill -f run_pairwise.py` killed its own shell**, because the command string contained the
  pattern. The process-management rule warns about exactly this.

## Where this leaves the plan

Phase 4 must not start — the plan forbids it after a KILL. The decision goes to the user with the
options the contract named: named enrollment, a longer-turn UX, or labels declared best-effort.
Phase 5's latency work stands regardless. Phase 7's channel delta is now moot unless an option
revives the feature.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
