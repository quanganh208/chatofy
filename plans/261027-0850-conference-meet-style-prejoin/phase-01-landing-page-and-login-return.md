---
phase: 1
title: 'Landing page and login return'
status: completed
priority: P1
effort: '4h'
dependencies: []
---

# Phase 1: Landing page and login return

## Goal

`/conference` becomes a Meet-style landing: one filled "New meeting" button, a
"code or link" field with an outline "Join" button, and a line "Joining as
{name}". It no longer asks for a name or a language, and it navigates to the bare
room URL `/conference/<roomId>`.

## Context the executor needs

- File today: `apps/web/app/(app)/conference/page.tsx` (209 lines). It has a name
  `Input`, a vi/en/zh `SegmentedControl`, a camera preview, Create and Join, and
  a `useEffect` that bounces back into an active call from `sessionStorage`
  (`ACTIVE_CALL_KEY` from `./[roomId]/utils/room-route`).
- Signed-out visitors never reach this page: `apps/web/app/(app)/layout.tsx`
  redirects, and `apps/web/proxy.ts` redirects to `/login?next=<path+query>`.
  `apps/web/src/components/auth/login-form.tsx:40` reads `next`. So the room link
  already survives sign-in. **One bug:** `redirectToLogin()` in
  `apps/web/src/hooks/use-conference.ts:95-99` sends `?callbackUrl=`, which the
  login form never reads. A token that dies mid-call loses the room.
- The session name: `useSession()` from `next-auth/react`; `data.user.name` (see
  `apps/web/src/components/layout/session-menu.tsx:77`).
- i18n: `packages/i18n/src/en.ts` and `packages/i18n/src/vi.ts` must gain the
  same keys (parity is tested by `packages/i18n/src/i18n-shared-keys.spec.ts`).
  `common.conference.*` keys are also used by mobile — **do not change their
  values**; add new web-only keys under `web.conference.*`. Web dev and web
  vitest read `@chatofy/i18n` from `dist`, so rebuild after editing:
  `pnpm --filter @chatofy/i18n build`.

## Tasks

### Task 1.1 — Fix the mid-call login redirect parameter

- Goal: an expired session mid-call returns the user to the same room after sign-in.
- Target files: `apps/web/src/hooks/use-conference.ts`, function `redirectToLogin`.
- Steps:
  1. Replace the query parameter name `callbackUrl` with `next` (both the local const name and the URL). Keep the value `window.location.pathname + window.location.search`.
- Success criteria: the URL built is `/login?next=<encoded path>`.
- Verify: `grep -n "callbackUrl" apps/web/src/hooks/use-conference.ts` prints nothing (exit code 1), and `grep -n "/login?next=" apps/web/src/hooks/use-conference.ts` prints one line.

### Task 1.2 — Add the landing i18n keys

- Goal: every new visible string exists in en and vi.
- Target files: `packages/i18n/src/en.ts`, `packages/i18n/src/vi.ts`.
- Steps:
  1. Add these keys next to the other `web.conference.*` keys, same order in both files:
     - `web.conference.newMeeting` — en "New meeting", vi "Cuộc họp mới"
     - `web.conference.codeOrLink` — en "Meeting code or link", vi "Mã hoặc link cuộc họp"
     - `web.conference.codeOrLinkPlaceholder` — en "Paste a link or enter a code", vi "Dán link hoặc nhập mã"
     - `web.conference.joinAction` — en "Join", vi "Tham gia"
     - `web.conference.joiningAs` — en "Joining as {name}", vi "Tham gia với tên {name}"
     - `web.conference.landingLead` — en "Meet with translated speech and captions.", vi "Họp với giọng nói và phụ đề được dịch."
  2. Use the interpolation syntax the catalog already uses (look at `common.conference.reconnecting` for `{attempt}`).
  3. Run `pnpm --filter @chatofy/i18n build`.
- Success criteria: both catalogs carry all six keys; dist rebuilt.
- Verify: `pnpm --filter @chatofy/i18n test` exits 0.

### Task 1.3 — Add a link/code parser

- Goal: one pure function turns what a user pastes into a room id or `null`.
- Target files: create `apps/web/app/(app)/conference/utils/parse-room-input.ts` and `apps/web/app/(app)/conference/utils/parse-room-input.spec.ts`.
- Steps:
  1. Export `parseRoomInput(raw: string): string | null`.
  2. Trim. If it parses as a URL (`new URL(raw)` inside try/catch), take the path segment right after `conference` (`/conference/<id>` or `/conference?room=<id>` — check the `room` search param too, for links made by the old lobby). Otherwise use the trimmed text.
  3. Return the candidate only if `conferenceRoomIdSchema.safeParse(candidate).success` (import from `@chatofy/types/events`), else `null`.
  4. Spec cases: bare id → id; `https://x.y/conference/<id>` → id; `https://x.y/conference/<id>?name=An&lang=vi` → id; `https://x.y/conference?room=<id>` → id; `"  <id>  "` → id; `"hello"` → null; `""` → null. Use `cl9ebqhxk00003b600tymydho` as the id (a valid cuid used in other specs).
- Success criteria: spec passes.
- Verify: `pnpm --filter web exec vitest run "app/(app)/conference/utils/parse-room-input.spec.ts"` exits 0 and reports 7 passed.

### Task 1.4 — Rewrite the landing page

