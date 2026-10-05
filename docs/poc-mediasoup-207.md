# mediasoup PoC — Issue #207

Branch: `feat/207-mediasoup-poc`

## What this proves

Two browsers join the same room and exchange audio + video through the mediasoup
SFU running inside the NestJS API process. The NestJS JWT guards the WebSocket
upgrade — no separate auth layer. The PoC does NOT yet wire audio into the
translation pipeline; that is Issue #208.

## Stack changes

| File                                         | Change                                           |
| -------------------------------------------- | ------------------------------------------------ |
| `apps/api/src/modules/conference/`           | New NestJS module: Worker, RoomRegistry, Gateway |
| `apps/web/app/(app)/conference-poc/page.tsx` | Minimal test page — two video boxes + log        |
| `docker-compose.yml`                         | Added `coturn` service for TURN relay            |
| `apps/api/package.json`                      | Added `mediasoup@3.28.0`                         |
| `apps/web/package.json`                      | Added `mediasoup-client@3.7.18`                  |

## Running the PoC

### 1. Start the dev stack

```bash
# Start postgres, redis, sidecars, AND coturn
docker compose up -d postgres redis coturn

# Start the API (mediasoup Worker spawns inside the process)
pnpm --filter api dev

# Start the web app
pnpm --filter web dev
```

### 2. Configure env (api/.env)

```env
# Announce the IP browsers will connect to.
# For local LAN testing use your machine's LAN IP (e.g. 192.168.1.x).
# For production use your public IP.
MEDIASOUP_ANNOUNCED_IP=127.0.0.1

# TURN credentials — must match COTURN_SECRET in docker-compose.yml.
# Leave blank for localhost testing (coturn not required on loopback).
TURN_URL=turn:127.0.0.1:3478
TURN_USERNAME=chatofy
TURN_CREDENTIAL=dev-secret
```

### 3. Open two browsers

Navigate both to:

```
http://localhost:3000/conference-poc
```

- Enter the **same Room ID** (default: `poc-room`) in both
- Enter different **display names**
- Click **Join** in the first browser, then in the second

Expected result: both browsers show a green log trail, local video fills the
left box, remote video fills the right box within ~2 seconds of the second peer
joining.

### 4. Verify with coturn (behind NAT)

If testing from two machines on different networks, coturn must be reachable.
Set `MEDIASOUP_ANNOUNCED_IP` to your public IP and open UDP 40000–49999 and
TCP/UDP 3478 on your router.

## Architecture of the signaling

```
Browser A                    NestJS /ws/conference              Browser B
  │                                  │                              │
  ├─ conference.join ───────────────►│                              │
  │◄─ { rtpCapabilities, peers } ────┤                              │
  │                                  │                              │
  ├─ conference.transport.create ───►│                              │
  │◄─ { id, iceParams, dtlsParams,   │                              │
  │     iceCandidates, iceServers }──┤                              │
  │                                  │◄─── conference.join ─────────┤
  ├─ conference.transport.connect ──►│──── conference.peer.joined ─►│
  ├─ conference.produce ────────────►│                              │
  │◄─ { id: producerId } ────────────┤──── conference.new.producer ►│
  │                                  │◄─── conference.transport.*   │
  │                                  │◄─── conference.consume ──────┤
  │                                  │──── { id, rtpParameters } ──►│
  │                                  │◄─── conference.consumer.resume
  │   RTP/RTCP media (direct UDP or via coturn TURN)                │
  │◄═══════════════════════════════════════════════════════════════►│
```

## Known limitations (PoC scope)

- No server-side audio intercept for translation (Issue #208)
- No recording
- No mobile (Expo dev client required — tracked separately)
- Single Worker (production would use one Worker per CPU core)
- Room IDs are not access-controlled (any authenticated user can join any room)
