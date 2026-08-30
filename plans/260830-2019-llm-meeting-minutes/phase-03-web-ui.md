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

## Remaining in this phase

- [ ] **`apps/extension` minutes UI.** The mapper is already shared, but the
      extension is NOT a React/`@chatofy/ui` surface — it renders a vanilla-DOM
      overlay in a content script (`meeting-transcript.ts`, `overlay-invariants`).
      So `MinutesPanel` does not port as-is; the extension needs its own overlay
      rendering that calls `toMinutesSourceTurns` + a `generateMinutes` fetch.
      Separate, browser-verified task.
- [ ] **Browser verification** of the web flow: a real vi↔en conversation →
      Generate → eyeball the four sections and copy-to-markdown.

## Verify

- Done (2026-08-30): typecheck green for `@chatofy/i18n`, `@chatofy/realtime-client`,
  and every touched `apps/web` file (the 25 remaining web `tsc` errors are the
  pre-existing Next typed-routes class, none in minutes files); `minutes-source.spec.ts`
  4/4; `minutes-panel.spec.tsx` 6/6.
- Owed: a browser run of a real vi↔en conversation → Generate → eyeball the four
  sections, after the wiring above lands.
