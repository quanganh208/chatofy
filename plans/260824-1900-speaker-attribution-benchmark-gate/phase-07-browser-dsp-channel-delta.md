---
title: 'Phase 7: Browser-DSP channel delta (diagnostic)'
status: ready-to-record
phase: 7
priority: P3
effort: '1-2d effort; elapsed gated on participant scheduling'
dependencies: [3]
---

# Phase 7: Browser-DSP channel delta (diagnostic)

## Overview

Measure how far the **browser audio channel** moves the EER that Phases 3-4 measured on public
corpus data. A self-recorded far-field session through the real browser path, with per-turn ground
truth.

**Demoted from Phase 1, and deliberately.** This work originally produced the primary fixture and
blocked every later phase on scheduling 3-5 people. Public Vietnamese speaker corpora
(`plans/reports/research-260824-2132-vietnamese-speaker-corpora.md`) turn out to give a far stronger
model screen — 120 speakers and 55k gender-and-dialect-matched trial pairs against 3-5 participants —
so Checkpoint 1 no longer needs anyone recorded. What corpora cannot supply is production's DSP
chain, and that is the one thing this phase now exists to measure.

**Runs only if Checkpoint 1 passes.** If the gate kills the feature on corpus data, nobody is ever
recorded. That ordering is the whole point of the demotion: the expensive, calendar-bound,
privacy-laden step now sits behind the cheap decisive one.

**It is a diagnostic, not a gate.** It reports a delta and a warning if the delta is large; it never
returns a non-zero exit that stops the plan. What it can do is invalidate the thresholds Phase 4
calibrated — if the channel moves EER materially, the shipped tau values must be re-derived on
channel-matched audio, and the gate report says so.

## Requirements

**Functional**

- [ ] A recording page captures audio with the exact production constraint set
- [ ] Per-turn ground truth (who spoke, when) exists without post-hoc hand-labeling
- [ ] Both distances (0.5m, 2m) present, with speakers moving between them
- [ ] A **paired DSP-off control track** recorded simultaneously (diagnostic, see Architecture)

**Non-functional**

