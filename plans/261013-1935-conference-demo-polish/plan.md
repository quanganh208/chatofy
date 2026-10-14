# Plan: Conference Demo Polish

Four polish items on top of the demo-ready conference feature (plan
`261012-2243-conference-demo-ready`, Phases 1–3+5 merged on `video-conferencing`), to make
the live thesis demo run smoothly and look finished.

- **Outcome:** on-stage demo where translated audio reliably plays, the ~6 s translation gap
  does not look frozen, the active speaker and subtitles read clearly, and a transient network
  blip does not end the call.
- **Base branch:** `video-conferencing` (current).
- **Timestamp:** 261013-1935.

## In scope (the four brainstorm-accepted items)

| #   | Item                                                                                  | Phase |
| --- | ------------------------------------------------------------------------------------- | ----- |
| A   | Audio unlock — resume the suspended `AudioContext` + a "tap to enable sound" fallback | 1     |
| B   | "Translating…" pending indicator during the speech→subtitle gap                       | 2     |
| C   | Active-speaker ring + clearer subtitle styling                                        | 3     |
| D   | Auto-reconnect on a transient mid-call WS drop                                        | 4     |

## Non-goals

Recording, billing, speaker-embedding persistence (deferred #212); mobile; `main` merge;
production hardening; changing the ~6 s translation latency (server/sidecar-bound, not a client
fix); touching `conference-poc/` (the #211 benchmark client).

## Constraints

- One host / loopback demo; no cross-network assumptions.
- **Design spec stays green** — `apps/web/src/design/accent-budget-app.spec.tsx` + contrast
  specs. Leave remains the single accent-filled control; an active-speaker ring and subtitle
  styling are readouts/highlights, not accent controls, but every phase that touches the screen
  MUST re-run the spec and keep it green.
- `useConference` public surface is additive-only (append fields; never rename/remove) so the
  in-call page and any future consumer keep working.
- Any new i18n key lands in BOTH `packages/i18n/src/en.ts` and `vi.ts`, and
  `pnpm --filter @chatofy/i18n build` runs before web typecheck (new `MessageKey`s resolve from
  built dist, not src — this bit Phase 1 of the prior plan).

## Current `useConference` surface (the contract phases build on)

```
useConference(roomId, { displayName, sourceLanguage }) => {
  status: 'idle'|'connecting'|'in-call'|'disconnected'|'error';
  errorReason?: ConferenceErrorReason;
  localStream: MediaStream | null;
  peers: Map<socketId, { displayName; stream; subtitle?; muted; videoEnabled }>;
  mySocketId; localMuted; localVideoEnabled;
  join(); leave(); toggleMute(); toggleVideo();
}
```

TTS playback is `TranslationAudioSink` (`apps/web/src/hooks/use-translation-audio-sink.ts`):
one `AudioContext` per speaker, created lazily in `getOrCreate` — **with no `resume()`** (item A).

## Phases & sequencing

| Phase | Item                                | Touches the hook?           | Effort |
| ----- | ----------------------------------- | --------------------------- | ------ |
| 1     | A audio unlock                      | yes (hook + sink)           | S      |
| 2     | B translating indicator             | yes (hook)                  | M      |
| 3     | C active-speaker + subtitle styling | no (components only)        | S      |
| 4     | D auto-reconnect                    | yes (hook — join lifecycle) | L      |

- **Phases 1, 2, 4 all edit `use-conference.ts` → they MUST run sequentially** (no two agents on
  that file at once). Order: 1 → 2 → 4.
- **Phase 3 is components-only** (`video-grid.tsx`, `subtitle-overlay.tsx`) and may run in parallel
  with any ONE hook phase, or slot anywhere. Simplest: run it between 2 and 4, or last.
- Recommended execution order: 1 → 2 → 3 → 4 (D last; it is the largest and riskiest, and the
  demo already degrades gracefully to the lobby without it).

## Risks

| Risk                                                          | Mitigation                                                                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audio still suspended after `resume()` (no user gesture yet)  | Phase 1 ships the visible "tap to enable sound" fallback as the guaranteed path; `resume()` on join is the optimistic one                                                                        |
| Reconnect (D) reintroduces a bug into the working join path   | D extracts the join sequence without changing its behavior first, then adds retry around it; keep the graceful dead-end as the exhaustion case; D is last so a cut loses nothing already shipped |
| Active-speaker ring read as a second accent → design spec red | Use a neutral/ring token, not `bg-primary`; re-run the accent-budget spec in Phase 3                                                                                                             |
| "Translating" state never clears (no final subtitle arrives)  | Clear on final subtitle OR a timeout, whichever first — never a permanently stuck badge                                                                                                          |

## Verification per phase

| Phase | Pass check                                                                                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `resume()` called; a suspended-context path shows the tap-to-enable affordance and clears on tap; typecheck + build + test green                                                               |
| 2     | Local tile shows a "translating…" badge after you speak and clears on the final subtitle (or timeout); specs green                                                                             |
| 3     | Active speaker's tile is visibly highlighted; subtitles larger/clearer; accent-budget + contrast specs green                                                                                   |
| 4     | A simulated mid-call socket close triggers reconnect attempts with a visible "reconnecting" state, recovers media on success, and dead-ends to the lobby only after the retry cap; specs green |

Runtime multi-tab smoke (audio actually audible; reconnect across a real drop) is manual (live
stack) — documented, not gated here.

## Rollback

Every phase is additive and revertible per file. Phase 4 keeps the existing `disconnected`
dead-end as the fallback, so reverting D restores exactly today's behavior. No server changes.

## Unresolved questions

None blocking. Phase 4's retry cap/backoff values (e.g. 3 attempts, 1s/2s/4s) are a sensible
default the executor may set; flag if the demo wants a different ceiling.
