---
phase: 3
title: 'Web UI and docs'
status: todo
priority: P2
effort: '2h'
dependencies: [2]
---

# Phase 3: Web UI and docs

## Overview

Turns the 14-option Vietnamese voice select into a two-option gender toggle,
puts it on the streaming page (which has no voice control today), and brings the
docs back in line with the contract.

## Requirements

- Functional: gender is selectable on `/translate` and `/translate/baseline`,
  disabled while a conversation or turn is running, and sent on both transports;
  the control is no longer gated on direction, because gender now means
  something in both.
- Non-functional: keyboard-operable and labelled, matching `DirectionToggle`;
  no new UI dependency.

## Architecture

`VoicePicker` becomes `VoiceGenderToggle`, built like the existing
`DirectionToggle` so the two controls sitting next to each other look and behave
alike. Streaming page holds gender in state beside `direction` and passes both
into `conversation.start(...)`, which forwards a `SessionOptions` object down to
the socket.

## Related Code Files

- Delete: `apps/web/src/components/translate/voice-picker.tsx`
- Create: `apps/web/src/components/translate/voice-gender-toggle.tsx`
- Modify: `apps/web/app/translate/page.tsx` — gender state, toggle, pass to `start`
- Modify: `apps/web/app/translate/baseline/page.tsx` — replace picker, ungate from direction
- Modify: `apps/web/src/hooks/use-streaming-translate.ts` — `start(options)`
- Modify: `apps/web/src/conversation/conversation-session.ts` — hold and forward `SessionOptions`
- Modify: `apps/web/src/clients/translate-socket.ts` — `startSession(options)`
- Modify: `apps/web/src/hooks/use-translate-turn.ts` — send `voiceGender`, drop the en→vi gate
- Modify: `apps/web/src/conversation/conversation-session.spec.ts`, `apps/web/src/audio/pipeline-latency.measure.spec.ts`
- Modify: `docs/codebase-summary.md` — `/translate` body, TTS bullet, env list
- Modify: `README.md` if it documents the removed env vars

## Implementation Steps

1. Build `VoiceGenderToggle` from the `DirectionToggle` pattern.
2. Thread `SessionOptions` through socket → session → hook → page.
3. Replace the picker on both pages; remove the `direction === 'en_to_vi'` gate.
4. Update the two web specs that call `start('vi_to_en')` or send a raw start event.
5. Update docs; remove the deleted env vars from every list that names them.
6. Manual check against the live sidecar: one male and one female turn per
   direction, confirming prosody holds on a full clause-split turn.

## Todo

- [x] `VoiceGenderToggle` replaces `VoicePicker`
- [x] Streaming page gains the control
- [x] Baseline page ungated from direction
- [x] web specs updated and green
- [x] docs + README reconciled
- [ ] manual 4-way listen (male/female × vi→en/en→vi) — NOT DONE, needs a human

## Success Criteria

- [ ] Selecting Male on `/translate` produces a male voice in both directions —
      verified at the API boundary by tests, not yet heard in a browser
- [x] Control is disabled mid-conversation, like `DirectionToggle`
- [x] `pnpm --filter @chatofy/web test` green
- [x] `pnpm knip` exit 0
- [x] No doc names `voice`, `VIENEU_VOICES`, `/voices`, or `LOCAL_TTS_VOICE_*`

## Risk Assessment

- The streaming page never had this control, so `ConversationSession` gains a
  parameter its spec suite exercises heavily — expect churn there, not logic risk.
- Losing the 14-preset picker removes reach: only 2 of 14 VieNeu voices stay
  addressable. Accepted in D1; re-auditioning is cheap if a different preset is
  wanted later.
