---
phase: 3
title: Modularize web translate page
status: completed
effort: 0.5d
priority: P2
dependencies:
  - 1
---

# Phase 3: Modularize web translate page

## Overview

Split `apps/web/app/translate/page.tsx` (287 LOC — over repo's 200 cap) into a state-machine hook + presentational components. Pure refactor: identical UI and behavior.

## Requirements

- Functional: record → translate → play flow byte-identical in behavior; upload-file path and elapsed timer preserved
- Non-functional: `page.tsx` < 100 LOC, function components + hooks only (no class conversion)

## Architecture

- `page.tsx` = composition root: wires hook state into components
- `use-translate-turn` owns the request lifecycle (loading/result/error/elapsed), calls `translate()` from `@/clients/api-client`, manages the elapsed-interval cleanup (current unmount-cleanup effect moves here)
- Components are stateless, props-driven, typed by `@chatofy/types` (`TranslationDirection`, `TranslateResponse`, `VIENEU_VOICES` from Phase 1)

## Related Code Files

- Create: `apps/web/src/hooks/use-translate-turn.ts`
- Create: `apps/web/src/components/translate/direction-toggle.tsx`
- Create: `apps/web/src/components/translate/voice-picker.tsx`
- Create: `apps/web/src/components/translate/quality-card.tsx` (slider + `qualityLabel` helper)
- Create: `apps/web/src/components/translate/result-card.tsx` (transcript, translation, audio playback)
- Create: `apps/web/src/components/translate/audio-source-controls.tsx` (record/upload buttons, status line, mic meter, owns fileName state — added to hit the <100 LOC criterion)
- Modify: `apps/web/app/translate/page.tsx`

## Implementation Steps

1. Extract `use-translate-turn.ts`: state (`loading`, `result`, `error`, `elapsed`), `runTranslate(recording, {direction, quality, voice})`, timer start/stop + unmount cleanup. Reuse `useAudioRecorder` as-is (do not touch — it's fine at 199 LOC).
2. Extract components listed above; move `qualityLabel` and `DIRECTION_TITLE` next to their consumers; import `VIENEU_VOICES` + `TranslationDirection` from `@chatofy/types`.
3. Rewrite `page.tsx` as composition; keep `'use client'`, file-input ref, and `onPickFile` wiring.
4. Verify: `pnpm --filter @chatofy/web build`, then manual smoke test (`pnpm --filter @chatofy/web dev`): record→translate→play, file upload path, direction switch, voice picker only visible/applied for en→vi, quality slider labels.

## Success Criteria

- [ ] `page.tsx` < 100 LOC; every new file < 200 LOC
- [ ] No behavior change in smoke test (both directions, upload path, timer display)
- [ ] typecheck + web build green

## Risk Assessment

Timer/interval ownership moves into the hook — keep cleanup on unmount, else interval leaks on route change. Mitigation: cleanup in hook's own effect; smoke test navigating away mid-request.
