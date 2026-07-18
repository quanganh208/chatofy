---
phase: 2
title: Interface naming standardization
status: completed
effort: 0.25d
priority: P2
dependencies:
  - 1
---

# Phase 2: Interface naming standardization

## Overview

One convention repo-wide: no `I`-prefix (matches api `AuthAdapter`/`UserRepository`/`SessionStore` and ai-providers `SttProvider`/`TtsProvider`). Only mobile deviates today.

## Requirements

- Functional: pure rename, zero behavior change
- Non-functional: keep `*.interface.ts` filenames (already consistent repo-wide)

## Related Code Files

- Modify: `apps/mobile/src/clients/auth-client.interface.ts` — `IAuthClient` → `AuthClient`
- Modify: `apps/mobile/src/clients/ws-client.interface.ts` — `IWSClient` → `WsClient`
- Modify: `apps/mobile/src/audio/audio-recorder.interface.ts` — `IAudioRecorder` → `AudioRecorder`
- Modify: `apps/mobile/src/audio/audio-player.interface.ts` — `IAudioPlayer` → `AudioPlayer`
- Modify: all importers — `auth-client.stub.ts`, `ws-client.native.ts`, `auth-provider.tsx`, any hooks/screens importing these

## Implementation Steps

1. Grep `\bI(AuthClient|WSClient|AudioRecorder|AudioPlayer)\b` across `apps/mobile` to enumerate call sites first.
2. Rename each interface at declaration, update all importers. Watch for implementation-class name collisions (e.g. if a class named `AudioRecorder` exists, keep class name descriptive: `ExpoAudioRecorder`-style; scout found none, but verify).
3. `pnpm --filter @chatofy/mobile typecheck` (or workspace `pnpm typecheck`).

## Success Criteria

- [ ] `grep -rn "\bI[A-Z]" apps/ packages/ --include="*.ts*"` shows no interface `I`-prefix declarations
- [ ] typecheck green

## Risk Assessment

Mechanical rename; typecheck is a complete safety net. No runtime surface.
