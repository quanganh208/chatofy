# Video conferencing: system design v2 synthesis

> **Status: Working design — PoC proven, production gates pending.**
> This document synthesises the decisions and findings from Issues #207–#212.
> It supersedes the "open decisions" sections in
> [video-conferencing-architecture.md](../video-conferencing-architecture.md) for anything
> listed here. That document's vision and reuse table remain the reference; this one records
> what was actually decided and what is still blocked on hardware testing.

**Date:** 2026-10-06
**Branch:** `video-conferencing`

---

## 1. Resolved decisions

### Decision 1 — SFU library: mediasoup (resolved by #207)

mediasoup 3.x as an in-process NestJS module. The PoC (`feat/207-mediasoup-poc`) proved the
full signaling round-trip: two browser tabs join the same room, both produce and consume
each other's tracks, consumer resume works.

Artefacts committed:

- `apps/api/src/modules/conference/` — `ConferenceGateway`, `ConferenceRoomRegistry`, `ConferenceModule`
- `apps/web/app/(app)/conference-poc/page.tsx` — PoC UI (two-tab test, not production)
- All gateway handlers use `ws.send()` directly (not NestJS `return`), matching the proven
  translate gateway pattern. Each handler is wrapped in try-catch; errors reply with `{ error: string }`.

**Remaining gate:** upgrade `mediasoup-client` from pinned `3.7.18` to a current matching pair
with the server library (latest as of 2026-10-01: `3.24.4`); re-run the PoC. Not done yet — the
PoC works on the old pin, but the gap is a production risk.

---

### Decision 2 — Media network path: Path A (resolved by #208)

The Cloudflare Tunnel carries HTTP/WS only; UDP has no public path. mediasoup (ICE-lite) needs
to be reachable on its own public address — TURN does not substitute for server reachability.

**Chosen: Path A — expose media ports on the existing host + Cloudflare TURN as client fallback.**

```
Client (UDP)  ──── UDP 40000–49999 ────────► mediasoup (NestJS API, public IP)
Client (TURN) ──── TURNS/443 ──────────────► Cloudflare TURN ──► mediasoup    (NAT/firewall fallback)
Browser       ──── WSS ────────────────────► Cloudflare Tunnel ──► /ws/conference (signaling, unchanged)
```

Required host changes (not yet applied to production):

| Step       | Command / config                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| Open ports | `ufw allow 40000:49999/udp` (RTP), `ufw allow 3478/udp` + `3478/tcp` (TURN), `ufw allow 5349/tcp` (TURNS)  |
| prod.env   | `MEDIASOUP_ANNOUNCED_IP=<host public IPv4>`, `TURN_URL=turn:<ip>:3478`, `TURN_USERNAME`, `TURN_CREDENTIAL` |
| coturn     | `docker compose -f docker-compose.prod.yml up -d coturn`                                                   |
| Verify     | `docker logs coturn --tail 20` — expect no permission errors                                               |

All three are documented in [`.env.example`](../../apps/api/.env.example) and
[`deployment-guide.md`](../deployment-guide.md).

**Remaining gate:** measure connectivity from ≥ 2 networks (home Wi-Fi + mobile 4G). Cannot be
done without hardware access to the production host.

---

### Decision 3 — Translation inside meeting: Option A client-side capture (resolved by #209)

Each client opens its mic twice:

1. Into the mediasoup `sendTransport` (SFU, for the room).
2. Into `/ws/translate` (the existing translation pipeline, unchanged).

The server-side gateway receives `conference.translation.broadcast` messages and fans them out
as `conference.translation.subtitle` and `conference.translation.audio` to all room peers.
No new server-side audio processing; no `PlainTransport`; no FFmpeg or decode step.

**Measured latency (2026-10-06, local dev, 2-tab PoC, single machine):**

| Measurement                     | Cold session        | Warm session        | Notes                          |
| ------------------------------- | ------------------- | ------------------- | ------------------------------ |
| T1→T2 (mic → translated output) | ~9.2 s              | ~5.9 s              | warm = model already streaming |
| T3 final subtitle at listener   | 14.8 s (page-clock) | 16.0 s (page-clock) | cross-tab clocks, not Δ        |
| T4 first TTS audio at listener  | 12.0 s (page-clock) | 10.2 s (page-clock) | cross-tab clocks, not Δ        |

**Acceptance criterion "latency numbers come from a run, not an estimate" — satisfied.**
Full measurement detail and reproduction steps: `docs/video-conference-translation-audio.md §4`.

---

