---
title: 'Phase 1: Fixture acquisition and recording harness'
status: todo
phase: 1
priority: P1
effort: '1-2d effort; elapsed gated on participant scheduling'
dependencies: []
---

# Phase 1: Fixture acquisition and recording harness

## Overview

Produce the fixture corpus every later phase measures against: a self-recorded far-field session
captured through the **real browser audio path**, with per-turn ground truth, plus the public
corpora used for a-priori threshold calibration.

## Requirements

**Functional**

- [ ] A recording page captures audio with the exact production constraint set
- [ ] Per-turn ground truth (who spoke, when) exists without post-hoc hand-labeling
- [ ] Both distances (0.5m, 2m) present, with speakers moving between them
- [ ] A **paired DSP-off control track** recorded simultaneously (diagnostic, see Architecture)
- [ ] VIVOS (vi) and LibriSpeech test-clean (en) fetched and normalized to 16k mono

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
- Create: `benchmarks/speaker-id/scripts/fetch_corpora.py` — VIVOS + LibriSpeech test-clean, idempotent
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
7. Write `fetch_corpora.py`: VIVOS from the HuggingFace mirror `AILAB-VNUHCM/vivos` (the official
   AILAB link is unreliable) and LibriSpeech `test-clean`; normalize both to 16k mono WAV.

## Recording protocol (give to participants before recording)

- **2 × 12–15 min sessions**, different day or reshuffled seating, in preference to 1 × 25 min.
  Same total effort, and it yields a genuine session-level split for Phase 4. Not a blocker — if
  only one session is recorded, Phase 4's temporal split is the floor.
- 3–5 people, the actual laptop that will run the product, 0.5–2m.
- Follow the on-screen turn prompt. Mix read sentences and free speech.
- Everyone speaks at **both** distances, spread across the session — Phase 3 needs same-speaker
  pairs that are temporally distant _and_ cross-position, or its EER comes out falsely low.
- Both languages if the participants are bilingual; otherwise vi is sufficient (the en side is
  covered by LibriSpeech).

## Success Criteria

- [ ] WAV(s) at 16k mono, recorded through the prod `getUserMedia` constraint set
- [ ] Paired DSP-off control WAV written against the same turn log, and verified genuinely raw
      (or the unpaired fallback taken and recorded as such)
- [ ] `track.getSettings()` output captured in the artifacts as evidence of the active constraints
- [ ] Turn-log JSON aligns with audio; spot-checked on ≥10 random turns
- [ ] ≥3 speakers, ≥20 min total, each speaker present at both distances
- [ ] Same-speaker pairs separated by ≥5 min exist for every speaker
- [ ] VIVOS + LibriSpeech test-clean fetched, 16k mono, re-runnable
- [ ] Recorded audio gitignored

## Risk Assessment

- **Wrong channel (highest).** Signal: recorded sample rate ≠ 16k after downsample, or a spectrogram
  showing none of the DSP artifacts. Response: re-record — do not proceed, every later number
  inherits this.
- **Ground truth drifts from audio.** Signal: spot-check misalignment >200ms. Response: fix the
  logging clock (use the AudioContext clock, not wall time) and re-record.
- **Participants can't do 2 sessions.** Signal: user declines. Response: proceed with one; Phase 4
  runs the temporal split only and the plan says so explicitly.
- **VIVOS unavailable.** Signal: fetch 404s. Response: use the HuggingFace mirror first; failing
  that, substitute another VN corpus (the VLSP clips in `benchmarks/realtime/fixtures/` are a
  fallback, though far smaller). Record the substitution in the gate report — it weakens the
  a-priori calibration Phase 4's primary protocol depends on.
- **Platform refuses a genuinely raw track.** Signal: AGC envelopes match between the two WAVs.
  Response: take the unpaired 5-minute fallback; do not silently treat a processed track as a
  control, which would make Phase 3's diagnostic branch answer the wrong question.
- **Calendar, not effort.** The 1-2d estimate is work; elapsed time depends on scheduling 3-5 people
  (twice, under the preferred protocol). Signal: recording slips. Response: this is expected and is
  not plan slippage — Phases 2 and 5 are deliberately independent so they proceed meanwhile.
