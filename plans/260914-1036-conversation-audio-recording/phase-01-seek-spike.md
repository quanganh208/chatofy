---
phase: 1
title: 'Phase 1: Measure blob seeking before designing the player'
status: partial
priority: P1
effort: '1h'
dependencies: []
---

# Phase 1: Measure blob seeking before designing the player

## Overview

Two facts decide whether the timestamp gutter is a **button** or **plain text**, and
neither can be answered by reading code. This phase answers them in a throwaway HTML page
before any repo file changes, because getting them wrong late means rebuilding the player.

The first is the one that matters. Chromium's `MediaRecorder` writes **no Duration** into
the WebM Segment Info header, so `audio.duration` on the resulting blob commonly reads
`Infinity` and setting `currentTime` can be refused outright. If seeking a `blob:`-backed
WebM does not work, click-to-seek — the feature that selected this whole design — does not
work either, and the gutter degrades to text.

## Requirements

Functional:

- Determine, per browser, whether a `blob:` URL from `MediaRecorder` output supports
  `currentTime` assignment, and what `audio.duration` reads immediately after load.
- Determine whether the known prime (`currentTime = 1e101`, await one `timeupdate`, then
  seek to the real target) rescues it when the direct assignment fails.
- Determine what `MediaRecorder.isTypeSupported` returns for
  `audio/webm;codecs=opus`, `audio/webm`, and `audio/mp4` on each target browser.
- Measure the real byte rate at `audioBitsPerSecond: 24_000` to confirm the ~3 kB/s
  assumption the 32 MB cap is derived from.

Non-functional:

- **No repository file changes.** This is a scratch page under the session scratchpad,
  not a committed fixture. Nothing here ships.

## Files

Owned by this phase: none in the repository.

Scratch only: a single self-contained HTML file in the session scratchpad directory,
opened directly from disk with `file://`.

## Steps

1. Write a scratch page with a Start/Stop button that opens the microphone with the same
   constraints the app uses (`echoCancellation`, `noiseSuppression`, `autoGainControl` all
   true — see `apps/web/src/lib/open-microphone.ts:60-64`), records with
   `audioBitsPerSecond: 24_000`, and on stop builds a `blob:` URL and an `<audio>` element.
2. Record for at least **2 minutes** — a short clip can seek when a long one cannot, so a
   10-second test proves nothing.
3. Log, on stop: the chosen mime type, `blob.size`, wall-clock duration, bytes per second,
   and `audio.duration` read immediately and again after `loadedmetadata`.
4. Attempt `audio.currentTime = 30`, read it back after one `timeupdate`, and record
   whether it took.
5. If it did not, apply the prime and repeat step 4.
6. Repeat the whole run on **Chromium, Firefox and Safari**. Safari is in scope by user
   decision and is the one most likely to need `audio/mp4`.

## Validation

- A table of results per browser: supported mime types, `duration` reading, whether direct
  seek works, whether the prime rescues it, and measured bytes/second.
- The measured byte rate is compared against the 3 kB/s the 32 MB cap assumes. A rate
  materially above it means the cap buys less time than the plan claims and open question
  1 in `plan.md` must be settled before Phase 2.

## Risk and rollback

No risk: nothing in the repository changes and there is nothing to roll back.

## What each outcome changes downstream

| Outcome                          | Effect                                                                                                                                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct seek works everywhere     | Phase 5 ships the gutter as a button, as designed. Nothing changes.                                                                                                                                                                          |
| Seek needs the prime             | Phase 5's player hook gains the prime — roughly five lines, contained in one file.                                                                                                                                                           |
| Seek fails even with the prime   | The gutter ships as **plain text**, `onSeek` is not wired, and the scrubber becomes position-only. The rest of the plan is unaffected; the report already names this as the second-cheapest thing to abandon.                                |
| Safari supports only `audio/mp4` | Phase 4's `isTypeSupported` candidate list must put `audio/mp4` ahead of the WebM entries on that browser, and Phase 3's sniff must accept `ftyp`. Both are already planned; this only confirms they are load-bearing rather than defensive. |
| Duration reads `Infinity`        | Confirms `audioDurationMs` must be stored rather than derived — already planned in Phase 2, and this is the evidence for the column's docblock.                                                                                              |
