---
title: 'TTS output voice gender field'
description: 'One voiceGender field selects the output voice on both transports, replacing a free-form voice string the WS path never carried'
status: pending
priority: P1
effort: '1d'
tags: [tts, contracts, sidecar, web]
created: 2026-07-29
---

# TTS output voice gender field

## Overview

The output voice is effectively hardcoded. `POST /translate` carries a
free-form `voice: string` that only VieNeu understands, and `/ws/translate`
carries no voice concept at all — `streamClauses()` calls
`pipeline.synthesize({ text, language })` with no voice argument, so every
streamed turn uses each engine's built-in default in both directions.

This plan replaces that string with one user-facing field,
`voiceGender: 'female' | 'male'`, honored on both transports and both
directions. The gender→engine-token map is owned by the Python engines, so
Kokoro speaker ids and VieNeu preset names never reach the wire.

## Context links

- **Brainstorm + evidence:** `plans/reports/brainstorm-260729-1028-tts-voice-gender.md`
- **Reference docs:** `docs/codebase-summary.md`, `services/local-tts/README.md`
- **Dependencies:** `services/local-tts` sidecar on :8003 (running); no new packages
- **Related plans:** none — `plans/` held only reports and templates at creation

## Voice catalog (user verdict, 25-sample audition)

| Language               | Female           | Male            |
| ---------------------- | ---------------- | --------------- |
| en — Kokoro speaker id | `3` (`af_sarah`) | `5` (`am_adam`) |
| vi — VieNeu preset     | `Mai Anh`        | `Thanh Bình`    |

`Thanh Bình` reads as unisex and is male — gender labels here are audition
results, not inferences from the names.

## Goals

| #   | Goal                                                         | Priority |
| --- | ------------------------------------------------------------ | -------- |
| 1   | One field selects output voice on WS + REST, both directions | P1       |
| 2   | Engine voice tokens stay inside `services/local-tts`         | P1       |
| 3   | Delete the surface the field makes redundant                 | P2       |

## Decisions

| #   | Decision                                                               | Rationale                                                                                                  |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| D1  | `voiceGender` **replaces** `voice`; no escape hatch                    | two selectors would need a permanent precedence rule                                                       |
| D2  | gender→token map lives in the Python engines                           | only the engine knows what a token means                                                                   |
| D3  | `TtsProvider` request carries `voiceGender`                            | engine-agnostic concept at an engine-agnostic boundary                                                     |
| D4  | ElevenLabs ignores gender, keeps its configured id                     | cloud path is a comparison baseline, not shipped                                                           |
| D5  | absent → `'female'` both languages                                     | one predictable default; **flips vi**, whose default was male                                              |
| D6  | optional on the wire, `.default('female')` in zod                      | parsed output is total; no break for clients sending only `direction`                                      |
| D7  | gender toggle on both web pages                                        | same component, keeps baseline at parity with streaming                                                    |
| D8  | WS start event modelled as `SessionOptions { direction, voiceGender }` | two fields travel together through 5 layers; one object at each boundary, flat fields inside `TurnSession` |

## Phases

| #   | Phase                                                                                         | Status  |
| --- | --------------------------------------------------------------------------------------------- | ------- |
| 1   | [Phase 1: Sidecar voice catalog](./phase-01-sidecar-voice-catalog.md)                         | Pending |
| 2   | [Phase 2: Shared contracts and API plumbing](./phase-02-shared-contracts-and-api-plumbing.md) | Pending |
| 3   | [Phase 3: Web UI and docs](./phase-03-web-ui-and-docs.md)                                     | Pending |

Phase 2 depends on Phase 1 fixing the sidecar's HTTP field name. Phase 3
depends on Phase 2 exporting `voiceGenderSchema`.

## Success Criteria

- [ ] WS session started with `voiceGender: 'male'` returns male audio, both directions
- [ ] REST `POST /translate` with `voiceGender: 'male'` likewise; omitted → female
- [ ] Gender→token resolution tested in both engines, unknown value falls back
- [ ] No Kokoro sid or VieNeu preset name outside `services/local-tts`
- [ ] `pnpm knip` exit 0 after the deletions
- [ ] api unit + e2e, web unit, sidecar pytest green

## Deleted by this plan

`VIENEU_VOICES` (hand-maintained 14-name mirror) · `GET /voices` +
`preset_voices` + `EngineRegistry.voices()` (no caller) ·
`ElevenLabsTtsProvider.resolveVoiceId` regex hack · `LOCAL_TTS_VOICE_EN` /
`LOCAL_TTS_VOICE_VI` env vars.

## Open questions

None.

<!-- slug: tts-output-voice-gender-field -->
