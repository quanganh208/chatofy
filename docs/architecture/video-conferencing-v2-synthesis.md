# Video conferencing: system design v2 synthesis

> **Status: Built and always loaded; media on Cloudflare Realtime SFU.** This document synthesises the
> decisions and findings from Issues #207–#212 and records what the code on `main` does.
> The API and web load it unconditionally (the former `CONFERENCE_ENABLED` /
> `NEXT_PUBLIC_CONFERENCE_ENABLED` flags are gone); the mobile screens open only in
> development builds.
> [video-conferencing-architecture.md](../video-conferencing-architecture.md) keeps the
> vision, the reuse table and the Open decisions list; this page holds their evidence.

**Date:** 2026-10-06, revised 2026-10-25

---

## 1. Decisions

### Decision 1 — SFU: Cloudflare Realtime SFU (replaced mediasoup from #207)

Meeting media runs on Cloudflare Realtime SFU, driven by the API's conference module
(`apps/api/src/modules/conference/`) over outbound HTTPS; owner decision 2026-10-25, the
reasons in
[Decision 1 of the architecture document](../video-conferencing-architecture.md#1-media-server-sfu--resolved-cloudflare-realtime-sfu-issue-208-2026-10-25).
Each participant has one SFU session to publish on and one to receive on, and the client
never names the tracks it wants: a subscribe asks the server to bring the receiving session
up to date with the room. The module is always imported, and the API refuses to boot
without the Realtime app id and secret.

From 2026-10-05 to 2026-10-25 the module ran mediasoup 3.28 in-process instead, chosen by
the #207 PoC; the comparison below is why mediasoup had won over LiveKit and Pion then.

How the shipped module behaves:

- **Rooms are created by `POST /conference` only** (a cuid id). The link is the access: any
  signed-in user with the id may join. The gateway never creates a `Conference` row. A join
  to an unknown id replies `room_not_found`, to an ended room `room_ended`; the first
  successful join of a `waiting` room marks it `active`. Every join upserts the caller as a
  `ConferenceParticipant`.
- **Errors** come back on the same event name as `{ error: <code> }`, a code from
  `CONFERENCE_ERROR_CODES` in `packages/types/src/events/conference-signaling-events.ts`;
  internal messages are never sent.
- **Endings the server starts.** `DELETE /conference/:id` sends
  `conference.ended { reason: 'ended_by_owner' }` to every peer, closes their sockets with
  code **4001** `ended`, closes their SFU tracks and drops the room. A socket replaced because the
  same user rejoined is closed with **4000** `replaced`. Clients do not reconnect after
  either code, nor retry after `room_not_found` / `room_ended`.

#### Comparison table from #207 (mediasoup, since replaced)

Every cell cites a source or a PoC measurement. "PoC" means observed on
`feat/207-mediasoup-poc` during local testing. The table predates the finding that the
production host accepts no inbound connection, which every self-hosted row here needs.

| Criterion                 | LiveKit                                                                                                                                                                                         | mediasoup                                                                                                                                                                                                   | Pion                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**            | Standalone SFU **server** (Go binary / Docker image) + client SDKs ([livekit/livekit](https://github.com/livekit/livekit), Apache-2.0)                                                          | **Node.js library** — SFU primitives only; C++ Worker child process handles media ([mediasoup.org — Architecture](https://mediasoup.org/documentation/v3/mediasoup/design/))                                | **Go library** — WebRTC primitives; the SFU logic is entirely ours to write ([pion/webrtc](https://github.com/pion/webrtc), MIT)                                     |
| **Fits NestJS stack**     | NestJS mints access tokens only; all media + signaling live inside the LiveKit container ([LiveKit self-hosting](https://docs.livekit.io/home/self-hosting/))                                   | Runs **in-process** with NestJS; Worker is a C++ child process ([mediasoup API — Worker](https://mediasoup.org/documentation/v3/mediasoup/api/#Worker)); PoC confirmed                                      | Needs a Go service + a control channel beside NestJS; no Go toolchain, Dockerfile, or CI job exists in this repo today (verified: `Glob("**/*.go")` returns nothing) |
| **Additional containers** | **1 extra** (livekit-server); recording needs a **second** Egress container ([LiveKit Egress](https://docs.livekit.io/egress/))                                                                 | **0 extra** — Worker spawns as a child process of the API; coturn only needed for non-localhost TURN ([mediasoup Workers](https://mediasoup.org/documentation/v3/mediasoup/design/#Workers)); PoC confirmed | **1 extra** (Go SFU service); footprint depends on our code, unmeasured                                                                                              |
| **License**               | Apache-2.0 ([livekit/livekit LICENSE](https://github.com/livekit/livekit/blob/main/LICENSE))                                                                                                    | ISC ([mediasoup npm](https://www.npmjs.com/package/mediasoup))                                                                                                                                              | MIT ([pion/webrtc LICENSE](https://github.com/pion/webrtc/blob/master/LICENSE))                                                                                      |
| **Mobile (Expo)**         | React Native SDK (`@livekit/react-native`); needs dev build because it depends on `react-native-webrtc` ([livekit/client-sdk-react-native](https://github.com/livekit/client-sdk-react-native)) | `mediasoup-client@3.7.18` + `react-native-webrtc`; also needs dev build ([mediasoup — React Native](https://mediasoup.org/documentation/v3/mediasoup-client/installation/))                                 | Plain `react-native-webrtc`; dev build still needed; no higher-level SDK                                                                                             |
| **Signaling**             | Built in to livekit-server (gRPC + WebSocket); signaling is NOT ours ([LiveKit protocol](https://github.com/livekit/protocol))                                                                  | **Entirely ours** — mediasoup is transport-only; PoC reused the existing `@WebSocketGateway` pattern from `TranslateGateway`                                                                                | Entirely ours; same cost as mediasoup but in Go                                                                                                                      |
| **Implementation effort** | **Lowest** — rooms, simulcast, reconnection, and recording (Egress) come with the server                                                                                                        | **Medium** — signaling, room state, and simulcast layer selection are ours; PoC took ~1 day                                                                                                                 | **Highest** — full SFU logic is ours in Go; the Appendix's 40 h estimate assumed Pion                                                                                |
| **TURN / NAT**            | Needs an open port or TURN relay for media; same as mediasoup ([LiveKit deployment](https://docs.livekit.io/home/self-hosting/deployment/))                                                     | coturn in the dev `docker-compose.yml` (since removed) with `--use-auth-secret`; PoC confirmed loopback works without TURN                                                                                  | Same requirement; same coturn approach                                                                                                                               |

**Why LiveKit was rejected:** it runs as a separate Go server (container), and recording requires a
second Egress container — two extra services for a graduation thesis VM with ~3.4 GiB headroom.
Its built-in signaling also cannot be absorbed into the existing `ws` gateway patterns.

**Why Pion was rejected:** it is a Go library that would add a language, a Dockerfile, and a CI
pipeline the repo has none of today. Effort is higher than mediasoup for no gain relevant to this
project's scope.

---

### Decision 2 — Media network path: Cloudflare Realtime SFU (#208, 2026-10-25)

Clients send media straight to Cloudflare; the tunnel carries signaling only, and the host
opens no port. Path A (public media ports on the host) was recorded here first and is
impossible: the host is on a company network with no inbound port available. The facts and
the measurements are in [video-network-path.md](./video-network-path.md); the decision is
[Decision 7](../video-conferencing-architecture.md#7-network-path-for-meeting-media--resolved-cloudflare-realtime-sfu-issue-208-2026-10-25).

Each join reply carries the ICE servers: Cloudflare's STUN, plus short-lived Cloudflare TURN
credentials when a TURN key is configured (`conference-sfu-ice-servers.ts`).

---

### Decision 3 — Translation inside meeting: Option A client-side capture (resolved by #209)

Each client sends its microphone both into its SFU publish session (for the room) and
into the live mode of `/ws/translate`, then forwards the translated subtitle and audio as
`conference.translation.broadcast`. The gateway fans them out as
`conference.translation.subtitle` (to peers who speak another language) and
`conference.translation.audio` (to peers who speak the audio's language). No server-side
audio processing, no `PlainTransport`. Contract, turn closing and the measured latency:
[video-translation-audio-path.md](./video-translation-audio-path.md) (§2 as built, §7
latency).

---

### Decision 4 — Client support (resolved by #210)

| Client                         | SDK                           | Status                                                                                                                                                             |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Web (Next.js 16)**           | browser `RTCPeerConnection`   | Lobby (Create a room / Join) and call screen under `/conference`, always shown.                                                                                    |
| **Mobile (Expo 55 / RN 0.83)** | `react-native-webrtc` 124.0.8 | Dev client only (not Expo Go). Two-way call proven on an Android phone with the earlier SFU (2026-10-12); on Cloudflare the device run is pending. `__DEV__` only. |
| **Extension**                  | n/a                           | Out of scope. It translates third-party meetings via tab capture; its own SFU session is deferred.                                                                 |

Details, including the end screen that is deferred: [video-client-support.md](./video-client-support.md).

---

## 2. Load constraints (measured on mediasoup — #211, 2026-10-11)

The mediasoup SFU, since replaced, on the Windows 11 dev machine (loopback, headless
Chromium via Playwright), 2 repeats per cell, averages. The harness was removed with
mediasoup; the run is recorded in [development-journey.md](../development-journey.md).
Cloudflare's SFU is not load-tested here; its documented limits are 50 API requests per
second per session and 64 tracks per request
([limits](https://developers.cloudflare.com/realtime/sfu/platform/limits/)).

| Participants | Resolution | Bytes sent (MB/30 s) | Bytes recv (MB/30 s) | Worker RSS (MiB)¹ |
| :----------: | :--------: | :------------------: | :------------------: | :---------------: |
|      2       |   360p30   |         1.81         |         1.85         |       15.4        |
|      2       |   720p30   |         4.61         |         4.71         |       16.4        |
|      2       |   720p60   |         4.91         |         4.94         |       16.5        |
|      3       |   360p30   |         3.52         |         2.69         |       16.5        |
|      3       |   720p30   |        13.06         |         7.24         |       17.1        |
|      3       |   720p60   |        12.21         |         7.45         |       17.3        |
|      4       |   360p30   |         6.52         |         3.65         |       17.5        |
|      4       |   720p30   |        18.72         |         9.71         |       18.1        |
|      4       |   720p60   |        26.69         |         9.95         |       18.5        |
|      6       |   360p30   |        19.19         |         5.64         |       18.5        |
|      6       |   720p30   |        31.96         |        14.22         |       20.0        |
|      6       |   720p60   |        36.60         |        14.27         |       20.5        |

¹ The harness column is `workerRssKB`, but the value is mediasoup's `ru_maxrss` (already
KiB) divided by 1024, so it is MiB: a worker of 15–20 MiB, growing about 5 MiB from 2 to 6
peers. Worker CPU reads 0% because Windows does not expose `ru_utime` through `getrusage`.

6 × 720p60 is ≈ 9.7 Mbps aggregate (36.6 MB sent in 30 s), in line with the proposal's
~1.6 Mbps per stream.

**Translation is the tighter limit, and it is not measured.** Each participant whose
translation is on holds one live session of `/ws/translate`, and the API allows six live
sessions server-wide (a constant, `MAX_CONCURRENT_TURNS_GLOBAL`); a seventh is refused with
`too_many_sessions`. On the turn path the sidecars bound it instead
(`LOCAL_STT_CONCURRENCY`, default 4 decodes per engine). Neither has been load-tested with
several simultaneous speakers, nor has anything been measured on the production host.

---

## 3. What must land before production

| #   | Item                                         | Depends on         | State                    |
| --- | -------------------------------------------- | ------------------ | ------------------------ |
| 1   | Connectivity run from 2 networks (Wi-Fi, 4G) | Both flags on prod | pending (owner)          |
| 2   | Mobile device checklist on Cloudflare        | Dev client build   | pending (owner)          |
| 3   | Translation load with several speakers       | Running stack      | not measured             |
| 4   | Mobile sign-in through the real auth client  | —                  | mobile is dev-build only |
| 5   | Meeting minutes on the end screen            | A minutes pipeline | deferred                 |
| —   | Network path (Decision 2 / #208)             | Owner decision     | done (2026-10-25)        |
| —   | Two-browser live check on Cloudflare         | Cloudflare app     | done (2026-10-25)        |

---

## 4. What is NOT changing

- `/ws/translate` — unchanged; a conference client opens a live session on it like any
  other client.
- Auth — the conference gateway authenticates the WebSocket upgrade the same way as
  `/ws/translate`.
- Redis — no new use; room state is in-process (`ConferenceRoomRegistry`).
- R2 — no recording (Decision 6 in the architecture document).
- Extension — still translates third-party meetings; no SFU session.

---

## 5. Open questions (not yet decided)

| #   | Question                                | Notes                                                                                                                                |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | Recording storage path                  | R2 existing bucket (public-read) vs. a private bucket. Privacy implications unresolved.                                              |
| Q2  | Room persistence                        | `ConferenceRoomRegistry` is in-process (lost on restart). Redis-backed room state needed for multi-instance or graceful restart.     |
| Q3  | Per-participant per-language TTS output | Today: one TTS voice per language. Multi-participant TTS voice identity (who is speaking) is not differentiated.                     |
| Q4  | Multi-instance scaling                  | Media scales on Cloudflare, but room state is in one API process; cross-instance rooms need shared room state (beyond thesis scope). |
