---
title: 'Continuous capture — measurement runbook'
type: runbook
status: awaiting-execution
created: 2026-07-30
plan: ../260729-2306-extension-continuous-capture/plan.md
---

# Continuous capture — measurement runbook

Phases 1–7 are implemented and every automated gate is green. This document is the
part that cannot be run without a browser, a loudspeaker and real API quota.

**Read this first:** the numbers below are the evidence the feature is defended with.
Several of them are expected to come out badly, and that is fine — a drift line that
climbs and turns that fail on quota are results, not faults. What is not fine is
adjusting a measurement until it looks better. Every place that can happen is called
out where it applies.

## Before anything

```bash
# 1. Speech sidecars and the api. All three, not just `pnpm dev`.
pnpm dev:all

# 2. Point the metrics sink somewhere. Nothing is recorded without this.
#    Set it in apps/api/.env, then restart the api.
TURN_METRICS_PATH=./benchmarks/realtime/turns.jsonl

# 3. Fixtures, if you have not generated them before (needs the TTS sidecar).
node benchmarks/realtime/generate-fixtures.mjs

# 4. Build the extension.
pnpm --filter extension build
#    Chrome → chrome://extensions → Developer mode → Load unpacked
#           → apps/extension/.output/chrome-mv3

# 5. In the extension popup, tick "Report timings for measurement".
#    Without it the client sends nothing and half of every row is missing.
```

Record, for the report: machine, OS, Chrome version, output device, and whether the
microphone permission was granted. An echo count of zero means two different things
depending on that last one.

---

## Measurement 1 — capture coverage

**Question.** Of the speech in the recording, how much did the extension actually
send? Target ≥ 95%.

Use a **fixed recording**, not a live meeting. Every number here has to be
reproducible, and a live call is not.

```bash
# Prepare a 3-minute and a 5-minute continuous English conversation. Few pauses;
# the point is that silence alone never ends a turn.

# The DENOMINATOR. Run this on the recording file itself.
node benchmarks/realtime/vad-reference.mjs path/to/meeting-3min.wav
```

Then play the recording into a Meet tab (a second browser profile joining the same
call, sharing the file as tab audio, is the simplest rig), capture it with the
extension for the full duration, and:

```bash
node benchmarks/realtime/analyze-continuous.mjs \
  benchmarks/realtime/turns.jsonl --speech-ms <speechMs from step above>
```

**The two ways this measurement lies, both already guarded:**

- Taking the denominator from the gate's own output. Then speech the gate missed
  leaves both numerator and denominator, and a gate that heard nothing scores 100%.
  `vad-reference.mjs` shares no reasoning with `SpeechGate` for exactly this reason —
  do not substitute anything else for it.
- Summing only turns that played. That measures the success rate of playback, and it
  improves when the pipeline breaks. The script sums every `outcome`; if you compute
  coverage by hand, do the same.

If coverage comes out above 100%, something is wrong with the measurement rather than
right with the code. The script says so.

---

## Measurement 2 — drift, and whether it grows

**Question.** How far behind the speaker does the translation run, and does that gap
stay flat or climb?

Read from the same run as measurement 1. The script prints the median drift over the
minute ending at 1, 3 and 5 minutes, and a flat/climbing verdict. Use the 5-minute
recording for this one — 3 minutes is not long enough for a queue to visibly grow.

A climbing line is an expected outcome, not a bug: playing turns back to back while
capturing continuously means utilisation is ~100% before any overhead, so one turn
hitting the p95 tail pushes every later turn back permanently. Report it as the
finding it is, with the numbers.

---

## Measurement 3 — requests per minute, per model

**Question.** How close to the free-tier ceiling does this run, per model?

Printed by the same script. **Both models are expected to exceed 15/min.** The
arithmetic was known before any code was written: at ~7.5 turns/min,
`gemini-3.5-flash-lite` takes the live translations plus one final each
(≈30/min against 15) and `gemini-3.1-flash-lite` takes up to 4 speculations
(≈30/min against 15).

Two things follow, and both belong in the report:

- Turns will fail on quota. The rows are written with `completed: false`, so they are
  countable. Say how many, and say that it was expected — otherwise a later reader
  will hunt for a fault that was never there.
- Do not add the two models together. The free tier meters per model, so either can be
  exhausted while a combined figure looks healthy.

**Measure this on the FIRST run of the day**, before spending quota on anything else,
so you know how many runs are left. And schedule measurement runs on a different day
from any demo.

