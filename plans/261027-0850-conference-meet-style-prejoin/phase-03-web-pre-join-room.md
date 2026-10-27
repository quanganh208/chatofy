---
phase: 3
title: 'Web pre-join room'
status: completed
priority: P1
effort: '1.5d'
dependencies: [1, 2]
---

# Phase 3: Web pre-join room

## Goal

Opening `/conference/<roomId>` shows a Meet-style "green room" before joining:
camera preview, mic level meter, mic/camera toggles, mic/camera pickers, name
prefilled from the account, spoken language (last used), a translated-voice chip
that edits gender and speed in place, and one filled "Join now". The in-call
header gains "Copy invite link".

## Context the executor needs

- Read `docs/design-guidelines.md` before writing UI.
- After phase 2: `useConference(roomId)` returns `status` (starts `'idle'`),
  `join(params: ConferenceJoinParams)`, `toggleMute`, `toggleVideo`,
  `localMuted`, `localVideoEnabled` (toggles work before joining; `join` applies them).
- Room page today: `apps/web/app/(app)/conference/[roomId]/page.tsx`. Order of
  render branches: invalid id / not-found / ended → connecting/idle →
  reconnecting → permission denied → disconnected → generic error → in-call. It
  also has (a) a `useEffect` that redirects to `/conference?room=` when the URL
  has no `name`, and (b) a mount `useEffect` that writes `ACTIVE_CALL_KEY` and
  calls `join`. Both are replaced below.
- Voice settings: `useTranslateSettings()` from `apps/web/src/hooks/use-translate-settings.ts`
  returns `{ settings, ready, set, current }`. Storage writes are debounced, so
  before joining call `saveTranslateSettings(current())` (exported from
  `apps/web/src/lib/translate-settings.ts`) — the web speaker leg reads storage
  via `loadTranslateSettings()` when it is built
  (`apps/web/src/conference/conference-cascade-leg-web.ts:87`).
  `settings.voiceGender` is `'female' | 'male'`; `settings.speed` is one of
  `SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2]`; `settings.voice` maps a
  language to a chosen voice token.
- Existing labels you can reuse: `web.translate.voiceFemale`, `web.translate.voiceMale`,
  `web.translate.speed`, `common.conference.yourName`, `common.conference.sourceLanguage`,
  `common.conference.muteMic`, `common.conference.unmuteMic`,
  `common.conference.disableCamera`, `common.conference.enableCamera`.
- Components available in `@chatofy/ui/react`: `Button`, `Input`, `Label`,
  `SegmentedControl`, `Popover`/`PopoverTrigger`/`PopoverContent`,
  `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`, `Tooltip`.
  Use only these (no hand-written controls).
- Design gate: `apps/web/src/design/accent-budget-app.spec.tsx`. A popover
  content counts as one elevated surface (see the `/translate — voice settings
open` row: `surfaces: 1`). `bg-primary` on a non-control readout (the meter
  bar) is not counted.
- happy-dom (vitest) has no `navigator.mediaDevices` and no `AudioContext`;
  every media call must be optional-chained / feature-checked and fail quietly.
- Typing into a controlled React input in a spec: setting `input.value` directly
  is ignored by React. Copy the native-value-setter pattern used in
  `apps/web/src/components/auth/login-form.spec.tsx` (native setter +
  `dispatchEvent(new Event('input', { bubbles: true }))`).
- `apps/web/app/(app)/conference/[roomId]/page.spec.tsx:15` hardcodes
  `useSearchParams` to `name=Alice&lang=vi`. To vary the query per test, replace
  it with a `vi.hoisted(() => ({ query: '' }))` box as in
  `apps/web/src/design/accent-budget-app.spec.tsx:111`.
- `SegmentedControl` options render as `role="radio"` with `aria-checked="true"`
  on the selected one (`packages/ui/src/react/segmented-control.tsx`).

## Tasks

### Task 3.1 — Add the pre-join i18n keys

