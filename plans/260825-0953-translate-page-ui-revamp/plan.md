---
title: 'translate page ui revamp'
description: 'Settings surface on /translate: voice on/off, gender, voice, volume, speed, transcript layout'
status: pending
priority: P1
effort: ''
tags: [web, ui, tts, wire-contract]
created: 2026-08-25
---

# translate page ui revamp

## Overview

`/translate` today hardcodes the speaking experience: gender is the only voice
knob, there is no volume, no speed, no way to turn speech off, and the transcript
has one fixed layout. This plan adds a persistent settings surface controlling six
things, in three slices ordered by risk — client-only first, wire contract second,
voice catalog last.

Contract, evidence and rejected alternatives:
[`plans/reports/brainstorm-260825-0937-translate-page-ui-revamp.md`](../reports/brainstorm-260825-0937-translate-page-ui-revamp.md)

**Scope held at all six knobs.** No `--yagni`; nothing trimmed.

## Goals

| #   | Goal                                                                              | Priority |
| --- | --------------------------------------------------------------------------------- | -------- |
| 1   | Voice output on/off, gender, specific voice, volume, speed — all user-selectable  | P1       |
| 2   | Transcript readable as two columns or stacked list, user's choice                 | P1       |
| 3   | Every choice persists across reload; a stale/corrupt value degrades, never breaks | P1       |
| 4   | No new hardcoded speaking behaviour left in `cascade-panel.tsx`                   | P2       |

## Phases

| #   | Phase                                                                                           | Status  |
| --- | ----------------------------------------------------------------------------------------------- | ------- |
| 1   | [Phase 1: UI primitives and settings store](./phase-01-start.md)                                | Pending |
| 2   | [Phase 2: Settings surface and volume](./phase-02-settings-surface-and-volume.md)               | Pending |
| 3   | [Phase 3: Transcript layout setting](./phase-03-transcript-layout-setting.md)                   | Pending |
| 4   | [Phase 4: Wire voice output toggle and speed](./phase-04-wire-voice-output-toggle-and-speed.md) | Pending |
| 5   | [Phase 5: Voice catalog and picker](./phase-05-voice-catalog-and-picker.md)                     | Pending |

Dependencies: 2←1 · 3←1,2 · 4←1,2 · 5←4

Phases 1-3 are client-only (slice 1). Phase 4 is the wire slice. Phase 5 is the
catalog slice and the natural cut line under scope pressure. Phases 3 and 4 are
mutually independent and could run in parallel; only
`translate-settings-panel.tsx` is shared, one row each.

## Architecture

```
apps/web/app/translate/page.tsx
  └─ holds settings (useTranslateSettings)          ← phase 1
     ├─ TranslateSettingsPanel                      ← phase 2
     │    Switch(voiceOutput) Segmented(gender|speed|layout) Slider(volume) Select(voice)
     ├─ CascadePanel ── start({direction, voiceGender, voiceOutput, speed, voice})
     │    ├─ useStreamingTranslate
     │    │    └─ createPlaybackSink → PcmPlaybackQueue(ctx, onDrained, gainNode)  ← phase 2
     │    └─ ConversationTranscript layout="stacked"|"columns"                     ← phase 3
     └─ (transcript is rendered by CascadePanel, not by the page)

wire  sessionOptionsSchema { direction, voiceGender, voiceOutput?, speed?, voice? }  ← phases 4,5
       └─ gateway → TurnSession (defaults applied here) → pipeline-translator → sidecar
catalog  engine CATALOG → GET /voices → listVoices?() → api-client → picker          ← phase 5
```

## Key decisions