---

## Measurement 4 — echo through a loudspeaker

**Question.** How much of the translation comes back through the user's own
microphone?

This is the constraint the extension cannot fix, only quantify. Run it **twice** over
3 minutes:

1. **Headphones** — the control. Expect 0.
2. **Loudspeaker** — the real question.

The count is in the `echoEvents` line of the analysis output.

Record with it: **loudspeaker volume, microphone-to-speaker distance, and the
device.** Without those the next measurement cannot be compared to this one, which is
the lesson already written down in `development-journey.md` §10 item 1. A zero from a
denied microphone permission looks identical to a genuine zero, so note whether it was
granted.

---

## Measurement 5 — sidecar oversubscription, across sockets

**Question.** How far can the concurrency ceilings go before the sidecars slow every
turn down together?

Measure sidecar RTF at **1, 2 and 3 sockets × 3 turns**, not 3 turns on one socket.
Those answer different questions, and the multi-socket one is the open debt
(`development-journey.md` §10 item 4): the STT and TTS sidecars are one shared process
each, so two sockets at three turns apiece is six concurrent inferences with no
per-socket ceiling touched.

Then tune, in `apps/api/src/modules/translate/session/turn-concurrency.ts`:

- `MAX_CONCURRENT_TURNS_PER_SOCKET` (currently 3)
- `MAX_CONCURRENT_TURNS_GLOBAL` (currently 6)

**Raising either raises the memory bound by the same factor.** RTF describes CPU and
says nothing about memory, and every open turn buffers its own audio up to
`MAX_TURN_BYTES`. `turn-concurrency.spec.ts` pins the current figures (5.76 MB per
turn, 17.28 MB per socket, 34.56 MB at the global ceiling) and will fail if you change
a ceiling — that failure is the point. Update the numbers _and_ the reasoning on the
constants; do not re-derive the expectation from the new ceiling.

Also revisit `MAX_UTTERANCE_MS` in `apps/extension/entrypoints/offscreen/main.ts`. The
8s ceiling was derived from the constraint, not from measured speech. The analysis
output's mean and p95 turn length are what should settle it.

---

## Manual checks that are not measurements

Confirm on **each** of Meet, Zoom web, and Messenger web:

- [ ] Load unpacked succeeds with no manifest warning
- [ ] Start captures the tab; the meeting audio is still audible (capture mutes the
      tab, so the extension replaying it is what keeps it audible — silence here means
      the replay path is broken, not the translator)
- [ ] A translation of someone else's speech is heard
- [ ] The original ducks while a translation plays and comes back afterwards
- [ ] Ducking does **not** stick — leave it running through a busy stretch and confirm
      the original returns to full volume
- [ ] 3 minutes continuous with no restart
- [ ] Overlay shows the transcript and does not break the site's layout
- [ ] The capture indicator is visible for the whole session with no way to dismiss it
- [ ] `document.querySelector('#chatofy-overlay-host').shadowRoot` is `null` from the
      page console — a closed shadow root is what keeps a private transcript out of
      reach of the site's own scripts
- [ ] The popup shows the recording notice on a fresh profile, once
- [ ] Opening the popup on a Zoom **desktop** app tab explains why it cannot work

Also confirm `apps/web`'s own `/translate` page still behaves as it did — one turn at
a time, microphone muted while a translation plays. It is a graded surface and its
behaviour was deliberately left unchanged; the automated suite covers the event
sequence, but a manual turn is worth doing once.

---

## Writing it up

Create `plans/reports/measure-{date}-continuous-capture.md` with:

- Conditions: machine, OS, Chrome version, output device, loudspeaker volume,
  microphone distance, whether the microphone was granted, which recording, the date
- Each measurement above, with its number and the command that produced it
- Turns that failed on quota, counted, and stated as an expected consequence
- Whether the drift line was flat or climbing
- Any ceiling you changed, with the new reasoning written onto the constant

## Unresolved

1. The 8s turn ceiling is derived from the constraint, not from measured speech.
   Measurement 5's turn-length figures are what should correct it.
2. Whether the thesis demo runs on a live call or a replayed recording. It does not
   block anything, but it changes what fixtures need preparing.
3. Both concurrency ceilings are provisional pending measurement 5.
4. API key rotation was deliberately deferred until after these measurements. Until it
   exists, the quota failures in measurement 3 are the expected result rather than
   something to fix first.