- Goal: the landing described in **Goal**, with no name or language field.
- Target files: `apps/web/app/(app)/conference/page.tsx`.
- Steps:
  1. Remove: the name `Input` and its state, `validName()`, the `SegmentedControl` and `sourceLanguage` state, the camera preview `<video>` and its effect, the `roomPath(roomId, name, lang)` helper.
  2. Add `function roomPath(roomId: string): Route` returning `` `/conference/${encodeURIComponent(roomId)}` as Route ``.
  3. Keep the active-call bounce `useEffect`, but it now needs only `roomId` from the stored JSON: if `active.roomId` is a string, `router.replace(roomPath(active.roomId))` (still skipped when `sharedRoom` names a different room). Do not require `name`.
  4. If the URL has `?room=<id>` (old links) and it is valid, `router.replace(roomPath(id))` immediately.
  5. Layout, top to bottom, inside the existing `mx-auto flex w-full max-w-md flex-col gap-6 py-8` wrapper: `h1` `common.conference.lobbyTitle`; a `p` with `text-textMuted` showing `web.conference.landingLead`; `Button` (default variant — the ONE filled control) with a `Video` icon from `lucide-react` and text `web.conference.newMeeting` (`common.conference.creating` while creating); a `Label` `web.conference.codeOrLink` + row of `Input id="conf-room"` (placeholder `web.conference.codeOrLinkPlaceholder`) and `Button variant="outline"` `web.conference.joinAction`, disabled while the trimmed input is empty; the error line (`role="alert"`) unchanged; a `p` `text-hint text-textMuted` with `web.conference.joiningAs` and `{ name }` from `useSession().data?.user?.name`, rendered only when a name exists.
  6. (Intended consequence of step 3: returning to an active call now lands on the room's pre-join screen, one "Join now" click away. Do not add auto-join.) Join: `parseRoomInput(value)`; `null` → `setError(t('common.conference.roomNotFound'))`; else `router.push(roomPath(id))`. Pressing Enter in the input triggers Join (wrap the row in a `<form onSubmit>` with `e.preventDefault()`).
  7. Create: `createConference()` then `router.push(roomPath(room.id))`; on failure `common.conference.createFailed`.
  8. Update the file's top doc comment to describe the new landing and its budget ("New meeting is the one accent-filled control; Join is outline").
- Success criteria: the page renders no name input and no language control; the only `data-variant="default"` button is New meeting.
- Verify: `grep -c "conf-name\|SegmentedControl\|getUserMedia" "apps/web/app/(app)/conference/page.tsx"` prints `0` (grep exits 1 when the count is 0 — that exit code is the expected PASS), and `pnpm --filter web typecheck` exits 0.

### Task 1.5 — Update the accent-budget rows for the landing

- Goal: the gate covers the new landing.
- Target files: `apps/web/src/design/accent-budget-app.spec.tsx` (rows under `// ---- /conference lobby ----`, around line 1065).
- Steps:
  1. Keep `shows: '#conf-room'` on the remaining rows (the code field keeps that id).
  2. Delete the row `'/conference — lobby, refusing to create without a name'`. The landing has no name to refuse, and the "unknown code" state needs typed input, which the table cannot do; task 1.6 covers it.
  3. Keep `filled: 1, surfaces: 0` for both remaining lobby rows. Update the comment above them to "New meeting is the one accent; Join is outline beside the code field."
  4. The `next-auth/react` mock returns `data: null`; leave it — the "Joining as" line is simply absent in these rows.
- Success criteria: the spec still passes with `KNOWN_VIOLATIONS` empty.
- Verify: `pnpm --filter web exec vitest run src/design/accent-budget-app.spec.tsx` exits 0.

### Task 1.6 — Landing behaviour spec

- Goal: lock the behaviour the accent gate cannot see.
- Target files: create `apps/web/app/(app)/conference/page.spec.tsx`.
- Steps:
  1. Copy the mocking pattern of `apps/web/app/(app)/conference/[roomId]/page.spec.tsx` (mock `next/navigation` with a `push`/`replace` spy, mock `@/clients/api-client` `createConference`, mock `next-auth/react` `useSession` returning `{ data: { user: { name: 'An Nguyen' } }, status: 'authenticated' }`). Make `useSearchParams` read a `vi.hoisted(() => ({ query: '' }))` box (pattern: `apps/web/src/design/accent-budget-app.spec.tsx:111`) so case (e) can set `?room=`.
  2. Typing into the code field: React ignores a direct `input.value = …`. Use the native-value-setter + `dispatchEvent(new Event('input', { bubbles: true }))` pattern from `apps/web/src/components/auth/login-form.spec.tsx`.
  3. Cases: (a) shows "Joining as An Nguyen"; (b) typing a full room link and pressing Join calls `push('/conference/cl9ebqhxk00003b600tymydho')`; (c) typing `hello` and pressing Join shows the not-found alert and does not push; (d) New meeting with `createConference` resolving `{ id: 'cl9ebqhxk00003b600tymydho' }` pushes the bare room path; (e) `?room=cl9ebqhxk00003b600tymydho` calls `replace('/conference/cl9ebqhxk00003b600tymydho')`.
- Success criteria: 5 tests pass.
- Verify: `pnpm --filter web exec vitest run "app/(app)/conference/page.spec.tsx"` exits 0 and reports 5 passed.

## Phase exit check

- Verify: `pnpm --filter web test` exits 0 and `pnpm --filter web lint` exits 0 with no new warnings in touched files.

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