- [ ] Recording artifacts gitignored (they are large and contain participants' voices)
- [ ] Fetch script idempotent, matching `services/local-stt/scripts/download_models.py` style

## Architecture

**The channel is the whole point.** Production audio is not raw microphone — it passes through three
browser DSP stages that are all explicitly enabled at
`apps/web/src/hooks/use-streaming-translate.ts:109-117`:

```js
audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
```

Noise suppression and AGC both reshape voice timbre, which is exactly what a speaker embedding
measures. A fixture recorded with a voice-recorder app (44.1k, no DSP) would describe a channel the
product never sees — and every threshold derived from it would be worthless while the bench still
reported a healthy number. This is the most likely silent failure in the whole plan.

So: record through a page that calls `getUserMedia` with that identical constraint object. Reuse the
worklet-based capture already in `packages/realtime-client/src/audio/microphone-graph.ts` if it can
be driven standalone; otherwise replicate its downsample-to-16k path (`pcm-resampler.ts`).

**Record the DSP-off control at the same time.** If Phase 3's EER comes out badly, there are two very
different explanations with opposite responses: the model is wrong for Vietnamese, or the channel's
noise suppression has flattened the very differences an embedding reads. Separating them needs an
otherwise-identical recording without the DSP — and that can only be captured here, at recording
time. Leaving it to Phase 3 would mean re-convening the participants.

One stream cannot be both processed and raw, but nothing requires one stream: browser audio
processing is applied **per track**, so a second concurrent `getUserMedia` call requesting
`{echoCancellation: false, noiseSuppression: false, autoGainControl: false}` yields the unprocessed
path from the same microphone at the same moment. Write both WAVs against a single shared turn log
and the control is genuinely paired, at nearly no cost during recording.

Verify the raw track really is raw rather than assuming it: compare the AGC envelopes of the two
WAVs across the loud-then-quiet check. Some OS or driver-level processing sits _below_ the browser
and would appear in both — if the platform will not hand over a raw track, fall back to a short
back-to-back 5-minute DSP-off session as an approximate, unpaired control, and say so in the report.

The control is **diagnostic only**. It never gates anything.

**Ground truth without hand-labeling.** 25 minutes of free conversation has no per-turn labels, and
labeling afterwards is slow and ambiguous wherever people overlap. Instead the recorder shows whose
turn it is and logs each turn's start/stop with the speaker id. Scripted alternation is
representative rather than a cheat: half-duplex production _is_ turn-based
(`capture-pump.ts` `awaiting-result`).

## Related Code Files

- Create: `benchmarks/speaker-id/recorder/index.html` — capture page, prod constraint set + paired DSP-off track, turn prompt + shared log
- Create: `benchmarks/speaker-id/recorder/serve.mjs` — static server (getUserMedia needs a secure context; localhost qualifies)
- Create: `benchmarks/speaker-id/fixtures/.gitignore` — ignore recorded audio
- Read (do not modify): `apps/web/src/hooks/use-streaming-translate.ts`, `packages/realtime-client/src/audio/microphone-graph.ts`, `packages/realtime-client/src/audio/pcm-resampler.ts`

## Implementation Steps

1. Build the recorder page: `getUserMedia` with the exact constraint object copied from
   `use-streaming-translate.ts`; capture via AudioWorklet; downsample to 16k mono; write WAV.
2. Add the turn prompter: shows the next speaker id from an order sheet, records
   `{turnIndex, speakerId, startMs, endMs, distance}` to a JSON sidecar on each start/stop.
3. Add a distance field to the prompter so 0.5m and 2m turns are labeled, and script the order sheet
   so each speaker appears at both distances with temporal spread.
4. Open the second, DSP-off stream and write it as a parallel WAV sharing the same turn log.
5. Serve over localhost and dry-run alone for 2 minutes. Confirm: WAVs are 16k mono; the JSON log
   aligns with the audio; `track.getSettings()` reports `echoCancellation`, `noiseSuppression` and
   `autoGainControl` all true on the primary track and all false on the control; and a
   loud-then-quiet passage shows an AGC envelope on the primary that is absent from the control.
   If the envelopes match, the raw track is not raw — take the fallback in Architecture.
6. Hand the participants the protocol (below) and record.

## Recording protocol (give to participants before recording)

- **One 10–15 min session is now enough.** The two-session protocol existed to give Phase 4 a
  session-level split; Phase 4 now takes that split from corpus speakers instead. What this phase
  needs is same-speaker pairs through the browser channel, which one session supplies.
- 3+ people, the actual laptop that will run the product, 0.5–2m. Fewer people is acceptable here
  than it would have been for a model screen: this measures a channel, not a model.
- Follow the on-screen turn prompt. Mix read sentences and free speech.
- Everyone speaks at **both** distances, spread across the session — the delta must not be
  confounded with a distance effect, so both distances need same-speaker pairs on both tracks.
- Both languages if the participants are bilingual; otherwise vi is sufficient — the channel delta
  this phase measures is a property of the microphone path, not of the language.

## Success Criteria

- [ ] WAV(s) at 16k mono, recorded through the prod `getUserMedia` constraint set
- [ ] Paired DSP-off control WAV written against the same turn log, and verified genuinely raw
      (or the unpaired fallback taken and recorded as such)
- [ ] `track.getSettings()` output captured in the artifacts as evidence of the active constraints
- [ ] Turn-log JSON aligns with audio; spot-checked on ≥10 random turns
- [ ] ≥3 speakers, ≥10 min total, each speaker present at both distances
- [ ] Same-speaker pairs exist for every speaker on BOTH the processed and control tracks
- [ ] EER delta processed-vs-control reported per duration bucket, with the Phase 3 corpus number
      alongside it for scale
- [ ] Recorded audio gitignored

## Risk Assessment

- **Wrong channel (highest).** Signal: recorded sample rate ≠ 16k after downsample, or a spectrogram
  showing none of the DSP artifacts. Response: re-record. The whole phase measures the channel, so a
  wrong channel makes it measure nothing — though it no longer poisons Phases 3-4, which is exactly
  what the demotion bought.
- **Ground truth drifts from audio.** Signal: spot-check misalignment >200ms. Response: fix the
  logging clock (use the AudioContext clock, not wall time) and re-record.
- **The delta is large.** Signal: processed-track EER materially worse than the corpus number at the
  same duration. Response: this does not fail the gate, but Phase 4's calibrated tau values were
  derived on a channel the product does not use and must be re-derived here. The gate report states
  which channel each shipped threshold came from.
- **Nobody is available at all.** Signal: no session scheduled. Response: the gate can still be
  reported, with the channel delta recorded as UNMEASURED and the thresholds flagged as
  corpus-calibrated. That is weaker, and the report must say so rather than imply coverage.
- **Platform refuses a genuinely raw track.** Signal: AGC envelopes match between the two WAVs.
  Response: take the unpaired 5-minute fallback; do not silently treat a processed track as a
  control, which would make this phase's whole comparison answer the wrong question.
- **Calendar, not effort.** The 1-2d estimate is work; elapsed time depends on scheduling 3-5 people
  (twice, under the preferred protocol). Signal: recording slips. Response: this is expected and is
  not plan slippage — Phases 2 and 5 are deliberately independent so they proceed meanwhile.

## Progress — tooling built, recording not yet done

Steps 1-5 are implemented and verified as far as they can be without a
microphone and participants. Step 6 is the recording session and is yours.

**Built**

- `recorder/index.html` — opens two concurrent `getUserMedia` streams from one
  microphone: production's constraint object copied verbatim from
  `use-streaming-translate.ts`, and the DSP-off control. Both feed one
  `AudioContext` so their sample clocks agree and a single turn log indexes
  both. Downsamples to 16k mono PCM16, writes two WAVs plus a turn-log JSON.
- `recorder/serve.mjs` — localhost static server on a fixed port 4317.
  `/worklets/` maps to `packages/realtime-client/worklets/` rather than a copy,
  so the capture path cannot drift from production's without someone noticing.
- `speaker_bench/channel.py` + `tests/test_channel.py` — turn-log parsing and
  pairing, 16 tests.
- `run_channel_delta.py` — scores both tracks and reports the delta per bucket.

**Verified without a recording**

- Server serves the page, serves the worklet from the package, refuses traversal.
- The page's script parses; the constraint objects match the production source.
- Turn-log validation refuses the failure modes that would otherwise yield a
  number: a control whose `noiseSuppression` is still true (the phase's whole
  premise gone, and the delta would read zero for the wrong reason), tracks
  recorded the wrong way round, a 44.1k log meaning no downsample happened,
  overlapping turns, and a log whose turns run past the audio.

**Not verified, and cannot be from here**

- Whether the platform actually hands over a raw second track. The page's
  loud-then-quiet check answers this at recording time by comparing AGC
  envelopes; if they match, take the unpaired fallback in Architecture above.
- Turn-log-to-audio alignment on real audio (spot-check ≥10 turns).

**Deviation from the plan's file list.** `fixtures/.gitignore` was written and
then removed: `benchmarks/speaker-id/.gitignore` already ignores `fixtures/` and
deliberately re-includes `fixtures/**/*.json` so turn logs stay tracked while
audio does not. A nested ignore listing `*.json` would have silently dropped the
ground-truth metadata this phase produces.

**How to record**

```
node benchmarks/speaker-id/recorder/serve.mjs      # http://localhost:4317
```

Set the speaker count, open the microphone, confirm the constraint table reads
true/true/true and false/false/false, run the loud-then-quiet check, then follow
the prompter (hold the button or the space bar while speaking). Finish
downloads three files; move them into `benchmarks/speaker-id/fixtures/`. Then:

```
uv run --directory benchmarks/speaker-id python run_channel_delta.py --session s1
```

**What the result means.** Read the delta, not the absolute EER — one session
means one room and one microphone, and same-speaker pairs that share both, which
is exactly what the corpus screen worked to avoid. Above 5 points at the 2s
bucket, the thresholds the enrolled mode passed with were calibrated on a channel
the product does not use and must be re-derived here.
