---
phase: 10
title: 'Extension — settings, runner widening, popup picker'
status: complete
priority: P2
effort: '5h'
dependencies: [6]
---

# Phase 10: Extension — settings, runner widening, popup picker

## Goal

Let a meeting run under a chosen context in BOTH directions from one settings
object, with a picker in the popup and no editor.

## Files to Create / Modify

- Modify: `apps/extension/src/messages.ts`
- Modify: `apps/extension/src/settings.ts`
- Modify: `apps/extension/src/settings.spec.ts`
- Create: `apps/extension/src/translation-contexts.ts`
- Create: `apps/extension/src/translation-contexts.spec.ts`
- Modify: `apps/extension/src/meeting-capture.ts`
- Modify: `apps/extension/src/meeting-capture.spec.ts`
- Modify: `apps/extension/src/live-direction-session.ts`
- Modify: `apps/extension/src/live-direction-session.spec.ts`
- Modify: `apps/extension/entrypoints/popup/use-popup.ts`
- Modify: `apps/extension/entrypoints/popup/settings-pane.tsx`
- Modify: `apps/extension/src/popup-render.spec.tsx`

## Constraint — a new `MeetingCaptureDeps` field MUST be optional

If the context loader is injected through `MeetingCaptureDeps`
(`apps/extension/src/meeting-capture.ts:57`) rather than imported directly, it
must be declared OPTIONAL (`loadContextHints?: ...`).

`apps/extension/src/fake-meeting-audio.ts:196` builds a
`const deps: MeetingCaptureDeps = { ... }` object literal. A new REQUIRED field
makes that literal fail `pnpm --filter extension typecheck` with a missing-property
error, in a file this phase does not otherwise touch. Either declare the field
optional, or add `apps/extension/src/fake-meeting-audio.ts` to the file list above
and populate it there.

## Tasks & Steps

1. `messages.ts`: `CaptureSettings` (`:18-49`) gains
   `contextId?: string` — the id only, with a docblock saying the content is
   fetched from the API because the popup and the web app share a bearer token
   and nothing else.
2. `settings.ts`: `contextId: undefined` in `DEFAULT_SETTINGS` (`:35-44`); the
   existing merge-over-defaults loader (`:46-67`) handles an older stored object
   with no edit. Do **not** whitelist it away — unlike `mode` and `apiBaseUrl`,
   a stale id is harmless: it resolves to nothing and reads as "no context".
3. `translation-contexts.ts`: one `GET /translation-contexts` against
   `settings.apiBaseUrl`, authenticated with `getFreshAccessToken(apiBaseUrl)`
   (`apps/extension/src/access-token.ts:148`) so a capture never uses a token the
   popup happened to store fifteen minutes ago, parsed with
   `translationContextListResponseSchema`, plus `toHints(context)` mirroring the
   web helper. A failure returns an empty list and a message — it must never
   prevent a meeting from starting.
4. `meeting-capture.ts`: widen `DirectionRunner.start` (`:44-48`) to
   `{ direction: TranslationDirection; voiceGender: string; hints?: TranslationHints }`,
   resolve the hints **once** at the start of a capture, and pass the **same**
   hints object to both `inbound.start` (`:341-343`) and `outbound.start`
   (`:454-457`) — which is exactly the case Decision 1 exists for: one settings
   object, two concurrent sessions, opposite directions, one dictionary that is
   correct in both because its entries are keyed by language.
   `direction-session.ts` needs **no change**: `createDirectionSession` returns a
   `ConversationSession`, whose `start` already takes `SessionOptions`, and
   `hints` is already on that type (`ws-events.ts:51-55`).
5. `live-direction-session.ts`: `start` (`:162`) widens its parameter and ignores
   `hints`, saying so in the docblock exactly as it already does for
   `voiceGender` (`:155-161`) — this backend takes no hint parameter, and
   accepting-and-ignoring is what keeps one `DirectionRunner` shape across two
   backends.
6. `use-popup.ts`: fetch the list once when the popup opens, beside the other
   one-shot reads (`:73-80`), and expose `contexts` plus a
   `setContext(contextId)` action that writes through the existing
   `saveSettings`. An MV3 popup dies on blur, so nothing is cached.
7. `settings-pane.tsx`: a picker row using `Select` from `@chatofy/ui/react` —
   **verified available**: the pane already imports eight components from that
   entry point (`:1-13`), and only the content-script overlay is restricted
   (`packages/ui/src/react/index.ts:8-14`). **No editor**: the popup is the wrong
   size for authoring 24 term pairs, and authoring happens on web. Hidden
   entirely when the list is empty or the user is signed out.
8. Specs:
   - `meeting-capture.spec.ts`: `the selected context's hints reach
DirectionRunner.start`, and `both directions receive the SAME hints object`.
   - `live-direction-session.spec.ts`: `the live backend ignores hints without
failing`.
   - `settings.spec.ts`: `a stored object with no contextId loads`, `a contextId
survives the round-trip`, `contextId is not stripped by the whitelist`.
   - `translation-contexts.spec.ts`: `a failed list returns empty rather than
throwing`, `toHints omits an empty glossary`.
   - `popup-render.spec.tsx`: `the picker is hidden with no contexts`, `choosing
one writes settings`.

## Verification

- `pnpm --filter extension test`
  → whole suite green, 0 failed, including the named cases above
  (`at least 10 passed` across the five touched/created spec files).
- `pnpm --filter extension typecheck && pnpm --filter extension lint`
  → both exit 0.
- `pnpm --filter extension build && pnpm --filter extension verify:build`
  → exits 0 (`verify-content-script-css.mjs` and `verify-mv3-csp.mjs` both pass —
  proof the popup's new import did not leak a stylesheet or a CSP violation into
  the content script).