| Decision                                                                       | Why                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Volume via `createPlaybackSink`, **not** a GainNode inside `PcmPlaybackQueue`  | The extension's sink feeds the _meeting's outgoing track_ (`page-playback-sink.ts:5-11`) — a gain stage in the queue would attenuate what other participants hear |
| Sink factory reads a **ref**, not captured state                               | `ConversationSession` is built once before settings load (`use-streaming-translate.ts:107`); a captured value freezes volume at the first-render default          |
| Wire fields `.optional()`, defaulted in `TurnSession` — **never `.default()`** | `SessionOptions` is `z.infer` (output type), where `.default()` is _required_ in TS and breaks a production literal at `conversation-session.ts:209-212`          |
| **Clamp** out-of-range values, never reject                                    | A failed parse throws `WsException`, which `AllExceptionsFilter` swallows — the client gets silence and Start hangs forever (`parse-ws-event.ts:12-19`)           |
| Speed server-side, English-output only, presets **≥ 1.0**                      | No `preservesPitch` on `AudioBufferSourceNode`; and sub-1.0 crosses the backlog ceiling deterministically, silently dropping sentences                            |
| Voice on/off as a wire flag, not client mute                                   | Sidecar engines serialize inference on shared CPU; client mute pays full synthesis cost to discard the result                                                     |
| Voice token opaque, **keyed by output language**, whitelisted in the engine    | Kokoro sids and VieNeu preset names are disjoint; a preset name on the wire already caused a production outage (`development-journey.md:356-359`)                 |
| `voice` stays **off** the shared `TtsSynthesizeRequest`                        | Its absence is today's structural guarantee that ElevenLabs cannot interpolate a client value; prose is not a substitute                                          |
| localStorage, not a Prisma column                                              | No cross-device requirement stated                                                                                                                                |

## Deploy and rollback

Phases 4 and 5 mutate `packages/types`, which three apps compile against, so a revert
is **not** a no-op — see each phase's Rollback section. Deploy order is sidecar → api
→ web: the server tolerates the new fields' absence, but a new client assumes the
server understands them. `.optional()` is what keeps a partial revert compiling.

## Success Criteria

- [ ] Voice off → no synthesis; transcript still arrives; turn closes with a distinct
      `voice_off` reason (not conflated with pipeline failure)
- [ ] Volume attenuates live mid-conversation, applies on the first conversation after
      a reload, and does not throw once a session has ended
- [ ] Speed audibly changes vi→en output; disabled with a caption for en→vi
- [ ] Every wire-bound control is disabled while running — none silently inert
- [ ] Out-of-range persisted values clamp; Start never hangs
- [ ] Voice picker lists only what the running backend reports; stale, unknown or
      wrong-language tokens degrade to gender and never reach `_infer` or a request path
- [ ] Transcript switches two-column ↔ stacked _on the page_; collapses to stacked below `sm`
- [ ] All settings survive reload; corrupt stored value falls back to defaults
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, api e2e, sidecar pytest green

## Red Team Review

### Session — 2026-08-25

**Reviewers:** Security Adversary (Fact Checker), Assumption Destroyer (Scope
Auditor), Failure Mode Analyst (Flow Tracer) · plus `kongming` advisory supervision.
**Findings:** 25 raw → 17 after dedup (17 accepted, 1 sub-claim rejected).
**Severity breakdown:** 2 Critical, 7 High, 8 Medium. All carried `file:line`
evidence; none failed the evidence filter.

