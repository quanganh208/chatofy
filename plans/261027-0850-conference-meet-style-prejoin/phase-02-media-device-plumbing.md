---
phase: 2
title: 'Media device plumbing and join-time options'
status: completed
priority: P1
effort: '4h'
dependencies: []
---

# Phase 2: Media device plumbing and join-time options

## Goal

The call can be joined with a name, language and chosen microphone/camera that
are decided **at the moment of joining**, not when the hook mounts. This is what
the pre-join room (phase 3) needs. Behaviour of the current room page is
unchanged at the end of this phase.

## Context the executor needs

- `apps/web/src/conference/acquire-local-media.ts` — `acquireLocalMedia()` asks
  for `{ audio: true, video: true }`, falls back to audio only when the camera is
  refused or missing, and throws `MediaPermissionError` when the mic fails.
- `apps/web/src/conference/conference-call-attempt.ts` — `CallAttemptOptions`
  (line 43) and the call `await acquireLocalMedia()` (around line 129).
- `apps/web/src/conference/conference-connection.ts` —
  `ConferenceConnectionOptions` (line 19) and `new CallAttempt({...})` (line 110).
- `apps/web/src/hooks/use-conference.ts` — `useConference(roomId, { displayName, sourceLanguage })`;
  `join()` builds a `ConferenceConnection` with those two values and applies
  `localMutedRef` / `localVideoEnabledRef` before `start()`. `toggleMute` /
  `toggleVideo` already work before a connection exists (they set the refs).
- Callers of `useConference`: `apps/web/app/(app)/conference/[roomId]/page.tsx`
  only. Mocked in `apps/web/src/design/accent-budget-app.spec.tsx` and
  `apps/web/app/(app)/conference/[roomId]/page.spec.tsx` (they mock the module,
  so a signature change only matters for the `UseConferenceReturn` type).

## Tasks

### Task 2.1 — Let `acquireLocalMedia` take preferred devices

- Goal: a chosen mic/camera is used when it exists, and the default is used when the id is stale.
- Target files: `apps/web/src/conference/acquire-local-media.ts`; create `apps/web/src/conference/acquire-local-media.spec.ts`.
- Steps:
  1. Export `interface PreferredDevices { audioDeviceId?: string; videoDeviceId?: string }`.
  2. Change the signature to `acquireLocalMedia(devices: PreferredDevices = {})`.
  3. Build constraints: `audio: devices.audioDeviceId ? { deviceId: devices.audioDeviceId } : true` and the same for `video`. Use a plain `deviceId` (an _ideal_ constraint), **never** `{ exact }`: an exact id that disappeared raises `OverconstrainedError`, which this function treats as "no camera" and would silently drop video.
  4. The audio-only fallback uses the same audio constraint.
  5. Add a doc comment line explaining step 3's reason.
  6. Spec: start the file with `// @vitest-environment happy-dom`. happy-dom has no `navigator.mediaDevices`, so `vi.spyOn` would throw; install the stub with `Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })` where `getUserMedia = vi.fn()`. Cases: (a) no devices → first call `{ audio: true, video: true }`; (b) both ids → `{ audio: { deviceId: 'mic-1' }, video: { deviceId: 'cam-1' } }`; (c) camera refused (`NotAllowedError`) → second call `{ audio: { deviceId: 'mic-1' }, video: false }` and `audioOnly: true`; (d) mic fails in fallback → rejects with `MediaPermissionError`. Throw errors as `Object.assign(new Error('x'), { name: 'NotAllowedError' })`.
- Success criteria: 4 tests pass.
- Verify: `pnpm --filter web exec vitest run src/conference/acquire-local-media.spec.ts` exits 0 and reports 4 passed.

### Task 2.2 — Thread devices through the attempt and the connection

- Goal: devices given to `ConferenceConnection` reach `acquireLocalMedia`, including on reconnect.
- Target files: `apps/web/src/conference/conference-call-attempt.ts` (`CallAttemptOptions`, the `acquireLocalMedia()` call), `apps/web/src/conference/conference-connection.ts` (`ConferenceConnectionOptions`, `new CallAttempt`).
- Steps:
  1. Add `devices?: PreferredDevices` (import the type from `./acquire-local-media`) to both option interfaces, with a one-line doc comment ("Mic and camera picked before joining; reused by every reconnect.").
  2. In the attempt: `await acquireLocalMedia(this.options.devices)`.
  3. In the connection: pass `devices: this.options.devices` into `new CallAttempt({...})`.
- Success criteria: types compile; no behaviour change when `devices` is omitted.
- Verify: `pnpm --filter web typecheck` exits 0.

### Task 2.3 — Move name, language and devices from mount to `join()`

- Goal: `useConference(roomId)` mounts without a name; `join(params)` supplies it.
- Target files: `apps/web/src/hooks/use-conference.ts`, `apps/web/app/(app)/conference/[roomId]/page.tsx`.
- Steps:
  1. Export `interface ConferenceJoinParams { displayName: string; sourceLanguage: LanguageCode; devices?: PreferredDevices }`.
  2. Change `useConference(roomId: string, options: {...})` to `useConference(roomId: string)`.
  3. Change `join` to `useCallback((params: ConferenceJoinParams): Promise<void> => {...}, [roomId, sink])`. Inside, use `params.displayName.trim()` (return early if empty, as today), `params.sourceLanguage`, and pass `devices: params.devices` to `new ConferenceConnection`.
  4. Update the `join` type in `UseConferenceReturn` accordingly.
  5. In `[roomId]/page.tsx` (minimal change only — phase 3 rewrites this page): `useConference(roomId)`, and in the mount effect call `void join({ displayName, sourceLanguage })`.
  6. In `apps/web/src/design/accent-budget-app.spec.tsx`, `call()` keeps `join: vi.fn(() => Promise.resolve())` — it still type-checks; change nothing unless typecheck says so.
- Success criteria: room page behaves as before (joins on mount with the URL name).
- Verify: `pnpm --filter web typecheck` exits 0 and `pnpm --filter web exec vitest run "app/(app)/conference/[roomId]/page.spec.tsx" src/design/accent-budget-app.spec.tsx` exits 0.

## Phase exit check

- Verify: `pnpm --filter web test` exits 0.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
  Apply kongming's guidance, then re-run the Verify step.
  If `kongming` cannot be spawned in this environment, STOP and report the same
  failure evidence to the user. Never continue by self-reasoning.