### Decision 4 — Client support (resolved by #210)

| Client                         | SDK                                        | Status                                                                                                                   |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Web (Next.js 16)**           | `mediasoup-client`                         | Works on 3.7.18. Upgrade to 3.24.4 needed before production.                                                             |
| **Mobile (Expo 55 / RN 0.83)** | `mediasoup-client` + `react-native-webrtc` | Requires dev client (not Expo Go). PoC code in `apps/mobile/app/(app)/conference-poc.tsx`. Real-device test **pending**. |
| **Extension**                  | n/a                                        | Out of scope. Extension translates third-party meetings via tab audio capture; adding its own SFU session is deferred.   |

Mobile requires `@config-plugins/react-native-webrtc` and `react-native-webrtc` in the config
plugins array. `eas build` produces the dev client; no Expo Go path.

---

## 2. Load constraints (pending #211)

The sidecar concurrency ceiling matters: each speaker's voice goes through STT and TTS once per
meeting, but translation goes through MT once per target language. In a K-participant meeting
with N speakers active simultaneously:

```
STT demand = N × 1            (one lane per active speaker per turn)
MT demand  = N × (K−1)        (translate into each listener's language)
TTS demand = N × distinct_target_languages
```

The sidecar semaphore (`LOCAL_STT_CONCURRENCY=4` default) hard-limits concurrent decodes.
A 503 on a lane means that speaker's turn is dropped silently on the listener's side.

**Target:** 5 simultaneous participants, each taking 1 turn every 10 s, in a mixed vi/en room.
Steady-state: 2 STT lanes, 2–4 MT calls, 2–4 TTS lanes. Within the default concurrency ceiling
only when turns do not overlap. Burst overlap (3+ speakers at once) will hit the ceiling.

**Required measurement (#211):**

- Hardware: same machine that runs production (CPU, RAM documented in `deployment-guide.md`).
- Load profile: 5 participants, 1-turn-per-10s cadence, 30-minute session.
- Record: STT 503 rate, translation p95, TTS p95, CPU%, memory delta.
- Acceptance threshold: < 5% STT 503 rate at the 5-participant baseline.

Results will go in `docs/architecture/video-load-test-results.md` (not yet created).

---

## 3. Implementation sequence (what must land before production)

Items are ordered by dependency. Each maps to a branch or issue.

| #   | Item                                       | Depends on         | Blocks              |
| --- | ------------------------------------------ | ------------------ | ------------------- |
| 1   | Open host ports + coturn in prod.env       | Manual host access | 2, 3                |
| 2   | Connectivity measurement (2 networks)      | 1                  | production sign-off |
| 3   | `mediasoup-client` upgrade 3.7.18 → 3.24.4 | —                  | 4                   |
| 4   | Re-run PoC after upgrade, cross-browser    | 3                  | production sign-off |
| 5   | Latency measurement for translation        | Running stack      | #209 AC             |
| 6   | Load test (5 participants, 30 min)         | Running stack      | #211 AC             |
| 7   | Mobile real-device test                    | Dev client build   | #210 AC             |
| 8   | Production conference screens (4 screens)  | 1–7                | shipping            |

Items 1–7 are all hardware- or environment-gated. None can be done from the repository alone.

---

## 4. What is NOT changing

The following existing systems are reused unchanged by the v2 design:

- `/ws/translate` pipeline — no changes; the conference client opens a second session to it.
- `TranslationContext` (per-meeting context hints) — reused as-is.
- Auth (`JwtStrategy`, WebSocket upgrade auth) — reused; the conference gateway uses the same `createVerifyClient`.
- Redis (refresh tokens) — no new use added yet; room state is in-process (`ConferenceRoomRegistry`).
- R2 bucket — no recording wired yet; deferred to a later issue.
- Extension — stays translating third-party meetings; no SFU session added.

---

## 5. Open questions (not yet decided)

| #   | Question                                | Notes                                                                                                                            |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Recording storage path                  | R2 existing bucket (public-read) vs. a private bucket. Privacy implications unresolved.                                          |
| Q2  | Room persistence                        | `ConferenceRoomRegistry` is in-process (lost on restart). Redis-backed room state needed for multi-instance or graceful restart. |
| Q3  | Per-participant per-language TTS output | Today: one TTS voice per language. Multi-participant TTS voice identity (who is speaking) is not differentiated.                 |
| Q4  | Multi-instance scaling                  | All mediasoup Workers share one server process; cross-instance rooms require a data-plane protocol (beyond thesis scope).        |
