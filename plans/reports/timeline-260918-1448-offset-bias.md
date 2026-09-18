# Transcript `offsetMs` lands after speech onset — decomposition

Conversations `cmu4edytm001201pcn1uh8w8d` (53 turns, 270.5s) and
`cmu4e61b4000001pce79sfxa5` (32 turns, 110.9s), both read from the production database.

## Does the player compensate? Yes — verified end to end

This was the open question, so it goes first. **The seek is compensated, not just the
displayed string.** `apps/web/src/components/history/history-transcript.tsx:56` computes

```
const at = mediaOffset(turn.offsetMs, audioOffsetMs);
```

and that same `at` is what reaches both the label (`formatOffset(at)`, line 79) and the
seek (`onClick={() => onSeek(at)}`, line 74). `onSeek` is `player.seekTo`
(`conversation-detail.tsx:219`), which assigns `audio.currentTime = ms / 1000` with no
further adjustment (`use-conversation-player.ts:206`). One variable, both uses — the
inverse of the bug `transcript-time.ts:52` records, and it holds.

So the user-visible seek error is **+217ms**, not +388ms, and a large part of the original
complaint was measurement error. The remaining +217ms is real and worth fixing.

## Headline

The measured **+388ms is not the bias a reader experiences**. 171ms of it is a term the
player already subtracts. `/history` never seeks to the stored `offsetMs`; it seeks to
`mediaOffset(offsetMs, audioOffsetMs)` — `apps/web/src/lib/transcript-time.ts:66` via
`apps/web/src/components/history/history-transcript.tsx:56` — and this conversation's
`Conversation.audioOffsetMs` is **171**, read from the production backup at
`scratchpad/prod-backup-260918-1424.sql:235`.

Against the number actually fed to the player the bias is **+217ms median, p10 +180,
p90 +695**. That is still late, and the cause is real, but a fix calibrated on 388 would
overshoot by 171ms.

Two of the 55 rows in `turns_db.tsv` are excluded from the latency sample, and the reason
matters. They are not contamination: the file is a faithful dump of the live table, which
holds 55 rows. Positions 0 (`offsetMs` 171) and 54 (`offsetMs` 263771) were inserted by
hand to restore the head and tail utterances the pipeline had lost, after the backup
`prod-backup-260918-1424.sql` — which still shows 53 — was taken. Position 0's offset
equalling `audioOffsetMs` is the value chosen for that backfill, not the field leaking
into the file. They are excluded because a hand-written row carries no gate latency and so
cannot measure it; the remaining 53 are pipeline output — verified identical, offset for
offset, to the pre-backfill backup. That exclusion is what moves the drift fit from a
spurious 437 ppm to 89 ppm, and the rest of this report uses those 53. The two rows remain
legitimate data for acoustic and segmentation analysis.

## Decomposition

All values are medians against "true onset" as the brief defines it (20ms RMS frames,
threshold 0.008). Reproduced independently in `scratchpad/conv/final.py`.

| Term                                                                                                                             | ms                           | Proof                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate confirmation — `MIN_SPEECH_MS` rounded up to whole blocks                                                                   | **+127.9**                   | `speech-gate.ts:49` (120ms) needs 6 blocks of 21.3125ms; block size from `capture-pump.ts:259` over `mic-capture-processor.js:16` (1024 @ 48k) decimated by `pcm-resampler.ts:36` to 341 @ 16k. Measured spread p10 = p90 = 127.9 — exact, not statistical. |
| Onset → first block the gate calls speech                                                                                        | **+17.2**                    | `speech-gate.ts:157` thresholds at `noiseFloor + 0.018` over a floor of at least 0.004 (`speech-gate.ts:52,55`) ≈ 0.022, against the measurement's 0.008. Half a block of quantization plus the level ramp between the two thresholds.                      |
| Capture pipeline constant — AudioContext input buffer, `postMessage` hop, main-thread scheduling, plus `MediaRecorder` start lag | **+52.3**                    | Linear fit intercept on the 50 clean residuals. Bounded independently: `audioDurationMs` 270646 vs 270539ms decoded = 107ms, of which drift explains 24ms, leaving ~83ms for start lag plus stop lag.                                                       |
| Capture clock drift, 89 ppm                                                                                                      | **+12** at the 135s midpoint | Same fit, slope +0.089 ms/s. The recorder's media clock runs slow against `Date.now()`.                                                                                                                                                                     |
| **Sum**                                                                                                                          | **+209.4**                   |                                                                                                                                                                                                                                                             |
| **Measured**                                                                                                                     | **+217.0**                   |                                                                                                                                                                                                                                                             |

