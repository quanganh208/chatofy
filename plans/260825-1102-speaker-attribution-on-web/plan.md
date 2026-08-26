---
title: 'Speaker attribution on web'
description: 'Per-turn speaker identity on /translate for 3-5 people sharing one device: a non-acoustic substrate that is always correct, then an acoustic suggestion layer gated on a channel measurement.'
status: blocked
priority: P1
effort: '5-8d effort; the final phase is gated on a recording session'
tags: [speaker-id, web, local-stt, gated]
created: 2026-08-25
blockedBy: [260824-1900-speaker-attribution-benchmark-gate]
blocks: []
---

# Speaker attribution on web

## Overview

The `/translate` transcript today shows no speaker at all. `speakerRole` exists in the contract but
is derived purely from the translation direction (`turn-session.ts`
`direction === 'vi_to_en' ? 'speaker_a' : 'speaker_b'`), and direction is a session-level toggle
that is `disabled` while running — so every turn in a session carries the same role, and
`ConversationTranscript` never renders it. This plan gives the transcript a real per-turn speaker.

Accepted contract:
`plans/reports/brainstorm-260825-1041-speaker-attribution-web-integration.md`. Measured evidence:
`plans/reports/gate-260825-0905-speaker-attribution-benchmark.md` and
`plans/reports/bench-260825-0928-online-attribution-session.md`.

**The shape follows from what was measured.** Per-turn attribution from audio alone is reliable
only when every participant has enrolled, and the system cannot tell from audio when that condition
is violated. So the acoustic layer can never be the thing that decides a label — it can only
suggest one. Phases 1-3 build a substrate that is correct without any model. Phases 4-6 layer
suggestions on top, default off.

**Two rules hold the whole design up.** In a live conversation nobody watches the screen, so an
uncorrected wrong suggestion is indistinguishable from truth — which is how a suggestion layer
silently becomes the failure it was meant to avoid:

1. Suggested and confirmed labels are visually distinct.
2. **Only a confirmed turn updates a centroid.** An unconfirmed suggestion must never seed the model
   that produces the next suggestion, or one early error self-reinforces.

With both, the acoustic layer's floor is exactly Phase 2's behaviour.

Rule 2 protects the centroids from unreviewed suggestions. Nothing protects the _evidence_ from
them, which is why Phase 3 counts unreviewed suggestions as their own bucket rather than folding
them into "accepted" — a metric that reads healthy precisely because nobody looked would certify
the failure it exists to catch.

## Goals

| #   | Goal                                                              | Priority |
| --- | ----------------------------------------------------------------- | -------- |
| 1   | Every turn labelled correctly, or correctable in one tap          | P1       |
| 2   | Attribution works with no model, no sidecar change, no threshold  | P1       |
| 3   | Tap rate and correction rate observable from the first session    | P1       |
| 4   | Acoustic suggestions available, off until the channel is measured | P2       |
| 5   | End-to-end turn latency delta ≈ 0, measured on the prod container | P1       |
| 6   | `apps/extension` and `apps/mobile` behaviour unchanged            | P1       |

## Phases

| #   | Phase                                                                                         | Status                                               |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | [Phase 1: Speaker roster and identity state](./phase-01-speaker-roster-and-identity-state.md) | **Completed**                                        |
| 2   | [Phase 2: Roster and per-turn speaker chip](./phase-02-roster-and-per-turn-speaker-chip.md)   | **Completed**                                        |
| 3   | [Phase 3: Attribution instrumentation](./phase-03-attribution-instrumentation.md)             | **Completed**                                        |
| 4   | [Phase 4: Speaker embedding endpoint](./phase-04-speaker-embedding-endpoint.md)               | **Completed**                                        |
| 5   | [Phase 5: Suggestion engine in the API](./phase-05-suggestion-engine-in-the-api.md)           | **Completed**                                        |
| 6   | [Phase 6: Enable the acoustic layer](./phase-06-enable-the-acoustic-layer.md)                 | **Blocked** — waits on the browser-channel recording |

Dependencies: 1 → 2 → 3; 4 ∥ 1-3 (independent, touches only the sidecar); 4 → 5 → 6.
Phase 6 additionally blocks on Phase 7 of `260824-1900-speaker-attribution-benchmark-gate`.

**Phases 1-3 ship a complete, useful feature on their own.** That is deliberate, not a staging
convenience: if the channel measurement never happens, or comes back badly, the product still has
per-turn attribution that is right every time. Phases 4-6 make it require fewer taps.

## The dependency on the benchmark plan

`260824-1900-speaker-attribution-benchmark-gate` Phase 7 measures what production's
`noiseSuppression` and `autoGainControl` do to the embeddings. Every threshold this plan would ship
(`tau_assign` 0.350, `tau_new` 0.150) was calibrated on corpus audio that passed through neither.
The gap is double: the bench far-field was also pyroomacoustics-simulated.

That measurement gates **Phase 6 only**. Nothing in Phases 1-5 depends on it — not the roster, not
the wire event, not `/embed`, not the centroid state. If the 2s delta exceeds ~5 points, what
expires is the two threshold values, not the architecture; recalibrate on browser-channel
recordings before flipping the flag.

**With no date for that recording session, Phase 6 does not happen and the product is Phases 1-3.**
That is an acceptable end state, not a failure.

## Settled by measurement — not open for redesign

- **Longer turns are dead.** 2s → 5s buys 1.6 accuracy points.
- **Acoustic guest detection is dead.** Best far-field session-level detection is 36.5% at a 5%
  false-alarm rate (AUC 0.774). A person who has not been added is handled by a manual control, and
  the only open question is where that control lives.
- **The chip must not drive the translation direction.** Tempting, because `DirectionToggle` is
  `disabled` while running and two-way conversation currently requires restarting the session per
  flip. But a missed tap would then select the wrong STT engine and produce a garbage transcript.
  A labelling miss must never become a translation failure.
- **campplus, not eres2netv2.** Decided by Phase 5 latency, not accuracy: 82% headroom at the
  2-decode architectural ceiling against 28%, for an accuracy difference of 1.2 points that sits
  inside the noise.

## Success Criteria

- [ ] Every turn in a running session carries a speaker label, or is correctable to one in a single tap
- [ ] A turn nobody attributed carries an honest fallback label, never a fabricated identity
- [ ] `speakerRoleSchema` and `transcriptSegmentSchema` are unchanged; the embedding arrives on a distinct additive event
- [ ] `apps/extension` and `apps/mobile` build and pass with no source change
- [ ] No voiceprint is written to disk, and none survives the session
- [ ] Tap rate is readable after a session, and suggestions are reported in three buckets —
      confirmed-matching, corrected, unreviewed — so silence cannot read as success
- [ ] End-to-end turn latency delta ≈ 0 measured on the prod container, with the number recorded
- [ ] Gemini requests per turn unchanged

<!-- slug: speaker-attribution-on-web -->
