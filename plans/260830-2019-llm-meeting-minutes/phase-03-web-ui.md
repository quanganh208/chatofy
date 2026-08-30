# Phase 3 — Web / extension UI

**State: foundation done (mapper + client + i18n + hook + panel, all verified).
Two pieces deferred: wiring the panel into the live translate surface, and the
extension copy — both need the running app/browser to verify meaningfully.**

## Delivered

- [x] Turn → request mapper: `toMinutesSourceTurns()` in `@chatofy/realtime-client`
      (`state/minutes-source.ts`, exported). Roster label → a/b-role fallback →
      SOURCE text, empty turns dropped, spoken order. Unit-tested
      (`minutes-source.spec.ts`, 4 cases). This is the ONE shared projection both
      surfaces call — no per-app re-derivation.
- [x] Web client: `generateMinutes(sessionId, turns, language?)` + `getMinutes`
      in `apps/web/src/clients/api-client.ts`, through the contract-validating
      `apiFetch` (owner-scoped server-side; no user id ever passed).
- [x] i18n: `web.translate.minutes.*` in `@chatofy/i18n` en + vi (17 keys),
      parity enforced by tsc.
- [x] `useMinutes` hook (`apps/web/src/hooks/use-minutes.ts`) — request state
      machine (loading / minutes / error / generate / reset).
- [x] `MinutesPanel` (`apps/web/src/components/translate/minutes-panel.tsx`) —
      presentational: summary, key points, decisions, action items with owner/due
      badges; Generate/Regenerate (disabled while loading or nothing to
      summarize); copy-to-markdown. `@chatofy/ui` primitives, no new tokens.
      Component-tested (`minutes-panel.spec.tsx`, 6 cases).

## Delivered (continued)

- [x] **Wired `MinutesPanel` into `cascade-panel.tsx`.** The panel renders after
      the transcript once the conversation has stopped (`!running && turns > 0`,
      beside the attribution stats). `useMinutes` holds the request; Generate
      passes `toMinutesSourceTurns({ turns, speakers, attributions })`, a
      per-mount client session id (the API has no conversation id to reuse yet),
      and the UI `locale` as the minutes language. Typecheck clean — the only
      remaining web `tsc` errors are the pre-existing Next typed-routes class,
      none in `cascade-panel`.

## Extension — delivered

- [x] **Pure mapper `overlayLinesToMinutesSource`** (`apps/extension/src/minutes-source.ts`).
      The extension has no roster — the overlay carries `TranscriptLine[]` sided by
      `origin` (`them`/`me`) — so this is the extension counterpart of
      `toMinutesSourceTurns`: final lines only, SOURCE text, side → localized label
      supplied by the caller, spoken order preserved. Unit-tested (4 cases). This
      is the safe, verifiable half; the overlay wiring below is browser-only.

## Extension overlay wiring — design (browser-verified, not built offline)

The overlay is a message-passing system, not a component, and cannot be proven
without a live meeting. The plan of record:

1. **State + protocol** (`messages.ts`): add `minutes?: MinutesOverlayState` to
   `OverlayState` (`{ status: 'idle'|'loading'|'ready'|'error'; minutes?: MeetingMinutes }`),
   and two messages — `{ to:'worker'; type:'generateMinutes' }` and the render
   already carries the new field.
2. **Source** (`meeting-transcript.ts`): expose the merged, ordered
   `TranscriptLine[]` the overlay already builds; the worker maps it with
   `overlayLinesToMinutesSource(lines, { them, me })`, the labels localized from
   `settings`. Widen `RETAINED_TURNS` or keep a separate unbounded final-line log
   if minutes must cover more than the retained window (decision to make with a
   real meeting's length in view — `managed-datastore-write-cost-discipline` does
   not apply, this is in-memory).
3. **Worker** (`entrypoints/background.ts`): on `generateMinutes`, `loadAccessToken()`,
   `POST ${apiBaseUrl}/sessions/${captureSessionId}/minutes` with the bearer (the
   exact fetch shape `access-token.ts` already uses), publish `loading` →
   `ready`/`error`. A 401 clears the token exactly as `verifyAccessToken` does.
4. **Render** (`entrypoints/content/overlay.ts` + `overlay-styles.ts`): a Generate
   button and a minutes section (summary / key points / decisions / action items),
   built with the same `createElement` idiom the overlay uses today. Reuse the
   overlay's existing bounded-window styling.
5. **Verify in-browser**: load unpacked, join a supported meeting, run a real
   vi↔en exchange, Generate, eyeball the four sections; confirm a 401 (signed-out)
   surfaces the sign-in prompt rather than a silent failure.

## Remaining in this phase

- [ ] Build the extension overlay wiring per the design above (browser session).
- [ ] **Browser verification** of the web flow: a real vi↔en conversation →
      Generate → eyeball the four sections and copy-to-markdown.

## Verify

- Done (2026-08-30): typecheck green for `@chatofy/i18n`, `@chatofy/realtime-client`,
  and every touched `apps/web` file (the 25 remaining web `tsc` errors are the
  pre-existing Next typed-routes class, none in minutes files); `minutes-source.spec.ts`
  4/4; `minutes-panel.spec.tsx` 6/6.
- Owed: a browser run of a real vi↔en conversation → Generate → eyeball the four
  sections, after the wiring above lands.