**7.6ms unexplained**, which is under one block. I am treating that as closed.

The raw +388 is this +217 plus the +171 `audioOffsetMs` that `mediaOffset` already removes.

### The p90 is mostly not the system

`stored_media − onset` has p90 +695, but the residual against a faithful gate simulation
has p90 only **+88.1**. The tail lives entirely in the term "first speech block − true
onset" (p90 +537.6): on some turns the 0.008 definition fires on a breath or a soft
fricative hundreds of ms before the gate's 0.022 is crossed. The system's own bias is
near-constant; the spread is an artifact of the two thresholds disagreeing about where a
sentence begins.

## Does it generalize? The system terms do; the acoustic one does not

Repeated on `cmu4e61b4000001pce79sfxa5` (`audioOffsetMs = 151`, 110977ms of audio).
Recording fetched from the public bucket base `R2_PUBLIC_BASE_URL`, decoded with
`scratchpad/conv/decode2.py`, analysed with `scratchpad/conv/final2.py`.

| Term                                      | Conv 1 (270s)      | Conv 2 (111s)      |
| ----------------------------------------- | ------------------ | ------------------ |
| Gate confirmation                         | +127.9 (p10 = p90) | +127.9 (p10 = p90) |
| Residual: pipeline constant + drift       | +66.9              | +69.9              |
| **System subtotal**                       | **+194.8**         | **+197.8**         |
| Onset → first block the gate calls speech | +17.2              | **+205.4**         |
| **Total vs onset**                        | **+217.0**         | **+317.0**         |

**The system-attributable bias is +196ms, reproducible to within 3ms across two sessions.**
That is the fixable part, and it is a systematic pipeline delay exactly as suspected.

**The acoustic term is not constant and cannot be fixed by a constant.** It moved from
17ms to 205ms between two conversations recorded four minutes apart on the same device.
It is the gap between "audible" (0.008) and "loud enough for the gate" (0.022), and it
depends on the room, the speaker and where the adaptive floor happens to sit. This is the
strongest argument for option B below: a tuned constant cannot absorb a term with that
spread, but the 320ms pre-roll can, because the pre-roll is _actual audio_ containing that
quiet onset rather than an estimate of it.

A caution on your inference from `audioOffsetMs` being 151 and 171: those two values being
close does **not** support the 217ms being systematic, because `audioOffsetMs` is a
different quantity and is already subtracted before any of this bias is measured. It is
the `getUserMedia` round trip (`use-streaming-translate.ts:434` → `use-conversation-recording.ts:128`),
and its consistency only says the microphone opens in ~160ms on this device with
permission pre-granted. The generalisation evidence is the table above, not those two
numbers.

### The duration shortfall is a constant, not drift

`audioDurationMs` minus the decoded length is **107ms over 270.6s** and **98ms over
111.0s** — near-equal in absolute terms across a 2.4x difference in length, so it is
dominated by a fixed cost, not a rate. Solving the two together gives a constant of
**~86ms** (recorder start lag plus stop lag) and a rate of ~85 ppm, which matches the
per-turn residual slopes independently measured at 89 and 80 ppm. Both conversations,
two independent methods, one answer.

## Do the two timelines share an origin?

**No, and the code says so explicitly.** Recording t=0 is the first sample
`MediaRecorder` writes. `offsetMs` t=0 is `conversation.startedAt`, stamped at
`use-streaming-translate.ts:434` before `session.start()`. Between them sit `getUserMedia`,
the recorder construction and `recorder.start()`.

