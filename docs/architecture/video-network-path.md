# Video network path: how meeting media reaches the server

> **Status: Decision input for [Issue #208](https://github.com/quanganh208/chatofy/issues/208); the
> decision is pending.** mediasoup is chosen (Decision 1 in
> [video-conferencing-architecture.md](../video-conferencing-architecture.md)), but its media
> cannot use the Cloudflare Tunnel. The conferencing code is on `main` behind
> `CONFERENCE_ENABLED`, off in production. §7's first-ranked option turned out impossible on
> the production host (§8); the two remaining candidates are written up against the current
> code in §9.

**Date:** 2026-10-06
**Constraints anchoring every choice below:** production is behind a Cloudflare Tunnel (every
port binds `127.0.0.1`), ~3.4 GiB RAM headroom on the host (see
[deployment-guide.md → Host prerequisites](../deployment-guide.md)), mediasoup already chosen
(Decision 1), non-commercial graduation thesis.

---

## 1. The core problem

mediasoup is an **ICE-lite SFU**. It does not dial out and it does not use TURN for its own
reachability: it listens on a publicly announced address and expects clients to send ICE
binding requests _to it_. The server must be reachable on open ports; TURN only ever helps the
**client** side reach that already-reachable server
([mediasoup discourse — STUN/TURN](https://mediasoup.discourse.group/t/stun-turn-servers/4108),
[HN — mediasoup maintainer](https://news.ycombinator.com/item?id=22767955)).

The production host reaches the internet only through a Cloudflare Tunnel, and the tunnel's
public-hostname feature proxies **HTTP/HTTPS/WebSocket only** — not raw TCP, not UDP (§2). So
the signaling half of conferencing (WebSocket `/ws/conference`) already works through the
tunnel unchanged. The **media** half (ICE/DTLS/RTP, normally UDP) does not, and cannot be made
to by any tunnel configuration.

The decision is therefore **not** "how do we tunnel the media" — that is impossible — but
"what carries the media instead, given the mediasoup server must become reachable on its own
ports." This reframing is the whole point: coturn alone does not answer it (§4.1).

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

This confirms the note already in
[video-conferencing-architecture.md → Decision 1](../video-conferencing-architecture.md):
"The Cloudflare Tunnel serving the web and API hostnames blocks UDP media (TCP only)."

**Consequence:** WebRTC media must travel on a path that does **not** run through the
cloudflared public hostname. Every viable option below opens a second ingress (a public port,
or a managed relay) alongside the tunnel. The tunnel keeps carrying HTTPS + the signaling
WebSocket; it never carries media.

---

## 3. The topology the options differ on

```
                          Cloudflare edge
   ┌──────────┐   HTTPS + wss   ┌─────────────────┐   loopback   ┌──────────────────┐
   │ Browser  │ ───────────────▶│ Cloudflare      │─────────────▶│ NestJS API       │
   │ (web/RN) │   signaling     │ Tunnel (HTTP)   │  127.0.0.1   │ /ws/conference   │
   │          │                 └─────────────────┘              │ + mediasoup      │
   │          │                                                  │   Worker (C++)   │
   │          │   WebRTC MEDIA (ICE/DTLS/RTP) — NOT via tunnel    │   ICE-lite,      │
   │          │ ·············· ? ······························· ▶│   needs reachable │
   └──────────┘                                                  │   ports          │
                                                                 └──────────────────┘
```

Signaling (solid line) is settled — it uses the existing tunnel + loopback path. The dotted
`?` is the media path this document chooses. Every option is a different way to fill it.

---

## 4. Options and trade-offs

### 4.1 Self-hosted coturn on the host (TCP/443 or TLS/5349)

Already scaffolded: `docker-compose.yml` runs `coturn/coturn:4.6.2` with `--use-auth-secret`,
`network_mode: host`, media port range 40000–49999 (see the `coturn` service in
[docker-compose.yml](../../docker-compose.yml)). coturn can relay over TCP (3478/tcp, alt
80/tcp) and TLS (5349/tcp, alt 443/tcp), so a client whose network blocks UDP can still reach
a TURN relay on a TCP/443-looking port.

**The trap:** TURN helps the _client_ reach the server; it does nothing for mediasoup's own
reachability. coturn's own listening port **must itself be publicly reachable** — and that port
cannot go through the cloudflared HTTP tunnel any more than raw media can. So "coturn on
TCP/443" still requires opening a real public port on the host (§4.4), which the current
loopback-only posture forbids. coturn behind the tunnel relays nothing, because nothing can
reach coturn. This is why §1 says coturn alone does not answer the question.

Two sub-variants actually work:

- **coturn on a public port, mediasoup announcing a reachable address.** Requires a public IP
  and open ports on the host (collapses into §4.4). coturn then rescues UDP-blocked clients.
- **coturn as a TURN relay in front of a mediasoup that is otherwise reachable.** Same public
  ingress requirement; coturn is additive, not a substitute for reachability.

| Dimension                 | Assessment                                                   |
| ------------------------- | ------------------------------------------------------------ |
| Reachability of mediasoup | **Not solved by coturn** — still needs a public port (§4.4)  |
| Extra containers          | 0 (already in compose)                                       |
| RAM                       | coturn idle is tens of MB; negligible vs 3.4 GiB             |
| New exposure              | A public TURN port + the mediasoup media range (§5)          |
| Cost                      | $0 software (coturn is free, GPLv3); bandwidth is the host's |
| Maturity                  | coturn is the de-facto standard TURN server, widely deployed |

**Verdict:** coturn is a _component_ of a solution, never the whole path on this host. It is
correct for LAN PoC testing (where `network_mode: host` already exposes it on the private
network) and becomes production-relevant only once §4.4's public ingress exists.

### 4.2 Cloudflare Realtime SFU (managed SFU)

Cloudflare Realtime SFU is a **managed cloud SFU** — endpoints connect their WebRTC
PeerConnections directly to Cloudflare's network; the application backend only authenticates
and orchestrates over HTTPS
([Realtime SFU](https://developers.cloudflare.com/realtime/sfu/)). It **replaces** the media
server entirely: "you don't run mediasoup or another media server — Cloudflare operates the
SFU for you."

| Dimension         | Assessment                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Reachability      | Solved — media goes to Cloudflare's edge, no host port                                                                                 |
| Fits chosen stack | **Conflicts with Decision 1** — discards mediasoup                                                                                     |
| Extra containers  | 0                                                                                                                                      |
| RAM on host       | ~0 (media leaves the host entirely)                                                                                                    |
| New exposure      | None on the host; media is on Cloudflare's platform                                                                                    |
| Cost              | $0.05/GB egress; first **1,000 GB/mo free** (shared with TURN) ([SFU pricing](https://developers.cloudflare.com/realtime/sfu/pricing)) |
| Adoption risk     | Vendor lock-in to Cloudflare's signaling/control model; rewrites the conference control plane                                          |

**Verdict:** technically the cleanest reachability story and generous free tier, but it throws
away the chosen media server and the PoC already built on it. Out of scope unless Decision 1
is reopened — which this document does not recommend.

### 4.3 Cloudflare Realtime TURN (managed TURN, standalone)

Distinct from §4.2: Cloudflare Realtime **TURN** is a standalone **managed TURN relay** that
any ICE client can use. It supports **TURN over TCP (3478, alt 80)** and **TURN over TLS
(5349, alt 443)** ([TURN service](https://developers.cloudflare.com/realtime/turn/)). It is a
drop-in replacement for self-hosted coturn — same role, no container, no host port for the
relay.

But it has the **same ICE-lite limitation as §4.1**: it rescues UDP-blocked _clients_; it does
not make the mediasoup _server_ reachable. A managed TURN relay sits on the client's side of
the connection. mediasoup still needs its own reachable ports (§4.4), because mediasoup never
relays its own media through TURN (§1).

| Dimension                 | Assessment                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reachability of mediasoup | **Not solved** — same as §4.1, client-side only                                                                                                                                 |
| Extra containers          | 0 (managed)                                                                                                                                                                     |
| RAM                       | 0                                                                                                                                                                               |
| New exposure              | None on the host for the relay itself                                                                                                                                           |
| Cost                      | Free _only when paired with Realtime SFU_; otherwise **$0.05/GB egress**, shared 1,000 GB/mo free tier ([TURN pricing](https://developers.cloudflare.com/realtime/sfu/pricing)) |
| Adoption risk             | Low — standard TURN; swappable for coturn at any time                                                                                                                           |

**Verdict:** a strictly-better coturn (no container, no relay port to open, TLS/443 built in)
_for the client-side TURN role_ — but it does not remove the need for §4.4. Useful as the
client-side relay **on top of** whichever reachability option is chosen, and its 1,000 GB free
tier comfortably covers thesis-scale traffic. Note it is not free standalone unless the
Realtime SFU is also used, so standalone it does meter at $0.05/GB after the free tier.

### 4.4 Public port(s) on the host for mediasoup media

Open a public UDP port (and a TCP fallback) directly on the host — bypassing the tunnel for
media — and set mediasoup's `announcedAddress` to a public IP or DNS name. mediasoup then
serves ICE on that reachable address exactly as its ICE-lite design intends
([mediasoup discourse](https://mediasoup.discourse.group/t/stun-turn-servers/4108)). This is
the **only option that directly makes the mediasoup server reachable**, and every other option
except §4.2 ultimately depends on it.

| Dimension         | Assessment                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reachability      | **Solved directly** — the server is on a public address                                                                                                                                                      |
| Fits chosen stack | Yes — the native mediasoup deployment model                                                                                                                                                                  |
| Extra containers  | 0                                                                                                                                                                                                            |
| RAM               | mediasoup Worker only; footprint unmeasured under a `--memory` cap (see Decision 1 note)                                                                                                                     |
| New exposure      | **Highest** — a public media port range on a personal machine previously loopback-only                                                                                                                       |
| Cost              | $0 if the host has a usable public IP; else a static-IP/port-forward cost                                                                                                                                    |
| Feasibility       | Depends on the host network: ISP must allow inbound, router port-forward, and the host must accept a non-loopback bind — a departure from the deployment-guide invariant that _every_ port binds `127.0.0.1` |

**Verdict:** the architecturally correct path for a self-hosted mediasoup, but it breaks the
deployment-guide's loopback-only security posture and depends on host-network facts
(public/static IP, NAT, ISP policy) that are **not established in the repo** and must be
verified on the actual machine. On a residential connection behind CGNAT this option may be
impossible, which is exactly the situation managed TURN/SFU exist to rescue.

### 4.5 Separate VPS for media only

Run mediasoup (or coturn) on a small cloud VPS with a real public IP, leaving the NestJS API
on the tunnelled host and connecting the two over the signaling WebSocket. The VPS gives
mediasoup the reachable address §4.4 needs, without touching the home host's network posture.

| Dimension            | Assessment                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Reachability         | Solved — VPS has a public IP and open ports                                                                                           |
| Fits chosen stack    | Yes — mediasoup runs as designed                                                                                                      |
| Extra infrastructure | A second host to provision, secure, deploy, and monitor                                                                               |
| RAM                  | Off the 3.4 GiB host entirely; VPS sizing is independent                                                                              |
| New exposure         | Media ports on the VPS; the VPS itself is new attack surface                                                                          |
| Cost                 | Recurring VPS fee — a smallest-tier instance is typically a few USD/month (**verify current price at the chosen provider**); not free |
| Adoption risk        | Operational overhead of a second deploy target for a solo thesis                                                                      |

**Verdict:** solves reachability cleanly and keeps the home host loopback-only, at the price of
standing up and paying for a second server. Reasonable if §4.4 is impossible on the host
network and a recurring cost is acceptable, but heavier than the thesis needs if a free managed
option covers it.

---

## 5. Security: new exposure per option

The current posture is strong: every production port binds `127.0.0.1`, the tunnel is the only
ingress, and the host is a personal machine running a root-equivalent self-hosted runner (see
[deployment-guide.md → Known gaps](../deployment-guide.md)). Any media path weakens this.

| Option                            | New exposure introduced                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §4.1 coturn (self-hosted, public) | A public TURN port + mediasoup media range on the host; coturn auth secret becomes a credential to protect; TURN can be abused as an open relay if auth is misconfigured — the compose already sets `--use-auth-secret` and `--denied-peer-ip` for RFC1918 ranges, which is the correct hardening |
| §4.2 Cloudflare SFU               | None on the host; media and its metadata transit Cloudflare's platform (a third party now sees the media)                                                                                                                                                                                         |
| §4.3 Cloudflare TURN              | None on the host; relayed media transits Cloudflare; auth via short-lived credentials from their API                                                                                                                                                                                              |
| §4.4 public host port             | **Largest change** — the host stops being loopback-only; a media port range is internet-reachable on a machine that also runs the privileged CD runner. Requires firewalling the new ports to media only and never widening to the DB/API ports                                                   |
| §4.5 VPS                          | New host to harden; media ports exposed there, not on the home host — isolates the blast radius from the CD runner                                                                                                                                                                                |

The recording-access and bucket-privacy concerns (R2 public-read) are tracked separately in
[video-conferencing-architecture.md → Open decisions #6](../video-conferencing-architecture.md)
and are not re-decided here.

---

## 6. Cost and free-tier quotas (non-commercial thesis)

| Option                  | Direct cost                                                  | Free allowance                     | Notes                                                                  |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------- |
| §4.1 coturn self-hosted | $0 software                                                  | n/a                                | Bandwidth is the host's own; no metered service                        |
| §4.2 Cloudflare SFU     | $0.05/GB egress                                              | **1,000 GB/mo** (shared with TURN) | [SFU pricing](https://developers.cloudflare.com/realtime/sfu/pricing)  |
| §4.3 Cloudflare TURN    | $0.05/GB egress standalone; free if paired with Realtime SFU | **1,000 GB/mo** (shared)           | [TURN pricing](https://developers.cloudflare.com/realtime/sfu/pricing) |
| §4.4 public host port   | $0 if host has a usable public IP                            | n/a                                | May need a paid static IP depending on ISP — **verify on the host**    |
| §4.5 VPS                | Recurring monthly fee                                        | none                               | Smallest tier ≈ a few USD/mo — **verify at provider**                  |

Thesis-scale traffic (a handful of 2–6-participant test meetings) sits far under 1,000 GB/mo,
so the Cloudflare managed free tier is effectively free for this use. Figures not fetchable to
an exact current number (VPS price, static-IP fee) are marked **verify**; do not treat them as
settled.

---

## 7. Recommendation (2026-10-06, superseded in part)

> Option #1 below needs an inbound port on the production host, and the host check of
> 2026-10-12 found none can be opened (§8, question 1). It stays here as the reasoning of the
> time; the open choice is between #2 and #3, in §9.

**Primary: use the mediasoup-native path only if the host can expose a public media port
(§4.4); otherwise adopt Cloudflare Realtime TURN (§4.3) as the client-side relay in front of a
mediasoup server made reachable by a small VPS (§4.5).**

Ranked:

1. **§4.4 public host port + §4.3 Cloudflare TURN for UDP-blocked clients** — _if_ the host
   network permits inbound (public/static IP, port-forward, non-loopback bind). This is the
   native mediasoup deployment, keeps Decision 1 intact, costs nothing beyond the host, and
   reuses the already-built PoC. The managed TURN layer rescues restrictive-NAT clients within
   the 1,000 GB free tier. **Gated on a host-network fact the repo does not record — verify
   first.**
2. **§4.5 VPS for mediasoup + §4.3 Cloudflare TURN** — if §4.4 is impossible (CGNAT, ISP blocks
   inbound, or breaking the loopback-only posture is unacceptable). Keeps the home host
   loopback-only, isolates media exposure from the CD runner, at a small recurring VPS cost.
3. **§4.2 Cloudflare Realtime SFU** — only if Decision 1 is reopened. Cleanest reachability and
   generous free tier, but discards mediasoup and the PoC. Not recommended given Decision 1 is
   already resolved.

**Not recommended as a standalone answer: §4.1 coturn-only** — it cannot make the ICE-lite
mediasoup server reachable and its own relay port cannot traverse the tunnel. coturn remains
the right tool for **LAN PoC testing** (its current role in `docker-compose.yml`) and is a
free substitute for §4.3 once a public ingress exists.

**Rationale anchored to the constraints:** mediasoup is chosen (rules out §4.2 by default); the
tunnel cannot carry media (rules out any tunnel-only answer); ~3.4 GiB headroom tolerates
coturn/mediasoup but argues against a second heavy local service; non-commercial thesis means
the Cloudflare 1,000 GB free tier covers realistic traffic, so the managed TURN layer is
effectively free. The single unknown that decides #1 vs #2 is **whether the production host can
expose a public media port** — establish that before writing the production implementation plan.

### Topology (recommended option #1)

```
                       Cloudflare edge
  ┌──────────┐  HTTPS + wss   ┌──────────────┐  loopback   ┌───────────────────────┐
  │ Browser  │───────────────▶│  Cloudflare  │────────────▶│ NestJS API (tunnelled) │
  │ (web/RN) │   signaling    │  Tunnel      │  127.0.0.1  │  /ws/conference        │
  │          │                └──────────────┘             │  + mediasoup Worker    │
  │          │                                             │    ICE-lite,           │
  │          │   WebRTC media (ICE/DTLS/RTP)               │    announcedAddress =  │
  │          │   direct to public media port ────────────▶│    <public IP/DNS>     │
  │          │                                             │    RTC 50000–59999     │
  │          │                                             │    + TCP fallback      │
  │          │                                             └───────────────────────┘
  │          │   if client UDP+TCP blocked:                         ▲
  │          │   relay via Cloudflare Realtime TURN ────────────────┘
  │          │   (turns:…:443, managed, 1000 GB/mo free)
  └──────────┘
```

Signaling rides the existing tunnel; media takes a separate public port straight to the
mediasoup Worker; Cloudflare Realtime TURN (TLS/443) is the fallback only for clients whose
network blocks direct media.

---

## 8. Unresolved questions

1. **Can the production host expose a public media port at all?** **Answered, no**
   (2026-10-12). The host sits on a company network; its router is not the operator's to
   configure, so no port forward or inbound port can be added and its WAN address cannot be
   read, which makes CGNAT moot. The router also refuses UPnP and NAT-PMP. Recommendation #1
   is out.
2. **mediasoup Worker RAM footprint under a `--memory` cap**, measured against the ~3.4 GiB
   headroom — flagged unmeasured in Decision 1 and still unmeasured.
3. **Exact recurring cost** of the smallest viable VPS (#2) and of a static IP from the host's
   ISP (#1) — both marked _verify_ in §6; not fetched to a current number here.
4. **Does TURNS on port 443 actually traverse the specific client networks you must support?**
   TLS/443 defeats most blocks but not deep-packet-inspection proxies; only testing on the
   target networks confirms it.

---

## 9. The two remaining candidates against the current code

Both need no inbound port on the production host. What exists today, and what either one
changes: the API process runs the mediasoup worker (`ConferenceWorkerService`), one router per
room, and the WebRTC transports (`conference-webrtc-transport.factory.ts`, announcing
`MEDIASOUP_ANNOUNCED_IP`, UDP + TCP, RTC ports 50000–59999); `/ws/conference` carries
signaling through the tunnel; `POST /conference` creates rooms; the translation relay, chat,
persistence and REST routes do not touch media. The owner chooses; nothing below is a choice.

|                | **§4.5 — mediasoup on a VPS + Cloudflare Realtime TURN**                                                                                                                                                                                                                                                                                                                                                                                                                                              | **§4.2 — Cloudflare Realtime SFU**                                                                                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gateway**    | The media half leaves the API process: the worker, routers and transports run in a small service on the VPS, and the gateway calls it over an outbound HTTPS/WSS control channel (outbound works from the company network). The VPS cannot simply run the whole API, because Postgres and the auth secret stay on the loopback-only host. Room registry, signaling events, translation relay, chat and persistence stay. TURN credentials come from Cloudflare's TURN API instead of the coturn HMAC. | mediasoup goes. The gateway creates Cloudflare sessions and pushes/pulls tracks through Cloudflare's HTTPS API, relaying SDP between clients and Cloudflare; `transport.create` / `produce` / `consume` become SDP-negotiation events. Room registry, translation relay, chat, persistence and REST stay. |
| **Clients**    | None beyond configuration: ICE candidates now name the VPS address.                                                                                                                                                                                                                                                                                                                                                                                                                                   | The mediasoup-client `Device` / transports are replaced by a plain `RTCPeerConnection` (browser API on web, `react-native-webrtc` on mobile). Translation bridge and screens stay.                                                                                                                        |
| **Deploy**     | A second host to provision, harden, deploy and monitor; its firewall opens the RTC range (or one UDP + one TCP port with a mediasoup `WebRtcServer`); the control channel needs its own credential.                                                                                                                                                                                                                                                                                                   | No worker, no media ports, no mediasoup native dependency in the API image; a Cloudflare Realtime app id and token become API secrets.                                                                                                                                                                    |
| **Cost**       | VPS monthly fee (**verify at the provider**, §6) + TURN at $0.05/GB after the shared 1,000 GB/mo free tier.                                                                                                                                                                                                                                                                                                                                                                                           | $0.05/GB egress after the shared 1,000 GB/mo free tier (§6); thesis traffic sits far below it.                                                                                                                                                                                                            |
| **Decision 1** | Kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Reopened: replaces mediasoup.                                                                                                                                                                                                                                                                             |

The connectivity run from two networks (Wi-Fi and 4G, with RTT and packet loss) is the
acceptance criterion still open on #208. It needs the chosen path and is run after the
choice.
