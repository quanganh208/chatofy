---
title: 'The channel gate was armed, and two capture-time defects would have wasted the one-shot session'
date: 2026-09-01
summary: "Landed Phase 2's blocking harness; review found a bypassable DSP guard and a turn log indexing a timeline the WAV does not have"
---

# The channel gate was armed, and two capture-time defects would have wasted the one-shot session

## What happened

The plan's only phase with unfinished implementation work was the channel delta
gate — the measurement of what the browser's DSP chain does to a speaker
embedding. Its recording session is one-shot: three to five real people, once. If
the gate kills the feature nobody is recorded again. So the phase's own rule is
that everything about the protocol must be settled before anyone is in the room,
and this slice was that work.

The analysis script came first, and most of its defects were the same shape: an
operational failure wearing a result's clothes.

- It called itself "diagnostic, never a gate" and returned 0 from every path,
  including the absent-fixture path. A mis-pathed session exited clean with an
  empty report, which reads as "no delta detected".
- The verdict was one constant printing a binary answer where the accepted method
  is a three-way band.
- The gate bucket was pinned at 2.0s with a silent fallback to the worst bucket
  overall — so the moment M1 moved the turn length to 1.0s, which was the entire
  reason M1 ran, the verdict would have been read at a length nobody chose.
- Δ top-1, target-mean cosine and a per-turn CSV were absent, and two success
  criteria depended on the first two.
- Gating was pooled. With three to five voices, a pooled delta can sit inside the
  band while one participant's voice is destroyed, outvoted by the others' pairs.

Then the review found what mattered more.

## The two that would have wasted the session

**The guard was bypassable by the primary input path.** I had disabled the record
buttons on a constraint mismatch and called it an abort. Push-to-talk is bound to
the window — the recorder's own comment promotes the spacebar as the eyes-free
way to drive a session — and `startTurn()` never consulted a button. A refused
session would have recorded in full, by spacebar, under a red warning nobody was
looking at, and then been unsaveable because `finish` _was_ disabled.

I wrote that guard. I wrote the comment above it saying "abort rather than warn.
A red box above a working record button is a box somebody reads past with five
people waiting." And I left the one input path that skips buttons entirely
untouched, in the same file, forty lines below.

**The turn log indexed a timeline the WAV does not have.** Turns were stamped
from `AudioContext.currentTime`, and the analysis maps those milliseconds
straight onto sample offsets. The clock starts at context creation; sample zero
is the first worklet block, which arrives after `addModule` and after two
`getUserMedia` calls, one behind a permission prompt. On top of that fixed
offset, `downsampleToPcm16` emits `floor(1024/3) = 341` samples per block where
341.33 is exact, so the track advances at 15984.375 Hz against a clock running at
16000 — about a millisecond per second.

Both push the computed index past the audio it names. Late turns get sliced out
of the next speaker's words, and nothing raises, because the overrun check only
fires when the log runs off the end of the track. The outcome would have been
chance-level separation on _both_ tracks, a delta near zero, and a printed PASS
saying the corpus calibration survives the browser channel.

A false PASS is the one result this gate exists to make impossible. It is also
invisible in every aggregate the script prints, so the dry-run the phase already
schedules would not have caught it — that needs a listen-back confirming a late
turn contains the speaker the log names.

This one is pre-existing code, not something I introduced. But it sat inside the
blocking scope, and the whole point of the scope is that it is the last chance.

## Decision

Everything the review raised was fixed rather than deferred, because the deferral
horizon here is "after the session", and after the session there is nothing to
fix. That included two decisions the phase had left open:

**Do not pin the sample rate.** Production calls `new AudioContext()` with no
options and takes the OS default. Pinning 48 kHz in the recorder would make the
fixture measure a channel the product does not use — the exact failure the
constraint parity spec exists to prevent. So the rate is reported per session,
not asserted, which turns the plan's assumed 48→16k downsample into a per-machine
fact the session will establish rather than a premise it may assume.

**Gate on the shipping model only.** The screen measures two; Phase 5 settled
campplus. Taking the max across both would let an outlier in a model the product
does not ship STOP a delivery on a session nobody can record again.

## What I found that nobody asked for

`results/` is tracked. The per-turn CSV I had just added would have been
committed — one row per turn a real person spoke, from a session under a stated
destruction date. That is precisely the failure the phase had already caught in
the turn log ("the audio is destroyed, the retention step is logged as complete,
and each participant's device id remains in the repository"), reappearing in a
location nobody had named because the location did not exist until I made it.

The retention criterion now names four locations instead of three.

## Next steps

The harness is done and the gate is armed. The session is not, and it is the
thing the plan pivots on: Phase 6's ship decision reads its verdict. Consent and
the retention date are blocking prerequisites, and both are now enforced by the
recorder rather than written down — it will not open the microphone without a
destruction date.

Phase 7's M12–M14 remain unrun, with recorded reasons.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
