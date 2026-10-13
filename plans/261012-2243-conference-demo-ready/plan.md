# Plan: Video Conference — Demo-Ready Completion

Raise the existing mediasoup conference PoC to a **thesis-demo-ready** feature: a real
`/conference` route (lobby + in-call UI) using the project's design tokens and i18n,
2–6 participants with video + audio + **working bidirectional** realtime translation and
stable subtitles on a single host / loopback.

- **Goal target:** demo đồ án chạy được (shortest path to a smooth live demo). NOT a
  `main` merge, NOT production hardening.
- **Merged scope (2026-10-13):** the web demo (Phases 1–5) ships first and is the
  critical path. Mobile React Native parity (Phases 6–7, folded in from the
  superseded `261012-2241-conference-ui-ux` plan) follows the web demo and reuses
  the Phase 1 `useConference` signaling core. Mobile is explicitly post-demo, not
  part of the shortest path.
- **Base branch:** `video-conferencing` (current) — already carries the full PoC:
  gateway `/ws/conference`, SFU worker/registry, translation router, persistence,
  participant mute/video/leave events, N-peer grid PoC page.
- **Timestamp:** 261012-2243

## In scope

1. Production `/conference` route: create/join lobby + in-call screen (replaces the
   dev-only `/conference-poc`, which stays as a measurement tool).
2. In-call UI: responsive video grid, control bar (mic/cam/leave), participant roster,
   subtitle overlay — built on `@chatofy/ui` tokens + `@chatofy/i18n`.
3. Translation correctness: fix the hardcoded `_to_en` so vi↔en works **both ways**;
   replace the per-frame `AudioContext` with an ordered playback queue; partial/final
   subtitle handling by `turnId`.
4. Demo polish: permission/edge-case handling, a demo runbook, end-to-end smoke.

## Explicitly OUT of scope (deferred #212 or not needed for demo)