- Goal: all new strings exist in en and vi.
- Target files: `packages/i18n/src/en.ts`, `packages/i18n/src/vi.ts`.
- Steps:
  1. Add (same order in both):
     - `web.conference.readyToJoin` — en "Ready to join?", vi "Sẵn sàng tham gia?"
     - `web.conference.joinNow` — en "Join now", vi "Tham gia ngay"
     - `web.conference.microphone` — en "Microphone", vi "Micrô"
     - `web.conference.camera` — en "Camera", vi "Camera"
     - `web.conference.defaultDevice` — en "System default", vi "Mặc định của hệ thống"
     - `web.conference.noCameraPreview` — en "Camera is off", vi "Camera đang tắt"
     - `web.conference.micLevel` — en "Microphone level", vi "Mức âm micrô"
     - `common.conference.translatedVoice` — en "Translated voice", vi "Giọng dịch" (shared with mobile, phase 4)
     - `common.conference.voiceFemale` — en "Female", vi "Nữ" (shared with mobile)
     - `common.conference.voiceMale` — en "Male", vi "Nam" (shared with mobile)
     - `web.conference.translatedVoiceChip` — en "Voice: {gender} · {speed}×", vi "Giọng: {gender} · {speed}×"
     - `web.conference.translatedVoiceHint` — en "Others hear your translated speech in this voice. It is the same setting as on Translate.", vi "Người khác nghe bản dịch lời bạn bằng giọng này. Đây cũng là cài đặt ở trang Dịch."
     - `web.conference.copyInviteLink` — en "Copy invite link", vi "Sao chép link mời"
     - `web.conference.inviteLinkCopied` — en "Link copied", vi "Đã sao chép link"
  2. `pnpm --filter @chatofy/i18n build`.
- Verify: `pnpm --filter @chatofy/i18n test` exits 0.

### Task 3.2 — Pre-join media hook

- Goal: one hook owns the preview stream, device lists, toggles and mic level.
- Target files: create `apps/web/app/(app)/conference/[roomId]/hooks/use-pre-join-media.ts`.
- Steps:
  1. Signature: `usePreJoinMedia(): { stream: MediaStream | null; micOn: boolean; camOn: boolean; setMicOn(v: boolean): void; setCamOn(v: boolean): void; mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; micId?: string; camId?: string; setMicId(id?: string): void; setCamId(id?: string): void; level: number; release(): void }`.
  2. Open the stream with `navigator.mediaDevices?.getUserMedia({ audio: micId ? { deviceId: micId } : true, video: camId ? { deviceId: camId } : true })`, falling back to `{ audio: …, video: false }` on failure, and to `null` on a second failure. Re-open when `micId` or `camId` changes; stop the previous stream's tracks first. Stop all tracks on unmount (guard with a `cancelled` flag exactly like the old lobby preview effect).
  3. After the first successful open, call `navigator.mediaDevices?.enumerateDevices?.()` and keep `audioinput` → `mics`, `videoinput` → `cams` (labels are only filled after permission — that is why it runs after open). Also subscribe with `navigator.mediaDevices?.addEventListener?.('devicechange', …)` and re-enumerate; unsubscribe on unmount.
  4. `micOn`/`camOn` set `track.enabled` on the current stream's audio/video tracks and are state, starting `true`. After every (re)open — e.g. a device change — re-apply the current `micOn`/`camOn` to the new tracks.
  5. Level: only if `typeof AudioContext !== 'undefined'` and the stream has an audio track, create one `AudioContext`, a `MediaStreamAudioSourceNode` and an `AnalyserNode` (`fftSize = 512`); in a `requestAnimationFrame` loop compute the RMS of `getFloatTimeDomainData` and set `level = Math.min(1, rms * 4)` (throttle `setState` to every 3rd frame). `level` is `0` while `micOn` is false. Close the context and cancel the frame on stream change/unmount.
  6. `release()` stops all tracks and closes the context synchronously (called right before joining, so the call can open the same devices).
  7. Add a doc comment on the hook explaining why the preview stream is separate from the call's stream (the call opens its own in `acquireLocalMedia` and reopens on every reconnect).
