# Conference Client Support — Web, Mobile, Extension

**Issue:** #210 | **Depends on:** #207 (mediasoup PoC room)  
**Date:** 2026-10-05  
**Status:** Design complete; mobile PoC implementation in progress.

---

## 1. SDK compatibility

### Web (Next.js App Router)

| Item        | Value                                                        | Source                                                                |
| ----------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| SDK         | `mediasoup-client ^3.7.x`                                    | npm                                                                   |
| Auth        | Supabase session → Bearer token in WS Upgrade header         | existing `tokenFromUpgradeRequest` pattern in `conference.gateway.ts` |
| Entry point | `/conference/[roomId]` (App Router dynamic segment)          | —                                                                     |
| Tested by   | PoC page `apps/web/app/(app)/conference-poc/page.tsx` (#207) | —                                                                     |

No new web dependency. The PoC already validates the full signaling path.

### Mobile (Expo 55 / React Native 0.83.6)

| Item              | Value                                                                                        | Source                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| WebRTC SDK        | `react-native-webrtc ^118.0.0`                                                               | [react-native-webrtc releases](https://github.com/react-native-webrtc/react-native-webrtc) — v118 added New Architecture support |
| mediasoup glue    | `mediasoup-client ^3.7.x`                                                                    | [mediasoup-client docs — React Native](https://mediasoup.org/documentation/v3/mediasoup-client/installation/)                    |
| Auth              | Same Bearer token via `WebSocket` `protocols` array (existing `handleProtocols` in gateway)  | —                                                                                                                                |
| Build requirement | **Custom dev build** — not runnable on Expo Go (native module)                               | —                                                                                                                                |
| New Architecture  | `newArchEnabled: true` already set in `app.json` — compatible with react-native-webrtc ≥ 118 | `apps/mobile/app.json`                                                                                                           |

**Integration pattern:**

```typescript
import { registerGlobals } from 'react-native-webrtc';
// Must be called once before creating Device, so it injects RTCPeerConnection
// into the global scope that mediasoup-client reads.
registerGlobals();

const device = new Device();
await device.load({ routerRtpCapabilities });
```

### Extension (recommendation)

**Keep outside scope.** Three blockers:

1. MV3 background service workers have no `getUserMedia` access. Content scripts can call it, but WebRTC from a content script runs in the context of the host page (Google Meet, Zoom), risking CSP conflicts with the host's own security policy.
2. The extension's current purpose — translating third-party meetings — is a distinct use-case. Adding first-party meeting join creates a confusing dual-purpose UI.
3. The WebSocket upgrade auth pattern stamps a JWT on the HTTP upgrade request. Browser extensions cannot inject arbitrary HTTP headers on WebSocket upgrades in MV3.

Decision: extension scope stays translation-of-third-party-meeting only.

---

## 2. CSP analysis — no changes required

The existing CSP in `apps/web/next.config.ts` already covers the conference feature:

| Requirement                            | Existing directive                                                                                  | Verdict               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| `/ws/conference` WebSocket             | `connect-src 'self' ${api} ${socket}` (API origin covers same host)                                 | ✓ already covered     |
| Camera / microphone via `getUserMedia` | `media-src 'self' blob:`                                                                            | ✓ already covered     |
| TURN relay connections                 | WebRTC ICE/TURN runs at browser's network layer, **not** subject to `connect-src` per W3C CSP3 §8.5 | ✓ no directive needed |
| Peer video/audio streams in `<video>`  | `media-src 'self' blob:` (MediaStream → `URL.createObjectURL` → `blob:` URL)                        | ✓ already covered     |

**No `next.config.ts` change needed** for this issue.

---

## 3. Meeting screen designs

All three screens use components available in `@chatofy/ui/react` today. Each state is verified against the one-accent / two-surface budget rule in `docs/design-guidelines.md`.

### 3.1 Pre-join screen

Route: `/conference/[roomId]/join`

```
┌──────────────────────────────────────────────┐
│                                              │
│         ┌────────────────────────┐           │
│         │   [Camera preview]     │           │  ← Card · surface 1
│         │      640 × 360         │           │
│         └────────────────────────┘           │
│                                              │
│   Display name                               │
│   ┌────────────────────────────────────┐     │
│   │ Jane Doe                           │     │
│   └────────────────────────────────────┘     │
│                                              │
│   Microphone          Camera                 │
│   ┌─────────────────┐ ┌─────────────────┐   │
│   │ Built-in Mic  ▼ │ │ FaceTime HD   ▼ │   │
│   └─────────────────┘ └─────────────────┘   │
│                                              │
│   ┌──────────────────────────────────────┐   │
│   │              Join call               │   │  ← Button · bg-primary · accent 1
│   └──────────────────────────────────────┘   │
│                                              │
└──────────────────────────────────────────────┘
```

**Components:** `Card`, `Input`, `Select` (×2), `Button`  
**Accent count:** 1 (Join call) ✓  
**Surface count:** 1 (Card) ✓

### 3.2 In-call screen

Route: `/conference/[roomId]`

```
┌──────────────────────────────────────────────┐
│  ┌───────────────┐  ┌───────────────┐         │
│  │  [Peer A cam] │  │  [Peer B cam] │         │  ← page ground (no surface)
│  └───────────────┘  └───────────────┘         │
│        ┌──────────────────────┐               │
│        │   [Self preview]     │               │  ← page ground
│        └──────────────────────┘               │
│                                               │
│  ── Subtitles ─────────────────────────────── │
│  Peer A: "Xin chào mọi người"                 │
│  → "Hello everyone"                           │
│                                               │
│─────────────────────────────────────────────  │
│  [🎤 Mute] [📷 Cam] [🌐 Translate] [💬] [End call]  │  ← Bar · surface 1
└──────────────────────────────────────────────┘
         │ tap 💬 → Chat/subtitle sheet slides up
         ▼
┌──────────────────────────────────────────────┐
│  Subtitles & Chat                 [×]        │  ← Sheet · surface 2
│  ─────────────────────────────────────────── │
│  [Peer A] 12:01  "Hello everyone"            │
│  [Peer B] 12:02  "Good to see you"           │
└──────────────────────────────────────────────┘
```

**Components:** `RTCView` (react-native-webrtc / `<video>` on web), `Button` (×5 ghost/outline), control `Bar` (custom, or `Card` flush to bottom), `Sheet`  
**Accent count:** 0 — End call uses `bg-destructive` (not `bg-primary`), all other controls are ghost ✓  
**Surface count:** 1 baseline (control bar) + 1 optional (Sheet when open) = max 2 ✓

### 3.3 End screen

Route: `/conference/[roomId]/ended`

```
┌──────────────────────────────────────────────┐
│                                              │
│              Call ended                      │
│                                              │
│   ┌──────────────────────────────────────┐   │
│   │  Duration:      12 min 45 sec        │   │  ← Card · surface 1
│   │  Participants:  Jane · Bob · Alice   │   │
│   │  Room:          team-standup-1       │   │
│   └──────────────────────────────────────┘   │
│                                              │
│   ┌──────────────────────────────────────┐   │
│   │         Copy meeting minutes         │   │  ← Button · bg-primary · accent 1
│   └──────────────────────────────────────┘   │
│                                              │
│   ┌──────────────────────────────────────┐   │
│   │           Back to home               │   │  ← Button · ghost
│   └──────────────────────────────────────┘   │
│                                              │
└──────────────────────────────────────────────┘
```

**Components:** `Card`, `Button` (×2)  
**Accent count:** 1 (Copy minutes) ✓  
**Surface count:** 1 (Card) ✓

---

## 4. Mobile PoC — Android setup steps

### Prerequisites

1. Physical Android device with USB debugging enabled  
   (Settings → Developer options → USB debugging)
2. USB cable + `adb devices` confirms device visible
3. Stack running: `docker compose up -d coturn && pnpm --filter api dev`

### Install native deps

```bash
cd apps/mobile
pnpm add react-native-webrtc mediasoup-client
```

### Rebuild native project

```bash
pnpm --filter mobile run prebuild -- --platform android --clean
```

`app.json` now includes `"react-native-webrtc"` as a plugin and the required
permissions (`CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `INTERNET`,
`ACCESS_NETWORK_STATE`).

### Set the API address

The dev server runs on the host machine. The device needs the host's LAN IP,
not `localhost`.

```bash
# In apps/mobile/.env.local (create if absent)
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.XXX:3001
```

Replace `192.168.1.XXX` with `ipconfig` / `ifconfig` output.

### Build and run

```bash
pnpm --filter mobile run android
# or equivalently
cd apps/mobile && npx expo run:android
```

The first build takes ~5 minutes. Subsequent runs are fast (only JS changes).

### Test

1. Navigate to the Conference PoC tab in the mobile app.
2. Enter room name `poc`, tap **Join call**.
3. Open `http://localhost:3000/conference-poc` on the desktop browser in the same room.
4. Both participants should see each other's video and hear audio.

---

## 5. Acceptance criteria checklist

- [ ] Mobile joins from a real Android device following the steps in §4
- [ ] Pre-join, in-call, end screens each pass accent/surface budget (§3)
- [ ] All screens use components from `@chatofy/ui/react` only (no new installs)
- [ ] Mobile screens verified on Expo dev build — not tested against Expo Go

---

**Document version:** 1.0 · **Last updated:** 2026-10-05
