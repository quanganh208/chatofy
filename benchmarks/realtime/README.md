# Realtime harness

Fixtures and analysis for the turn-taking path: how well capture keeps up, how far a
translation falls behind the speaker, and what a run costs in metered requests.

Everything here is plain Node with no dependencies. Nothing is committed except the
scripts — audio and metrics are regenerated.

| Script                   | What it produces                                                    |
| ------------------------ | ------------------------------------------------------------------- |
| `generate-fixtures.mjs`  | Synthesized Vietnamese turns, chosen for the shape of their pauses  |
| `vad-reference.mjs`      | Speech duration of a recording — the **denominator** of coverage    |
| `analyze-continuous.mjs` | Coverage, drift, requests-per-minute per model, from the JSONL sink |

## Coverage, and the one way it lies

Coverage is `Σ capturedMs / speechMs`. Both halves have a trap in them, and both are
guarded here rather than left to whoever reads the number.

**The denominator must not come from `SpeechGate`.** `vad-reference.mjs` deliberately
shares no reasoning with it: a threshold derived from the whole file's energy
distribution, with hysteresis and minimum-duration rules, where the gate uses a
streaming adaptive floor. Offline analysis can use statistics over the entire
recording; a realtime gate structurally cannot. If the denominator came from the gate,
speech the gate missed would leave both numerator and denominator — and a gate that
heard nothing at all would score 100%.

**The numerator must include every turn.** `capturedMs` is summed over all outcomes,
including `rejected`, `dropped` and `error`. Turns that never played were still
captured. Counting only the ones that played measures the success rate of playback, and
that figure goes _up_ as the pipeline breaks.

## Typical run

```bash
# Once, needs the TTS sidecar on :8003
node benchmarks/realtime/generate-fixtures.mjs

# The denominator, from the recording itself
node benchmarks/realtime/vad-reference.mjs path/to/meeting-3min.wav
node benchmarks/realtime/vad-reference.mjs --manifest        # every fixture

# The run. Needs TURN_METRICS_PATH set on the api. From the extension it also
# needs "Report timings for measurement" ticked in the popup — either one missing
# and half of every row is absent. From the web client there is nothing to tick:
# it always sends the rows, and the api decides whether they land.
node benchmarks/realtime/analyze-continuous.mjs turns.jsonl --speech-ms 174300
```

## Reading the output

- **Requests per minute is per model and must not be summed.** The free tier meters
  per model, so either of the two flash-lite models can be exhausted while a combined
  figure looks healthy.
- **Rows marked incomplete are usually quota.** Expected at this request rate until key
  rotation exists. Report the count and say it was expected, or a later reader will
  hunt for a fault that was never there.
- **A climbing drift line is a finding, not a failure.** Capturing continuously while
  playing turns back to back means utilisation is ~100% before overhead; one turn on
  the p95 tail pushes every later turn back permanently.

## Checking a device for the acoustic loop (web, loudspeaker)

The web client keeps the microphone open while the translation plays. That is only
safe while the loudspeaker does not reach the microphone, which is a property of the
machine — so it is checked per device, and it cannot be automated: it needs a room, a
loudspeaker, and a person talking.

Nothing to switch on in the client. The `heard during playback` counter appears next
to the level meter the moment it leaves zero, and per-turn rows are always sent; where
they land is the server's decision:

```bash
# apps/api/.env
TURN_METRICS_PATH=benchmarks/realtime/turns.jsonl
```

Twenty turns at the volume and distance the device will actually be used at,
different sentences each time — self-triggering depends on what is being played, so
repeating one sentence measures that sentence. **Pass is a counter that never
appears.** What it counts is `SpeechGate.onSpeechStart` firing while our own audio is
audible.

**Say nothing while the translation plays, for all twenty.** The counter is not an
echo detector and cannot be one: web runs full duplex, so the microphone is honoured
throughout the window and a person talking over the playback confirms that gate
exactly as the loudspeaker would. Barge-in is the feature working — but during this
protocol it is indistinguishable from the failure being measured, so it has to be
kept out of the run. A count taken while someone talked over the audio measures
nothing. Same for a noisy room: some of it is the room.

Record beside the result, or the next run cannot be compared with this one: speaker
volume, mic-to-speaker distance, and the device. Record the observed `session_busy`
count too — a server-side guard can suppress turns for reasons that have nothing to
do with echo.

There is no half-duplex control arm on the web client any more, so the count is not a
difference against a baseline. Confirm a non-zero count by reading the transcript — a
loop writes the app's own translation back into it, unmistakably, and that is what
tells an acoustic loop apart from the two benign ways this number moves.

**Read a failure one way only.** A desktop with separate speakers and only software
AEC is the hardest case: failing there says nothing about a laptop with hardware
cancellation or a phone held to the ear, and must not be written up as closing the
full-duplex direction. A device that fails is a device to run through headphones.

## What committing early would buy, and what it would cost

Two questions the analyzer and the adequacy harness answer separately:

```bash
# how much listener wait clause-level commitment would remove, per turn
node benchmarks/realtime/analyze-continuous.mjs turns.jsonl --speech-ms N

# what it would cost in translation quality (spends Gemini quota — dry run first)
node benchmarks/live-translate/segment-vs-whole.mjs --limit 12
node benchmarks/live-translate/segment-vs-whole.mjs --limit 12 --run
uv run python benchmarks/live-translate/score-segments.py results/<stamp>/segments.jsonl
```

The saving is reported over EVERY turn, not only the long ones, and against several
candidate commit points — the point of the table is to choose one, and a share of
turns past an arbitrary line answers a different question. Turns the ceiling cut are
right-censored, so the saving is understated by however much those turns had left.