- Recording, billing, speaker-embedding persistence (deferred #212).
- `main` merge, production hardening, Prometheus/monitoring, load test.
- Closing the pending gates — they are recorded as **demo risks**, not tasks:
  mobile real-device (#210), ≥2-network media reachability (#208), multi-speaker
  concurrent translation load.
- Chat + conference minutes are **optional** (Phase 4 / stretch) — included only if light.

---

## Current state (what the PoC already proves — grounded in code)

| Capability                                                        | Where                                      | Status                      |
| ----------------------------------------------------------------- | ------------------------------------------ | --------------------------- |
| SFU join/transport/produce/consume/resume                         | `conference.gateway.ts`                    | Working                     |
| N-peer video + audio exchange (loopback)                          | `conference-poc/page.tsx`                  | Working                     |
| Translation fan-out with self-filter + same-lang skip             | `conference-translation-router.service.ts` | Working (one-way, see gap)  |
| Subtitle + TTS-audio broadcast events + zod contracts             | `conference-translation-events.ts`         | Working                     |
| Participant mute / video / leave + `conference.participant.state` | `conference.gateway.ts`                    | **Server-ready, UI unused** |
| Join/leave/turn persistence                                       | `conference-persistence.service.ts`        | Working (fire-and-forget)   |
| Ghost-peer heartbeat, TURN HMAC, TCP fallback                     | `conference.gateway.ts`                    | Working                     |
| Capacity (6×720p60 viable)                                        | `benchmarks/video` (#211)                  | Measured                    |

### The three real gaps between PoC and demo

1. **One-way translation.** `wireTranslate()` hardcodes `direction = \`${sourceLanguage}_to_en\``and`targetLang: 'en'` (`conference-poc/page.tsx:639,718`). An English speaker produces an
invalid `en_to_en` direction; vi listeners never get Vietnamese. Bidirectional vi↔en is the
   fix (Phase 3).
2. **Choppy translated audio.** A fresh `new AudioContext()` is created **per TTS frame**
   (`page.tsx:342`) → overlapping, out-of-order playback and a context leak. Needs one shared
   context + an ordered scheduled queue (Phase 3).
3. **No product UI.** The only screen is an inline-styled dev page at `/conference-poc` with a
   console log, no design tokens, no i18n, no create/join flow, and the mute/cam/leave controls
   the server already supports are not wired (Phases 1–2).

---

## Phases

| Phase | Goal                                                                               | Effort | Blocked by |
| ----- | ---------------------------------------------------------------------------------- | ------ | ---------- |
| 1     | Production `/conference` route + lobby + reusable `useConference` hook             | L      | —          |
| 2     | In-call UI: grid, control bar, roster, subtitle overlay (tokens + i18n)            | L      | 1          |
| 3     | Translation robustness: bidirectional routing + ordered audio + subtitle stability | M      | 1          |
| 4     | _(Optional / stretch)_ lightweight in-meeting chat                                 | S      | 2          |
| 5     | Demo polish, edge cases, runbook, end-to-end smoke                                 | M      | 2, 3       |
| 6     | _(Post-demo)_ Mobile RN lobby + call view, reusing the Phase 1 core                | L      | 1, 2       |
| 7     | _(Post-demo)_ Mobile RN translation UX (overlay + transcript + audio)              | M      | 3, 6       |

- **Critical path:** 1 → 2 → 5 ; Phase 3 parallel-safe after 1 (touches the hook + gateway
  router, disjoint from Phase 2's components if the hook's translation internals are landed in 3).
- **Parallel-safe:** Phase 2 (components) and Phase 3 (hook translation internals + server router)
  can proceed concurrently **only if** Phase 1 has extracted `useConference` and frozen its
  public surface. Otherwise sequence 1 → 3 → 2.

Phase detail: `phase-01-...` … `phase-05-...`.

---

## Key reuse (don't rebuild)

- **Signaling + mediasoup-client lifecycle** — lift verbatim from `conference-poc/page.tsx`
  into `useConference`; it already handles device load, send/recv transports, late-joiner
  catch-up, new-producer, peer joined/left.
- **Auth** — `getSession().accessToken` + `WS_SUBPROTOCOL` subprotocol handshake, unchanged.
- **Translation pipeline** — `/ws/translate` live mode (`client.live.start/audio/stop`),
  unchanged; only the `direction` computation and the audio sink change.
- **Ordered playback** — `@chatofy/realtime-client` already owns ordered audio playback
  (README §realtime-client). Reuse it for the TTS sink in Phase 3 rather than hand-rolling.
- **UI** — `@chatofy/ui/react` shadcn components + `packages/ui/src/tokens.ts`; `@chatofy/i18n`
  for every string.

---

## Cross-cutting constraints

- **Next.js is non-standard here.** `apps/web/AGENTS.md`: read the relevant guide under
  `node_modules/next/dist/docs/` before writing web code.
- **Design gates are enforced specs.** A new app screen is subject to the accent-budget and
  contrast specs (`apps/web/src/design/`, `docs/design-guidelines.md` — see
  `.claude/rules/development-rules.md`). Phase 2 must register `/conference` in the accent-budget
  app spec and keep ≤1 accent control + ≤2 elevated surfaces per screen-state.
- **Overlay-into-video-page caveat does not apply** — this is our own app screen, not a meeting
  page we patch; normal tokens/components are fine.
- Keep `/conference-poc` intact (it is the #211 benchmark client).
- Commit style: no `chore`/`docs` scope on `.claude` changes; no AI attribution trailers
  (`CLAUDE.md` → Git).

---

## Risks (demo-facing)

| Risk                                                                                                            | Impact              | Mitigation                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| 3+ simultaneous speakers saturate `MAX_CONCURRENT_TURNS_GLOBAL=6` / `LOCAL_STT_CONCURRENCY=4` → translation lag | Demo stutters       | Phase 3: raise both via env for the demo; document in runbook; demo with ≤3 active speakers               |
| Translation end-to-end ~6 s (warm) feels slow on stage                                                          | Audience perception | Lead with subtitle (faster than TTS); script the demo to speak in short turns; state the measured latency |
| Cross-machine media needs UDP 40000–49999 / TURN (#208 unmeasured)                                              | Remote demo fails   | Demo on one host / loopback (no TURN needed — PoC-confirmed); keep remote as stretch only                 |
| Mobile untested on real device (#210)                                                                           | —                   | Demo on web only; note mobile as future work                                                              |
| New `/conference` screen trips an enforced design spec                                                          | CI/red              | Phase 2 updates the accent-budget app spec in the same change                                             |

---

## Verification per phase

| Phase | Pass check                                                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `pnpm typecheck` + `pnpm --filter web build` green; `/conference` lobby renders with tokens; join a room via the hook and two tabs still exchange A/V (parity with PoC)      |
| 2     | Mic/cam toggle emits `conference.participant.mute/video` and peers render the state; leave returns to lobby; grid responsive 1–6 tiles; accent-budget + contrast specs pass  |
| 3     | en-speaker → vi-listener hears Vietnamese and sees Vietnamese subtitle (and the reverse); translated audio plays in order with no overlap (single AudioContext); 3-tab smoke |
| 4     | _(if built)_ a message sent in one tab appears in all others in the room                                                                                                     |
| 5     | Denied mic/cam shows a handled state (no crash); runbook reproduces the demo end-to-end from a clean checkout on one host                                                    |
| 6     | _(post-demo)_ a mobile device and a web tab share a room with two-way A/V; mic/cam/leave propagate cross-platform; web demo unregressed                                      |
| 7     | _(post-demo)_ mobile↔web subtitles + ordered translated audio both directions (vi↔en)                                                                                        |

## Rollback

All web work is additive under `apps/web/app/(app)/conference/` + `apps/web/src/hooks/`;
deleting them restores the PoC-only state. Server changes in Phase 3 (router direction, optional
Phase 4 chat handler) are small, isolated edits to the conference module — revertible per file.
`/conference-poc` is never modified.

---

## Unresolved questions

- None blocking Phase 1. Decide before Phase 4 whether chat is in or cut (default: cut unless
  Phases 1–3 land with time to spare).
- Phase 3: confirm the demo language pair stays vi↔en only (the registry holds exactly these
  today); if a third language is wanted for the demo, the target-language routing needs the
  per-listener fan-out variant, which is larger — out of the current shortest-path scope.