The gap is measured, stored, and subtracted — this is the compensation, and it works:

- `use-conversation-recording.ts:128` stamps `startedAtMs` **before** `new MediaRecorder`
  (line 142) and `recorder.start()` (line 176), deliberately, so the timestamps survive a
  recorder that fails to construct.
- `recordingOffsetMs` (`transcript-time.ts:82`) computes `recordingStartedAtMs − startedAt`.
- It is uploaded (`use-conversation-audio-upload.ts:169`), persisted
  (`prisma-conversation.store.ts:488`), and subtracted on both screens through the single
  `mediaOffset`.

**Drift is variable, and it is the one part not compensated.** `audioOffsetMs` is one
constant captured at start. But the residual grows +0.089 ms/s across the session, and
`audioDurationMs` (270646, wall clock) exceeds the decoded recording (270539) by 107ms.
The capture clock is slow against `Date.now()`. At this rate a one-hour conversation would
end ~320ms further out of alignment than it began. It is a second-order term today.

What `audioOffsetMs` does **not** cover is the residual +52ms: it is stamped before the
recorder starts, so the recorder's own start lag lands inside the correction with the
wrong sign — it inflates `audioDurationMs` and leaves a constant in the seek.

## What is already compensated — do not double-count

1. **`audioOffsetMs` = 171ms.** Subtracted at display and at seek. Any fix must be
   measured against +217, not +388.
2. **The audio itself is already corrected.** `PRE_ROLL_MS = 320` (`capture-pump.ts:22`)
   exists because "without this the first syllable of every turn would already be gone".
   The pre-roll is prepended to the turn's audio at `turn-pipeline.ts:256`.
3. **`formatOffset` floors seconds** (`transcript-time.ts:34`) and documents why: "a line
   that begins at 5.9s and reads 0:06 sends the player past its own first syllable". The
   displayed string already leans early; the _seek_ does not.

Item 2 is the actual defect. **The pre-roll corrects the audio and not the timestamp.**
A turn's stored offset points 320ms after the first sample that turn contains.

## Fix options

### A — subtract the pre-roll inside `openTurn`

`turn-pipeline.ts:247` becomes `openedAt: this.now() - preRollMs`, derived from the blocks
in hand.

**Rejected.** `openedAt` is not only a display timestamp. `display-groups.ts:95` merges
blocks on `nextCapture.openedAt − previousCapture.closedAt` against `MAX_CAPTURE_GAP_MS =
1200`, and **refuses to merge on a negative gap** (line 96). Moving every `openedAt` 320ms
earlier shrinks every measured gap by 320ms, so turns 1.4s apart would start merging; and
back-to-back turns after a forced cut could go negative and refuse a merge that should
happen. It would also shift the stall watchdog (`turn-pipeline.ts:459`) and lengthen every
turn in the metrics rows.

### B — carry `preRollMs` on the capture record, subtract it in `displayGroupOffsetMs`

Recommended. `openTurn` already receives `preRoll` (`turn-pipeline.ts:238`); record its
duration on the captured-turn record alongside `openedAt`/`closedAt`
(`turn-pipeline.ts:364`), and subtract it at `conversation-turns.ts:166`.

- Grouping, the watchdog, ordering and metrics keep the unchanged `openedAt`.
- Both screens are corrected by one edit, because both already route through this one
  function — the invariant `transcript-time.ts:52` records as a shipped bug when it was
  violated.
- Derived from the blocks actually handed over, not from the constant. That matters:
  `closeTurn` clears the pre-roll (`capture-pump.ts:320`), and `capture-pump.ts:150`
  documents a state where a turn opens with an empty one. A hard-coded 320 would invent a
  correction for a turn that has no pre-roll to correct.
- Residual after the fix: 217 − 320 ≈ **−103ms**, i.e. slightly early. That is the correct
  side to land on by this repo's own stated rule (`transcript-time.ts:26`: "Early is
  recoverable by listening; late has already cut the word off"), and it is bounded by the
  pre-roll rather than by a tuned constant.