| #   | Finding                                                                                             | Severity | Disposition | Applied To                                                                                   |
| --- | --------------------------------------------------------------------------------------------------- | -------- | ----------- | -------------------------------------------------------------------------------------------- |
| 1   | `.default()` makes fields required in `z.infer`; breaks realtime-client + extension + 4 specs       | Critical | Accept      | Phase 4                                                                                      |
| 2   | Phase 5's `_voice_for` fallback does not exist; `VOICES` restructure breaks the default gender path | Critical | Accept      | Phase 5                                                                                      |
| 3   | Threat model wrong — `/ws/translate` IS authenticated (`ws-auth.ts:93`)                             | High     | Accept      | Phase 4                                                                                      |
| 4   | Widening `TtsSynthesizeRequest` restores the outage channel                                         | High     | Accept      | Phase 5                                                                                      |
| 5   | Schema rejection is a silent hang, not a refusal                                                    | High     | Accept      | Phase 4                                                                                      |
| 6   | `GET /voices` will 401; mitigation hides the failure permanently                                    | High     | Accept      | Phase 5                                                                                      |
| 7   | `voiceOutput`/`speed`/`voice` dropped from the disabled-while-running set                           | High     | Accept      | Phases 2,4,5                                                                                 |
| 8   | Sub-1.0 speed makes turn-dropping deterministic; only trace is a console warn                       | High     | Accept      | Phase 4                                                                                      |
| 9   | GainNode ref remedy pointed inside the package phase 2 forbids touching                             | High     | Accept      | Phase 2                                                                                      |
| 10  | Voice-off guard skips `registry.holds`; poisons server latency metrics                              | Medium   | Accept      | Phase 4                                                                                      |
| 11  | Voice token must be keyed by output language                                                        | Medium   | Accept      | Phases 1,5                                                                                   |
| 12  | Stale-token drop placed in a sync loader that cannot know an async catalog                          | Medium   | Accept      | Phases 1,5                                                                                   |
| 13  | Phase 3 listed no file that could pass `layout` to the transcript                                   | Medium   | Accept      | Phase 3                                                                                      |
| 14  | Stall-watchdog test spans two runtimes; as scoped it was a phantom test                             | Medium   | Accept      | Phase 4                                                                                      |
| 15  | Slider persisted and re-rendered the transcript on every pointer tick                               | Medium   | Accept      | Phases 1,2                                                                                   |
| 16  | `contrast-floors.spec.ts` cannot see components — a net cited 3×                                    | Medium   | Accept      | Phases 2,4                                                                                   |
| 17  | Sidecar `speed` unbounded at its own trust boundary                                                 | Medium   | Accept      | Phase 4                                                                                      |
| —   | _"`TranslateController` is unauthenticated"_                                                        | —        | **Reject**  | Contradicted by `auth.module.ts:90`; the source comment is stale and is corrected in phase 4 |

**Not defective** (traced and cleared, so nobody re-chases them): a voice-off turn
does not stall `OrderedPlayback` — `open → finish` with zero `push` retires cleanly
(`ordered-playback.ts:314-325`); and a voice-off turn cannot interleave with an audio
turn, since `voiceOutput` is fixed for the run at `ConversationSession.start`.

**Disputed, not relied upon:** whether `setTargetAtTime` on a closed `AudioContext`
throws or is a spec no-op. The remedy (wire `onStopped`, guard on context state) is
correct either way, so the plan does not depend on the answer.

### Finding 16 — adjudicated during phase 1

The finding said to express disabled state with a token pair rather than
`disabled:opacity-50`. Applied literally to the new `Switch`/`Slider` primitives that
would have made them the only two components in the kit that differ — `checkbox.tsx`
and `toggle.tsx` both use `opacity-50` and `skin-guard.spec.ts` passes over them.

**The line that resolves it: the control may dim; the explanation may not.**
WCAG 1.4.3 explicitly exempts disabled controls from contrast minimums, so dimming
the control itself is legitimate and consistency with the kit wins. What is _not_
exempt is text the user must read to understand _why_ a control is disabled —
phase 4's en→vi speed caption is an explanation, not disabled content. It must be
full-opacity, use a token pair that passes `contrast-floors.spec.ts` on its own, and
must never be nested inside an `opacity-50` wrapper (opacities multiply).

So: primitives keep `disabled:opacity-50` (shipped in phase 1); phase 4's caption is
where the finding actually binds.

### Whole-Plan Consistency Sweep

Run 2026-08-25 after applying all 17 findings. Swept `plan.md` and all five phase
files for: `unauthenticated`, `contrast-floors`, `_voice_for`, `.default(`,
`zero diff`, `opacity-50`.

- Every surviving occurrence is a _corrected_ usage — a warning against the wrong
  pattern, or the verified description of what the code actually does. No stale claim
  survives.
- `"zero diff in packages/realtime-client"` is now scoped to phase 2 explicitly, with
  a cross-reference noting phase 4 does touch that package.
- The disabled-while-running set is now stated consistently in phases 2, 4 and 5, with
  the same (corrected) rationale in each.
- Upstream: the brainstorm report's two factual errors — the "unauthenticated at
  upgrade" premise and the `contrast-floors.spec.ts` safety net — were corrected in
  place with dated amendments, since `plan.md` cites that report as its contract.

**Unresolved contradictions: none.**

## Open questions

- Settings surface always-visible or collapsible disclosure? Recommend always-visible
  in phase 2, revisit when the voice picker lands in phase 5. Not blocking.

<!-- slug: translate-page-ui-revamp -->
