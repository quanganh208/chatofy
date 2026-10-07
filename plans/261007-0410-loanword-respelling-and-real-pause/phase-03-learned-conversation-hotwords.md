---
phase: 3
title: 'Learned per-conversation hotwords'
status: completed
priority: P2
effort: '4h'
dependencies: [2]
---

# Phase 3: Learned per-conversation hotwords

## Goal

Every respelling accepted on a socket becomes an STT hotword for that socket's later turns, so a word heard wrong once comes out of the recognizer right after that.

## Context

- Per-socket state that outlives turns is `ConversationContext` (`apps/api/src/modules/translate/session/conversation-context.ts`). It is keyed by socket and cleared by `forget()`. There is one WebSocket per conversation.
- Hotwords reach STT through `PipelineTranslatorService.transcribe()` (`pipeline-translator.service.ts:482-496`), then `/transcribe`, then `build_hotwords` (`services/local-stt/app.py:144`). The sidecar caps the list at 48 terms of 64 characters, and so does the socket schema.
- Measured on cd64f34f: the hotword "deepfake" fixed window 1 and changed nothing in the other 9.
- The cost: once any hotword exists, the session decodes with beam search (1.36× RTF; the second recognizer is already loaded).

## Files

- Modify:
  - `apps/api/src/modules/translate/session/conversation-context.ts`: add `learn(socket, terms)` and `learnedTerms(socket)`. Keep insertion order and dedupe case-insensitively. The per-socket ceiling is the hotword cap minus nothing extra; merging is where the cap applies.
  - `apps/api/src/modules/translate/services/translation-session.service.ts`:
    - After a final turn's display is composed, call `learn()` with the accepted proposals.
    - At `session.start`, build the turn's effective hints as the user's hotwords first, then the learned terms, deduped and cut at 48.
  - `apps/api/src/modules/translate/session/turn-session.ts`, only if the hints are frozen there. Otherwise pass the merged list at the STT call site.
  - `apps/api/src/modules/translate/services/display-restore-request.ts`: `restoreRequestFor` already sends `session.hints?.hotwords` as restorer terms. Use the merged list there too, so the casing of learned terms ("OpenAI") applies.
- Tests:
  - `conversation-context.spec.ts`: covers learn, dedupe and forget.
  - `translation-session.service.spec.ts`: across two turns on one socket, the second turn's STT request carries the term accepted in the first. User terms keep priority, the list never goes over 48 entries, and another socket never sees the term.

## Steps

1. **Store.** Add the learned-term store to `ConversationContext` and test it.
2. **Merge.** Merge at turn start and send the result to STT and to the restorer.
3. **Learn.** Learn only from guard-accepted respellings, never from raw proposals or from source spans.
4. **Log.** Write one line per turn when learned terms are in use (`hotwords user=U learned=L`), so prod inspection can see the beam-decoder switch.

## Verification

- `pnpm --filter @chatofy/api test conversation-context translation-session`
- Offline: re-run the per-window STT comparison (cd64f34f recording windows in ms, from the CapturePump replay: 1044–8440, 8248–14088, 14002–21057, 20801–23273, 23529–25405, 25681–33205, 32928–37126, 37147–45119, 44841–49040, 50723–53367) with the learned list after turn 0 and confirm windows 2–10 do not regress.

## Risks

- **A wrong term pulls neighbouring words for the rest of the session** (§3.17: at score 3.0 a phrase truncated its clause). `HOTWORDS_SCORE` stays at 1.5, and terms come only from guarded respellings.
- **The beam decoder costs CPU for the rest of a session:** the RTF is within the measured 1.36×. Watch it in the phase 5 replay.

## Outcome (2026-10-07)

- **Where terms go.** Learned terms are kept in `ConversationContext` and merged by `mergeHotwords` (the user's terms first, 48 cap). They are passed as `TranslateTurnInput.learnedTerms` to the STT call, the split-piece STT and the restore terms. They are NOT put in `TranslationHints`, because they come from whoever is speaking, so they never reach the translation prompt.
- **Tests.** The display spec covers the second turn carrying the term, user priority, the hints staying user-only, and no leak across sockets.
- **Offline evidence.** The hotword "deepfake" fixed window 1 of cd64f34f and changed none of the other 9.
