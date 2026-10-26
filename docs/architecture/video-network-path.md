# Video network path: how meeting media reaches the server

> **Status: Decided for [Issue #208](https://github.com/quanganh208/chatofy/issues/208):
> Cloudflare Realtime SFU (§4.2), owner decision 2026-10-25.** It replaced mediasoup, the
> in-process SFU chosen in #207 (Decisions 1 and 7 in
> [video-conferencing-architecture.md](../video-conferencing-architecture.md)). The other
> options are kept below as the reasons they lost. The conferencing code is on `main`
> and always loaded; what is measured so far, and the two-network run still owed,
> is in [§4.2 → Measured](#measured).

**Date:** 2026-10-06, decided 2026-10-25
**Constraints anchoring every choice below:** production is behind a Cloudflare Tunnel (every
port binds `127.0.0.1`), the host sits on a company network that cannot accept an inbound
connection (§8), ~3.4 GiB RAM headroom on the host (see
[deployment-guide.md → Host prerequisites](../deployment-guide.md)), non-commercial
graduation thesis.

---

## 1. The core problem

The production host reaches the internet only through a Cloudflare Tunnel, and the tunnel's
public-hostname feature proxies **HTTP/HTTPS/WebSocket only** — not raw TCP, not UDP (§2). So
the signaling half of conferencing (WebSocket `/ws/conference`) works through the tunnel
unchanged. The **media** half (ICE/DTLS/RTP, normally UDP) does not, and cannot be made to by
any tunnel configuration.

A self-hosted SFU cannot fill that gap here. mediasoup, the server replaced on 2026-10-25, is
**ICE-lite**: it does not dial out and does not use TURN for its own reachability; it listens
on a public address and expects clients to send ICE binding requests _to it_. TURN only ever
helps the **client** side reach an already-reachable server
([mediasoup discourse — STUN/TURN](https://mediasoup.discourse.group/t/stun-turn-servers/4108)).
The host cannot be made reachable (§8), so the question became "what carries the media
instead", and the answer is a server that is already reachable: Cloudflare's SFU, which every
client dials outbound.

---

## 2. What the Cloudflare Tunnel can and cannot carry

| Traffic               | Through the public-hostname tunnel?   | Source                                                                                             |
| --------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| HTTP / HTTPS          | Yes                                   | [Connect networks](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) |
| WebSocket (`wss://`)  | Yes — already used by `/ws/translate` | [deployment-guide.md → Known gaps](../deployment-guide.md) (WS keepalive)                          |
| Raw TCP (non-HTTP)    | No (public ingress)                   | below                                                                                              |
| UDP (public ingress)  | **No**                                | [cloudflared#964](https://github.com/cloudflare/cloudflared/issues/964)                            |
| UDP (private network) | Only with WARP client on every peer   | [cloudflared#964](https://github.com/cloudflare/cloudflared/issues/964)                            |

**UDP has no public path.** Public UDP ingress has been requested since 2022
([cloudflared#964](https://github.com/cloudflare/cloudflared/issues/964), closed without a
public-ingress feature). Cloudflare supports UDP only inside a Zero Trust private network where
every connecting client runs the WARP client logged into the organisation — unusable for a
public meeting product where participants are anonymous browsers.

**Consequence:** WebRTC media must travel on a path that does **not** run through the
cloudflared public hostname. The tunnel keeps carrying HTTPS and the signaling WebSocket; it
never carries media.

---

## 3. The topology as built

```
                          Cloudflare edge
   ┌──────────┐   HTTPS + wss   ┌─────────────────┐   loopback   ┌──────────────────┐
   │ Browser  │ ───────────────▶│ Cloudflare      │─────────────▶│ NestJS API       │
   │ (web/RN) │   signaling     │ Tunnel (HTTP)   │  127.0.0.1   │ /ws/conference   │
   │          │                 └─────────────────┘              └────────┬─────────┘
   │          │                                                           │ outbound HTTPS
   │          │   WebRTC media (ICE/DTLS/RTP), outbound   ┌───────────────▼─────────┐
   │          │ ─────────────────────────────────────────▶│ Cloudflare Realtime SFU │
   └──────────┘   (TURN over TLS/443 when UDP is blocked)  │ rtc.live.cloudflare.com │
                                                           └─────────────────────────┘
```

Every arrow starts at a client or at the host, so nothing needs an inbound port on the host.
The API holds the SFU app secret, creates each participant's sessions and relays SDP between
the client and Cloudflare. Where that lives in code is in §9.

---

## 4. Options and trade-offs

### 4.1 Self-hosted coturn on the host — not used

coturn relays for clients whose network blocks UDP, over TCP (3478, alt 80) or TLS (5349, alt
443). It never made the SFU reachable, and its own listening port **must itself be publicly
reachable**, which the tunnel cannot provide any more than it can carry media. It was a LAN
test relay in the development compose file while mediasoup was the server, and was removed
with mediasoup. Its client-side role is filled by Cloudflare TURN (§4.3).

### 4.2 Cloudflare Realtime SFU (managed SFU) — chosen

Cloudflare Realtime SFU is a **managed cloud SFU**: endpoints connect their WebRTC
PeerConnections directly to Cloudflare's network, and the application backend authenticates
and orchestrates over HTTPS ([Realtime SFU](https://developers.cloudflare.com/realtime/sfu/)).
"Your application does not deploy SFU servers or select an SFU region"
([architecture](https://developers.cloudflare.com/realtime/sfu/concepts/architecture/)).

| Dimension         | Assessment                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Reachability      | Solved — media goes to Cloudflare's anycast edge, no host port                                                                               |
| Extra containers  | 0                                                                                                                                            |
| RAM on host       | ~0 (media never touches the host)                                                                                                            |
| New exposure      | None on the host; media is on Cloudflare's platform                                                                                          |
| Cost              | $0.05/GB egress; first **1,000 GB/mo free** (shared with TURN) ([pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)) |
| Adoption risk     | Moderate lock-in: clients are plain WebRTC, the Cloudflare-specific part is a small REST layer in the API                                    |
| What it cost here | The mediasoup module and `mediasoup-client` were replaced; rooms, translation relay, chat and persistence stayed                             |

**Verdict: chosen** (owner decision, 2026-10-25). The SFU has no room or presence model of its
own ("The SFU does not supply a room-presence protocol",
[architecture](https://developers.cloudflare.com/realtime/sfu/concepts/architecture/)), which
fits: the API keeps owning rooms and membership. Cloudflare's Sessions/Tracks API was taken
over RealtimeKit, which would replace those rooms and the UI with its own model.

#### Measured

From the production host's network, 2026-10-25. The spike and the live check both ran two
headless Chromium pages on that one network against the real Cloudflare app; the spike's
record is `plans/261025-1812-cloudflare-realtime-sfu/spike/results.md`.

| What                                        | Result                                                                                                                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spike: pull a track right after its publish | Works; first frame after 1,720 ms                                                                                                                                                                                 |
| Spike: RTT to the SFU                       | p50 24 ms, max 24 ms (17 samples, `getStats()` succeeded candidate pair)                                                                                                                                          |
| Spike: video track muted for 45 s           | Survives; muting is `track.enabled = false`, which keeps packets flowing past the 30 s no-media rule ([limits](https://developers.cloudflare.com/realtime/sfu/platform/limits/))                                  |
| Spike: two mutations at once on one session | The second gets 406 `invalid_session_description`, so the API queues every call per session ([negotiation](https://developers.cloudflare.com/realtime/sfu/concepts/negotiation/#serialize-mutations-per-session)) |
| Spike: TURN relay                           | Not tested; no TURN key existed yet                                                                                                                                                                               |
| Live check: real web UI, local API          | 11 of 11 checks: both pages play 2 videos, chat crosses, leaving drops the tile, no overflow at 768 and 375 wide; RTT 24 ms; no SDP or token in the API log                                                       |
| TCP connect from the host                   | `rtc.live.cloudflare.com` ~21 ms (Cloudflare colo HKG), against ~68 ms to an OCI Singapore VPS                                                                                                                    |

The latency comparison is what retired the VPS option on its merits as well as its cost: a
relay VPS (§4.5) routes A → VPS → host → VPS → B, four legs, estimated at 130–140 ms one way,
where the managed SFU is two legs, A → Cloudflare → B.

Network pairs. The first two rows have both ends on one network; the rows still owed are a
call between two networks on the production site, the open acceptance check on #208. The
owner reads RTT and packet loss from `chrome://webrtc-internals`.

| Side A                     | Side B                    | Connected       | RTT             | Packet loss     | Date       |
| -------------------------- | ------------------------- | --------------- | --------------- | --------------- | ---------- |
| Prod host network (spike)  | Prod host network (spike) | yes             | 24 ms           | not recorded    | 2026-10-25 |
| Prod host network (live)   | Prod host network (live)  | yes             | 24 ms           | not recorded    | 2026-10-25 |
| Laptop on company Wi-Fi    | Phone browser on 4G       | pending (owner) | pending (owner) | pending (owner) | —          |
| Home or university network | Phone browser on 4G       | pending (owner) | pending (owner) | pending (owner) | —          |

### 4.3 Cloudflare Realtime TURN — used, optional, beside the SFU

A **managed TURN relay** with TURN over TCP (3478, alt 80) and TLS (5349, alt 443)
([TURN service](https://developers.cloudflare.com/realtime/turn/)). It rescues clients whose
network blocks UDP; it does not make any server reachable. Next to the SFU it is "available
free of charge when used together with the Realtime SFU" (same page). The API hands each join
short-lived TURN credentials when a TURN key is configured, and STUN only otherwise. Relay
addresses are IPv4 only
([TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/)). Whether TLS/443 gets
through a given school or company proxy is only known by testing on it (§8).

### 4.4 Public port(s) on the host — not used

Opening a public UDP port (and a TCP fallback) on the host, with the SFU announcing a public
address, was the self-hosted path and the 2026-10-06 first choice. It is impossible: the host
cannot accept an inbound connection (§8, question 1). It would also have ended the
deployment-guide invariant that every port binds `127.0.0.1`, on a machine that runs the
root-equivalent CD runner.

### 4.5 Separate VPS for media only — not used

Running the SFU on a small cloud VPS with a public IP, next to the tunnelled API, solves
reachability at the price of a second host to provision, harden, deploy, monitor and pay for,
and a control channel between the two. It also doubles the path (four legs against two, see
[Measured](#measured)), and a Singapore region was ~68 ms from the host against Cloudflare's
~21 ms.

---

## 5. Security: exposure per option

The posture is strong: every production port binds `127.0.0.1`, the tunnel is the only
ingress, and the host is a personal machine running a root-equivalent self-hosted runner (see
[deployment-guide.md → Known gaps](../deployment-guide.md)).

| Option                        | New exposure introduced                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| §4.2 Cloudflare SFU (chosen)  | None on the host. Media and its metadata transit Cloudflare. The app secret and TURN token are API secrets, never logged |
| §4.3 Cloudflare TURN (chosen) | None on the host; relayed media transits Cloudflare; clients get short-lived credentials only                            |
| §4.1 coturn on a public port  | A public TURN port on the host, and an auth secret to protect                                                            |
| §4.4 public host port         | **Largest** — the host stops being loopback-only on a machine that runs the privileged CD runner                         |
| §4.5 VPS                      | A new host to harden, with media ports open there                                                                        |

The recording-access and bucket-privacy concerns (R2 public-read) are tracked separately in
[video-conferencing-architecture.md → Open decisions #6](../video-conferencing-architecture.md)
and are not re-decided here.

---

## 6. Cost and free-tier quotas (non-commercial thesis)

| Option               | Direct cost                                      | Free allowance                     | Source                                                                      |
| -------------------- | ------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------- |
| §4.2 Cloudflare SFU  | $0.05/GB egress; traffic into Cloudflare is free | **1,000 GB/mo** (shared with TURN) | [pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/) |
| §4.3 Cloudflare TURN | Free with the SFU; $0.05/GB standalone           | **1,000 GB/mo** (shared)           | [TURN service](https://developers.cloudflare.com/realtime/turn/)            |
| §4.5 VPS             | Recurring monthly fee                            | none                               | not fetched to a current price                                              |

The docs say nothing about what happens past 1,000 GB beyond billing at $0.05/GB, or whether
an account needs a card ([pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)).
Thesis-scale traffic (a handful of 2–6-participant test meetings) sits far below the allowance.

---

## 7. Recommendation history

On 2026-10-06 this document ranked a public port on the host first (§4.4), a VPS second
(§4.5) and the managed SFU last, because mediasoup was already chosen. The host check of
2026-10-12 removed the first; on 2026-10-25 the owner chose the managed SFU over the VPS for
the reasons in §4.2 and §4.5.

---

## 8. Unresolved questions

1. **Can the production host expose a public media port at all?** **Answered, no**
   (2026-10-12). The host sits on a company network; its router is not the operator's to
   configure, so no port forward or inbound port can be added and its WAN address cannot be
   read, which makes CGNAT moot. The router also refuses UPnP and NAT-PMP.
2. **Does the call connect across two real networks, and at what RTT and loss?** Open: the
   pending rows in [Measured](#measured).
3. **Does TURNS on port 443 traverse the client networks that must work?** TLS/443 defeats
   most blocks but not deep-packet-inspection proxies; only testing on the target networks
   confirms it. The TURN path has not run against Cloudflare yet.
4. **Session expiry and caps.** How long an unconnected SFU session lives, and whether an app
   has a session cap, are not documented
   ([limits](https://developers.cloudflare.com/realtime/sfu/platform/limits/)).

---

## 9. Where the chosen path lives

- API, `apps/api/src/modules/conference/`: `cloudflare-realtime.client.ts` (the HTTPS client
  for sessions, tracks and TURN credentials), `conference-sfu-signaling.service.ts` (publish,
  subscribe, renegotiate and cleanup per participant), `sfu-session-queue.ts` (one queue per
  SFU session), `conference-sfu-pull.ts` and `conference-sfu-ice-servers.ts`.
- Events: `packages/types/src/events/conference-signaling-events.ts`.
- Clients: `apps/web/src/conference/` (browser `RTCPeerConnection`) and
  `apps/mobile/src/conference/` (`react-native-webrtc`).
- Configuration: `apps/api/src/config/env.schema.ts`; the deploy steps are in
  [deployment-guide.md → Video conferencing](../deployment-guide.md#video-conferencing).