- Success criteria: file compiles; no import of anything outside `react` and DOM APIs.
- Verify: `pnpm --filter web typecheck` exits 0.

### Task 3.3 — Mic level meter

- Goal: a visible bar that moves when the user speaks.
- Target files: create `apps/web/app/(app)/conference/[roomId]/components/mic-level-meter.tsx`.
- Steps:
  1. Props `{ level: number; label: string }`. Render a `div` with `role="meter"`, `aria-label={label}`, `aria-valuemin={0}`, `aria-valuemax={100}`, `aria-valuenow={Math.round(level * 100)}`, classes `bg-muted h-1.5 w-full overflow-hidden rounded-full`; inside a `div` with `bg-primary h-full transition-[width] duration-75` and `style={{ width: `${Math.round(level * 100)}%` }}`.
- Verify: no verification needed (covered by task 3.7).

### Task 3.4 — Translated-voice chip

- Goal: the chip shows gender and speed; its popover changes them in the one shared store.
- Target files: create `apps/web/app/(app)/conference/[roomId]/components/conference-voice-chip.tsx`.
- Steps:
  1. Use `useTranslateSettings()`. Render nothing until `ready` (avoid a corrected-a-frame-later flash).
  2. Trigger: `PopoverTrigger asChild` around `Button variant="outline" size="sm" data-conference-voice-chip` with a `Volume2` icon (lucide) and text `t('web.conference.translatedVoiceChip', { gender: <label>, speed: String(settings.speed) })`, where label is `common.conference.voiceFemale`/`common.conference.voiceMale`.
  3. `PopoverContent` (non-modal, as on `/translate`): heading `common.conference.translatedVoice`; `p.text-hint.text-muted-foreground` with `web.conference.translatedVoiceHint`; `SegmentedControl` label `common.conference.translatedVoice` with options female/male (labels `common.conference.voiceFemale`/`voiceMale`); `SegmentedControl` label `web.translate.speed`, `density="compact"`, `equalWidth`, options from `SPEED_PRESETS` exactly as in `apps/web/src/components/translate/voice-settings-panel.tsx:186-200`.
  4. Gender change: `set({ voiceGender: next, voice: {} })`. Clearing `voice` drops every per-language voice picked on `/translate`, so the new gender's default voice is what plays. This is deliberately coarser than `voice-settings-panel.tsx:135-140`, which clears only picks of the other gender — that needs the voice catalogs, which the green room does not load. Write both sentences as the code comment.
  5. Speed change: `set({ speed: Number(value) })`.
- Verify: no verification needed (covered by tasks 3.7 and 3.8).

### Task 3.5 — Pre-join panel

- Goal: the green room UI, presentational, driven by props.
- Target files: create `apps/web/app/(app)/conference/[roomId]/components/pre-join-panel.tsx`.
- Steps:
  1. Props: `media: ReturnType<typeof usePreJoinMedia>`, `name: string`, `onNameChange(v: string)`, `language: LanguageCode`, `onLanguageChange(v: LanguageCode)`, `onJoin(): void`, `joining: boolean`, `error: string | null`.
  2. Layout: wrapper `mx-auto grid w-full max-w-5xl gap-8 px-4 py-8 md:grid-cols-[3fr_2fr] md:items-center`.
     - Left column: a region `bg-muted relative aspect-video w-full overflow-hidden rounded-xl` (no shadow — it is page ground, not a card) holding `<video autoPlay playsInline muted>` bound to `media.stream` via a ref effect, mirrored with `-scale-x-100`. When `!media.camOn` or no video track, show centered `web.conference.noCameraPreview` text instead. At the bottom-centre of the region, two round `Button variant="outline" size="icon"` toggles (Mic/MicOff, Video/VideoOff icons) with `aria-pressed` and the existing mute/camera labels. Under the region: `MicLevelMeter`, then a two-column row of two `Select`s (Microphone, Camera); first item `value="default"` labelled `web.conference.defaultDevice`, then one item per device (`deviceId`, label or `Microphone 1` fallback). Selecting `default` calls `setMicId(undefined)`.
     - Right column: `h1` `web.conference.readyToJoin`; `Label`+`Input id="conf-name"` (`maxLength={MAX_CONFERENCE_DISPLAY_NAME_CHARS}`, `autoComplete="name"`); `SegmentedControl` `common.conference.sourceLanguage` with vi/en/zh exactly as the old lobby did (use `languageNamer(t)`); `ConferenceVoiceChip`; error line `role="alert"`; `Button` default variant, full width, `web.conference.joinNow` (`common.conference.connecting` while `joining`), disabled when `!name.trim() || joining`.
  3. Only "Join now" is `variant="default"`. Everything else is outline/ghost.
