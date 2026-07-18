---
phase: 4
title: Web and mobile robustness
status: completed
priority: P3
dependencies: []
---

# Phase 4: Web and mobile robustness

## Overview

React-app fixes from the idiomatic-React audit: hook re-entrancy guard, stale-result reset, WS client lifecycle, auth-context memoization, `blobToBase64` relocation, scaffold documentation. No test harness in these apps — verification is typecheck + lint + documented manual steps (adding RTL is explicitly out of scope; behavior surface is thin and manual-verifiable).

## Requirements

- Functional: web findings #1,#2,#6; mobile findings #3,#4; scaffold note (mobile #5).
- Non-functional: no visual/UX change; no new deps.

## Architecture

- `use-translate-turn.ts`: `runTranslate` self-guards — early return when already loading (correctness no longer rests on caller `disabled`).
- `translate/page.tsx`: `turn.reset()` also fires in record-start handler (kills stale `ResultCard` on re-record).
- `blobToBase64` → `apps/web/src/lib/` (pure util out of hooks file).
- `NativeWSClient.connect()`: close prior socket first; register `onclose` → state sync + listener cleanup; reconnect no longer leaks.
- `auth-provider.tsx`: context value in `useMemo`, callbacks in `useCallback`.
- Scaffold: one-line "planned for conversation feature" note where the repo already documents module status (module docblocks in `ws-client.*`/audio interfaces + `docs/codebase-summary.md` if it lists these paths) — preempts examiner "dead code?" question.

## Related Code Files

- Modify: `apps/web/src/hooks/use-translate-turn.ts`, `apps/web/app/translate/page.tsx`, `apps/web/src/hooks/use-audio-recorder.ts`.
- Create: `apps/web/src/lib/blob-to-base64.ts` (or existing lib file if one fits).
- Modify: `apps/mobile/src/clients/ws-client.native.ts`, `apps/mobile/src/providers/auth-provider.tsx`.
- Modify (docs): scaffold docblocks; `docs/codebase-summary.md` if applicable.

## Implementation Steps

1. Web: re-entrancy guard; reset-on-record-start; move `blobToBase64` to `src/lib/` + update imports.
2. Mobile: WS `connect()` close-prior + `onclose` handling; auth context `useMemo`/`useCallback`.
3. Scaffold notes (docblocks + docs).
4. Gates: `pnpm --filter @chatofy/web typecheck && pnpm --filter @chatofy/mobile typecheck`, `pnpm lint`.
5. Manual verification (documented, not skipped):
   - Web (`pnpm --filter @chatofy/web dev`): double-click translate button while request in flight → single request (network tab); record → result → re-record → old result cleared during recording; file-upload flow unchanged.
   - Mobile: not runtime-verifiable without conversation feature consumers — WS fix verified by code review + typecheck only; state this in the phase report.

## Success Criteria

- [x] Concurrent `runTranslate` calls impossible regardless of caller discipline
- [x] No stale result visible while re-recording
- [x] `connect()` twice leaves exactly one live socket; `state` reflects `onclose`
- [x] `useAuth` consumers don't re-render on unrelated provider renders (value referentially stable)
- [x] Typecheck + lint green both apps; manual web checklist done

## Risk Assessment

- `useCallback` deps on auth callbacks — wrong dep array can freeze stale client ref; keep `client` in deps.
- Reset-on-record-start could clear a result the user still wants visible — intended UX per audit; confirm during manual check, easy revert.
- WS fix unverifiable at runtime (no consumer) — lowest-confidence change; keep it minimal.