### C — subtract a measured constant (~217ms) at the stamp site

Rejected. It encodes a device-specific pipeline latency and this machine's gate timing as
a literal, and it re-derives what `PRE_ROLL_MS` already asserts.

I would take **B**, and leave the +52ms pipeline constant and the 89 ppm drift alone: both
are far under the one-second floor of the displayed string, and 52ms of seek error is not
audible next to the 128ms that B removes.

### Invariants a naive "subtract 380ms" would break

1. **Double-counting `audioOffsetMs`** — 171ms of the 388 is already gone by the time
   anyone seeks.
2. **The clamp at `Math.max(0, …)`** (`conversation-turns.ts:166`) exists for clock
   disagreement, not for a deliberate subtraction. A flat 380ms would push several distinct
   early turns onto 0, and they would all render `0:00` — losing ordering the gutter
   carries. B's correction is bounded by the pre-roll actually held, so the first turn of a
   conversation shifts by at most what it recorded.
3. **The write schema refuses negatives** — `offsetMs: z.number().int().min(0)`
   (`packages/types/src/domain/conversation.ts:68`). Only the clamp stands between a
   subtraction and a 400 that loses the whole save.
4. **One function feeds both screens.** `displayGroupOffsetMs` is called by the live
   transcript (`conversation-transcript.tsx:267`) and by the save projection
   (`conversation-turns.ts:88`). Correcting at either call site instead of inside it
   reopens the live/history disagreement `transcript-time.ts:52` says already shipped once.
5. **`openedAt` is load-bearing for grouping** — see option A.

### Tests that would have to change

- `packages/realtime-client/src/state/conversation-turns.spec.ts` — covers
  `displayGroupOffsetMs` directly; every expected offset moves by the fixture's pre-roll,
  and fixtures need the new field.
- `packages/realtime-client/src/conversation/turn-pipeline.spec.ts` — the captured-turn
  record gains a field.
- `apps/web/src/components/transcript-time-parity.spec.tsx` — the live/history parity
  gate. It should keep passing unchanged; if it does not, the correction was applied on one
  side only, which is exactly what it exists to catch.
- `apps/web/src/hooks/use-conversation-save.spec.tsx` and
  `apps/api/.../conversations.service.spec.ts` — fixture offsets only.

No change is needed in `history-transcript.spec.tsx` or `use-conversation-audio-upload.spec.tsx`:
the `audioOffsetMs` path is correct and untouched.

## Decided, and out of scope for this fix

1. **The 89 ppm drift is accepted, uncorrected.** Twelve milliseconds at the midpoint is
   two orders below the one-second floor `formatOffset` already imposes, and correcting it
   would mean a second time model for no reader-visible gain. The duration evidence
   supports leaving it: the shortfall is dominated by a ~86ms constant, not by the rate.
2. **The pipeline constant is device-dependent, and is stated as such rather than
   generalised.** It replicates across the two conversations (+66.9 and +69.9), but both
   came from one machine within ten minutes. The AudioContext is built with no
   `latencyHint` (`use-streaming-translate.ts:289`), so a device with a larger input buffer
   carries a larger constant. Option B does not depend on its value, which is part of why
   it is the recommendation.

## Follow-up, needing a decision that is not this fix's to make

**Existing rows are not repaired.** Option B corrects conversations saved after it ships;
the two production conversations that have recordings keep their late offsets. A backfill
would mean applying a constant to rows whose real pre-roll is unknown, and it is a data
migration — it needs the owner's decision and a backup taken first. Recorded here as a
follow-up, deliberately not planned as part of the fix.

## Correction to the original report of this bug

The seek was described as landing ~0.4s late. It does not. `mediaOffset`
(`transcript-time.ts:66`) subtracts `audioOffsetMs` for the displayed number and the seek
alike, so the user-visible error is +217ms, and 171ms of the reported 388ms was an artifact
of comparing the stored column against recording-relative time without applying the field
that exists to bridge them.