- Verify: `pnpm --filter web typecheck` exits 0.

### Task 3.6 — Wire the room page

- Goal: idle → green room; Join now → the existing call screens.
- Note: the landing's active-call bounce (`apps/web/app/(app)/conference/page.tsx`) now lands on this green room, so returning to a call costs one "Join now" click. That is intended (Meet behaves the same) — do not add auto-join.
- Target files: `apps/web/app/(app)/conference/[roomId]/page.tsx`, `apps/web/app/(app)/conference/[roomId]/utils/room-route.ts` (only if `ACTIVE_CALL_KEY`'s doc comment mentions name).
- Steps:
  1. Delete the `?name=` redirect effect and the mount-join effect. Stop reading `name`/`lang` from `searchParams`.
  2. In the same folder create `components/pre-join-stage.tsx` exporting `PreJoinStage({ onJoin }: { onJoin(choice: PreJoinChoice): void })` and `interface PreJoinChoice { displayName: string; sourceLanguage: LanguageCode; micOn: boolean; camOn: boolean; devices: PreferredDevices }`. It owns, so that unmounting it releases the preview:
     - `const media = usePreJoinMedia()`;
     - `name` state (initial `''`; a `useEffect` fills it once from `useSession().data?.user?.name` while the user has not typed);
     - `language` state (initial `'vi'`; an effect reads `localStorage.getItem('chatofy.conference.language')` in try/catch, validated with `toLanguageCode` — in an effect, not during render, to avoid a hydration mismatch);
     - `joining` state;
     - `useTranslateSettings()` for `current`.
       On Join now: `setJoining(true)`; `saveTranslateSettings(current())`; write the language key in try/catch; `media.release()`; `onJoin({ displayName: name.trim(), sourceLanguage: language, micOn: media.micOn, camOn: media.camOn, devices: { audioDeviceId: media.micId, videoDeviceId: media.camId } })`. It renders `PreJoinPanel`.
  3. Page state: `joinedAs: { name: string; language: LanguageCode } | null`.
  4. Page `handleJoin(choice)`: match the hook's toggles to the preview (`if (!choice.micOn) toggleMute(); if (!choice.camOn) toggleVideo();` — the hook starts unmuted with video on); `sessionStorage.setItem(ACTIVE_CALL_KEY, JSON.stringify({ roomId }))`; `setJoinedAs({ name: choice.displayName, language: choice.sourceLanguage })`; `void join({ displayName: choice.displayName, sourceLanguage: choice.sourceLanguage, devices: choice.devices })`.
  5. Add NO unmount effect: `useConference` already leaves on unmount (`apps/web/src/hooks/use-conference.ts:207-213`).
  6. Render order: keep the invalid-id / not-found / ended branch first. Then: `if (status === 'idle' && joinedAs === null) return <PreJoinStage onJoin={handleJoin} />`. **Both conditions are required:** `leave()` sets status back to `'idle'` (`ConferenceConnection.leave()` → `stop('idle')`), and Leave / Back to lobby call `leave()` before navigating, so a status-only check would re-mount the green room and reopen the camera for a frame. Keep the `connecting` branch condition exactly as it is today (`status === 'connecting' || status === 'idle'`).
  7. Replace `displayName` uses in the in-call JSX with `joinedAs?.name ?? t('common.conference.you')`, and `sourceLanguage` with `joinedAs?.language ?? 'vi'`.
  8. In-call header: before the roster button add `Button variant="ghost" size="icon"` with lucide's `Link` icon imported as `import { Link as LinkIcon } from 'lucide-react'` (avoids a clash with `next/link`), `aria-label={t('web.conference.copyInviteLink')}`, onClick `navigator.clipboard?.writeText(`${window.location.origin}/conference/${roomId}`)` then set `copied` true for 2 s; when `copied`, render `<span role="status" className="text-hint text-textMuted">{t('web.conference.inviteLinkCopied')}</span>`.
  9. Update the file's top doc comment: green room before the call, "Join now" is that state's one accent; in-call budget unchanged.
- Success criteria: no `searchParams.get('name')` remains; typecheck passes.
- Verify: `grep -c "get('name')" "apps/web/app/(app)/conference/[roomId]/page.tsx"` prints `0` and `pnpm --filter web typecheck` exits 0.

### Task 3.7 — Room page behaviour spec

- Goal: lock the green-room behaviour.
- Target files: `apps/web/app/(app)/conference/[roomId]/page.spec.tsx`.
- Steps:
  1. The existing tests set `name=` in the URL and expect a joined room; give their `useConference` mock a non-idle `status` (they already use in-call/disconnected values — confirm each) and drop any assertion that `join` ran on mount.
  2. Mock `next-auth/react` `useSession` → `{ data: { user: { name: 'An Nguyen' } }, status: 'authenticated' }` and `@/hooks/use-translate-settings` → `{ settings: DEFAULT_TRANSLATE_SETTINGS, ready: true, set: vi.fn(), current: () => DEFAULT_TRANSLATE_SETTINGS }`.
  3. New cases with `status: 'idle'`: (a) shows "Ready to join?" and the name input has value `An Nguyen`; (b) URL with no query does NOT call `router.replace`; (c) pressing "Join now" calls `join` with `expect.objectContaining({ displayName: 'An Nguyen', sourceLanguage: 'vi' })`; (d) clearing the name disables "Join now"; (e) the voice chip text contains `Female` and `1×`.
- Verify: `pnpm --filter web exec vitest run "app/(app)/conference/[roomId]/page.spec.tsx"` exits 0 and the 5 new cases are listed as passed.

### Task 3.8 — Accent-budget rows for the green room

- Goal: the gate counts the new screen states.
- Target files: `apps/web/src/design/accent-budget-app.spec.tsx`.
- Steps:
  1. Add a mock for `@/hooks/use-translate-settings` only if the page render fails without one (the real hook works in happy-dom with empty storage — try without first).
  2. Under the in-call rows add:
     - `'/conference/[roomId] — pre-join'`: `filled: 1`, `surfaces: 0`, `setup() { url.query = ''; useConference.mockReturnValue(call({ status: 'idle', mySocketId: null })); }`, `render: () => <ConferenceRoomPage />`, `shows: '#conf-name'`.
     - `'/conference/[roomId] — pre-join, voice popover open'`: same setup, `filled: 1`, `surfaces: 1`, `open: '[data-conference-voice-chip]'`.
  3. Existing in-call rows use `status: 'in-call'` or error/reconnecting statuses through `call()`, so none of them renders the green room; do not change them. (In the spec, `joinedAs` is `null`, so a row with `status: 'idle'` IS the green room — that is what the two new rows rely on.)
  4. Update the section comment: pre-join spends its one accent on Join now; the preview is a muted region, not a card.
- Verify: `pnpm --filter web exec vitest run src/design/accent-budget-app.spec.tsx` exits 0.

## Phase exit check

- Verify: `pnpm --filter web test` exits 0, `pnpm --filter web typecheck` exits 0, `pnpm --filter web lint` exits 0.

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
