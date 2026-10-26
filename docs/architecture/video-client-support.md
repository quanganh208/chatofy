# Video Client Support and Meeting Screen Design

> **Status: Research for Issue #210, since built in part.** It was written for mediasoup,
> the SFU chosen in #207 and replaced by Cloudflare Realtime SFU on 2026-10-25 (Open
> Decision 1 in [video-conferencing-architecture.md](../video-conferencing-architecture.md)).
> §1.1, §1.2 and §2.1 now describe the plain-WebRTC clients; the rest still holds, and it
> designs the meeting screens. The lobby and call screens are on `main`
> (`apps/web/app/(app)/conference/`, web; `apps/mobile/app/(app)/conference/`, mobile,
> signed-in), and §4 records them as built. The end screen (§4.4) is
> designed, not built.

**Date:** 2026-10-06, revised 2026-10-26
**Media server:** Cloudflare Realtime SFU (managed; the API drives it over HTTPS)
**Client SDK:** none on web (browser `RTCPeerConnection`); `react-native-webrtc` on mobile

SDK/version claims cite the npm registry (queried 2026-10-06) or the library docs. "PoC"
means observed on the #207 PoC page, since removed.

---

## 1. Web client (Next.js 16)

### 1.1 SDK: none

The web call is plain WebRTC: one `RTCPeerConnection` to publish and one to receive, both
`bundlePolicy: 'max-bundle'` with the ICE servers from the join reply
(`apps/web/src/conference/conference-sfu-media.ts`). No SFU client library is installed;
Cloudflare's SFU speaks standard WebRTC, and the Cloudflare-specific part is the API's REST
calls ([Realtime SFU](https://developers.cloudflare.com/realtime/sfu/)). The pinned
`mediasoup-client` 3.7.18, and the version gap this section used to track, went with
mediasoup.

### 1.2 Browser compatibility

The browser's own WebRTC stack does the work, so support is that of `RTCPeerConnection`
with unified-plan transceivers in current Chrome, Firefox and Safari. Cloudflare lists the
codecs it forwards as H.264, H.265, VP8, VP9 and AV1 for video and Opus and G.711 for audio
([limits](https://developers.cloudflare.com/realtime/sfu/platform/limits/)). Only headless
Chromium has been run against it (the live check, 2026-10-25).

**Known limitation not covered by this research:** Safari's WebRTC has historically had
the most codec/behaviour quirks (VP8 vs H264, unified-plan edge cases). The PoC was
tested on two tabs of one browser (#207 evidence); cross-browser interop (Chrome↔Safari,
Chrome↔Firefox) is unverified. Flag as a production test-matrix item.

### 1.3 How joining fits the App Router auth session

Joining reuses the existing translate-socket auth path with no new mechanism:

1. `getSession()` from `next-auth/react` returns the session;
   `session.accessToken` is the 15-minute bearer (`auth.ts` exposes it in the `session`
   callback — readable from client JS by design, same as `/ws/translate`).
2. The token rides the WebSocket subprotocol header, not a query string:
   `new WebSocket(url, [WS_SUBPROTOCOL, token])`
   (`apps/web/src/conference/conference-connection.ts`). This is the same
   `Sec-WebSocket-Protocol` handshake the API refuses-at-upgrade path already enforces.
3. No access token → the socket is not opened and the browser goes to `/login` with a
   callback back to the room (`apps/web/src/hooks/use-conference.ts`).

**Finding — no new auth work for web.** Conference signaling reuses the translate
socket's auth exactly. The session's `error` flag (`isLiveSession`) and the
30-day-sliding cookie behaviour (`auth.ts`) apply unchanged. The one caveat is token
lifetime: a meeting longer than 15 minutes outlives one access token. The socket is
authenticated only at upgrade, so an established conference socket is unaffected
mid-call; but any new signaling request that re-reads the token (a reconnect) needs the
renewed token. `getSession()` returns the renewed value because `/api/auth/session`
re-mints server-side, so the client calls `getSession()` again on every connection
attempt rather than caching the first token (`currentAccessToken` in `use-conference.ts`).

### 1.4 CSP additions needed

`apps/web/next.config.ts` sets a strict CSP. Checked against WebRTC's needs:

| Directive                       | Current value            | Meeting need                                                                             |
| ------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `connect-src 'self' <api> <ws>` | API over http(s) + ws(s) | Signaling socket `/ws/conference` — **already covered** (same origin as `/ws/translate`) |
| `media-src 'self' blob:`        | present                  | Remote `MediaStream` → `<video srcObject>` — **already covered**                         |
| `img-src ... blob:`             | present                  | Video frame snapshots if ever used — covered                                             |
| `worker-src 'self' blob:`       | present                  | The WebRTC call uses no extra worker origin — covered                                    |

**Finding — no CSP change is needed for same-origin signaling + SFU-relayed media.**
This is the critical and often-misunderstood point:

**WebRTC ICE/STUN/TURN traffic is NOT governed by CSP.** CSP's `connect-src` controls
`fetch`/`XHR`/`WebSocket`/`EventSource` — it does **not** apply to the UDP/TCP media
transport that `RTCPeerConnection` opens to STUN/TURN servers or peers. There is no CSP
directive for ICE candidates. So adding TURN origins to `connect-src` is neither
required nor effective; the browser's WebRTC stack dials TURN directly, outside the
fetch/socket model CSP sees. (This is a well-known WebRTC/CSP interaction; the W3C
WebRTC spec routes media through the ICE agent, not the fetch stack CSP intercepts.)

**The deployment constraint is not a CSP fact either.** The Cloudflare Tunnel fronting the
web/API hostnames carries no UDP, so media goes straight to Cloudflare's SFU, with Cloudflare
TURN for networks that block UDP
([video-network-path.md](./video-network-path.md)). Those addresses reach the client as ICE
servers in the join reply, and the browser contacts them outside CSP.

**Only change if signaling moves off-origin.** If a future deployment puts the
conference socket on a different host than the API, that host's `ws(s)://` origin must be
added to `connect-src`. Today the socket is same-origin as the API, and the browser never
calls Cloudflare's REST API itself (the API does), so nothing changes.

---

## 2. Mobile client (Expo 55 / React Native 0.83)

### 2.1 What runs the call on React Native?

**`react-native-webrtc`, with no SFU client library on top.** React Native has no browser
WebRTC, so `react-native-webrtc` (pinned `124.0.8`) supplies `RTCPeerConnection` and
`getUserMedia` natively, and the call uses it the same way the web does: one connection to
publish and one to receive (`apps/mobile/src/conference/conference-signaling.ts`). The
signaling flow is the web's, re-implemented, not shared (the two clients are separate code).
Cloudflare's SFU needs nothing beyond standard WebRTC from it.

Sources: `https://registry.npmjs.org/react-native-webrtc` (latest `124.0.8`, 2026-07-21,
peer `react-native >= 0.60.0`); [Realtime SFU](https://developers.cloudflare.com/realtime/sfu/).

### 2.2 Does it need a dev client (custom native build)?

**Yes.** `react-native-webrtc` contains native code (Android/iOS), so it is **not
available in Expo Go**. The mobile app must build a **custom dev client**
(`expo-dev-client` + `expo prebuild` / EAS Build). This was the single biggest mobile
adoption cost, and it has been paid: `apps/mobile` now carries `expo-dev-client`
(`~55.0.40`), `react-native-webrtc` and `react-native-audio-api` as native modules, so
every developer and every device test runs a dev client instead of Expo Go. The build
steps are in [conference-demo-runbook.md §4](../conference-demo-runbook.md#4-mobile-android-dev-build-only).

Source: react-native-webrtc README ("not available in the Expo Go app by default… use
expo-dev-client").

### 2.3 Config plugin, permissions

The app uses the out-of-tree Expo config plugin **`@config-plugins/react-native-webrtc`**,
pinned to **`14.0.0`**: the latest, `15.0.2`, requires Expo ≥ 56. It wires the native
module into the prebuild and declares permissions, so `app.json` holds no hand-written
permission entries.

**iOS (`Info.plist`, added by the plugin):**

| Key                            | Purpose           | Plugin default (overridable)                      |
| ------------------------------ | ----------------- | ------------------------------------------------- |
| `NSCameraUsageDescription`     | camera access     | "Allow $(PRODUCT_NAME) to access your camera"     |
| `NSMicrophoneUsageDescription` | microphone access | "Allow $(PRODUCT_NAME) to access your microphone" |

Plugin props: `cameraPermission`, `microphonePermission` (both strings) to localise the
prompt copy.

**Background audio (iOS):** the config plugin does **not** add the `audio` background
mode, so the app adds `UIBackgroundModes: ["audio"]` itself (`ios.infoPlist` in
`app.json`). It is config only and unverified: no iOS build has run yet.

**Android:** read from the `14.0.0` plugin source, the plugin adds `CAMERA`,
`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `INTERNET`, `ACCESS_NETWORK_STATE`, `WAKE_LOCK`,
`BLUETOOTH` and `SYSTEM_ALERT_WINDOW`. It adds **no foreground-service permission**. The
prebuilt manifest does carry `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK`
(from `react-native-audio-api`), which cover playback only: with no
`FOREGROUND_SERVICE_MICROPHONE` or `FOREGROUND_SERVICE_CAMERA`, Android 14+ cuts the
microphone and camera once the app leaves the foreground.

**A meeting in the background (decided 2026-10-26): audio stays, the camera goes off.**
The local Expo module `apps/mobile/modules/meeting-foreground-service` runs a foreground
service of type `microphone` while the call is live (in a call or reconnecting), with an
ongoing "In a meeting" notification; its manifest adds `FOREGROUND_SERVICE_MICROPHONE` and
`POST_NOTIFICATIONS`, and the lobby asks for the notification permission at join. The call
hook turns the camera off on `AppState` `background` exactly as the camera button does, so
the others see it off rather than a frozen frame, and turns it back on at `active` only if
the app turned it off. Measured on the Galaxy A13: before, both recordings (WebRTC and the
translation recorder) went `silenced:true` in `dumpsys audio`; after, they stay
`silenced:false`, the desktop peer's received audio energy keeps rising through 35 s in the
background, its decoded video frames stop, and they resume on return.

**The shipped config** (`apps/mobile/app.json`, `plugins[]`):

```jsonc
[
  "@config-plugins/react-native-webrtc",
  {
    "cameraPermission": "Chatofy uses the camera in video meetings.",
    "microphonePermission": "Chatofy uses the microphone in video meetings.",
  },
]
```

`react-native-audio-api` (the translation recorder) adds its own iOS microphone prompt
through its plugin entry.

### 2.4 Mobile adoption risk summary

| Factor              | Assessment                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK works?          | Yes — plain `react-native-webrtc` `124.0.8`; two-way audio and video on a physical Android 14 phone through Cloudflare's SFU (2026-10-26; mediasoup before, 2026-10-12) |
| Expo Go?            | **No** — custom dev client / prebuild required                                                                                                                          |
| Native build cost   | Paid: the app is on a dev-client workflow                                                                                                                               |
| New-arch (Fabric)   | `newArchEnabled: true` with `124.0.8`; confirmed on device (React Native 0.80+ needs ≥ `124.0.6`)                                                                       |
| Permissions         | Camera/mic via config plugin; background audio via a microphone foreground service (Android) and `UIBackgroundModes` (iOS, unverified)                                  |
| Code reuse from web | Design reused, code not: mobile re-implements the signaling flow (§2.1)                                                                                                 |

---

## 3. Chrome extension — meetings in or out of scope?

**Recommendation: keep meetings OUT of the extension.** The extension's job is to
translate _third-party_ meetings (Zoom/Meet/Teams) by capturing tab audio and drawing an
overlay — it is a guest on someone else's call. Hosting Chatofy's own meeting inside an
MV3 popup/content-script would fight the platform (service-worker lifecycle kills
long-lived connections, `tabCapture`/`getUserMedia` constraints, the closed-shadow-root
overlay that deliberately carries no shadcn components), duplicate the web app's
conference UI, and offer no capability the web app at a URL does not already give the
same user. One sentence: the extension translates meetings it does not own, so Chatofy
hosting its own meeting belongs in the web/mobile apps, not the extension.

---

## 4. Meeting screens design

Four screens, each measured against the two gated budgets from
[design-guidelines.md](../design-guidelines.md): **≤1 accent (`bg-primary`) per
screen-state** and **≤2 elevated surfaces per screen-state**. The accent is ink
(`#1C1917` light / `#F5F5F4` dark); it marks the one action a screen exists to offer.
Everything else is ghost/outline/readout. Video tiles are **not** surfaces in the card
sense — they are media regions on the page ground, like `/translate` is the whole screen
rather than a card.

These are the same `(app)` chrome as the rest of web (sidebar + session menu), so the
conference content area is what the budgets below count; the sidebar's own destinations
are not re-counted per screen (same rule that lets `/history` spend 0 accent).

### 4.1 Pre-join (lobby)

Built as `apps/web/app/(app)/conference/page.tsx`. A single centred column on the page
ground; the lobby both creates a room and joins one somebody shared.

```
┌─────────────────────────────────────────┐
│  Video conference                         │  ← heading
│                                           │
│   ┌───────────────────────────────┐      │
│   │        [ camera preview ]      │      │  ← media region, not a card
│   └───────────────────────────────┘      │
│                                           │
│   Your name [                    ]        │  ← Input (field)
│   Language  [ Tiếng Việt | English ]      │  ← SegmentedControl
│                                           │
│   [         Create a room          ]      │  ← the ONE accent
│                                           │
│   Room id   [              ] [ Join ]     │  ← Input + outline Button
└─────────────────────────────────────────┘
```

- **Accent (1):** **Create a room** (`variant="default"`). Join is outline: it is the
  second way in, and it needs an id first.
- **Elevated surfaces (0):** the preview is a media region on the page ground; the
  inputs are fields.
- **No device pickers.** The call uses the browser's default camera and microphone; there
  is no Select for either. The preview is camera-only (`audio: false`).
- **Budget: 1 accent, 0 elevated surfaces. PASS.** Gated by three rows of
  `apps/web/src/design/accent-budget-app.spec.tsx` (plain, opened from a shared link,
  refusing to create without a name).

### 4.2 In-call

Built as `apps/web/app/(app)/conference/[roomId]/page.tsx` with its `components/`.

```
┌──────────────────────────────────────────┬──────────────┐
│ <room id>                            [👥] │              │  ← header row, roster toggle (ghost)
├──────────────────────────────────────────┤  Participants │
│  ┌──────────────┐  ┌──────────────┐       │  Alice  🎤 📷 │  ← roster: a list
│  │  [video]     │  │  [video]     │       │  Bob    🎤 📷 │
│  │  Alice       │  │  Bob         │       ├──────────────┤
│  └──────────────┘  └──────────────┘       │  Chat         │  ← chat: a region in the
│        Bob: "Let's start with the budget." │  Bob: ...     │     same side column (§4.3)
│                                            │  [ msg ][Send]│
├────────────────────────────────────────────┴──────────────┤
│                [mic]  [cam]  [  Leave  ]                   │  ← control bar: a bar, not a surface
└────────────────────────────────────────────────────────────┘
```

- **Accent (1):** **Leave** (`variant="default"`). Mic and camera are outline toggles,
  readouts of state; the roster toggle is ghost. The screen spends its one accent on
  the terminal action.
- **Elevated surfaces (0):** the grid, the side column and the control bar are all
  regions on the page ground split by borders. Video tiles are media regions; the
  subtitle is text on a scrim over the video.
- **Transient and error states keep the same count.** Connecting and reconnecting show
  Leave as the accent; permission denied, disconnected, a generic error, room not found
  and room ended show **Back to lobby** as the accent. Camera denied joins audio-only with
  an inline notice; blocked autoplay adds a ghost **Enable audio** control.
- **Budget: 1 accent, 0 elevated surfaces. PASS.** Every state above is a row in
  `accent-budget-app.spec.tsx`.

This replaces the earlier recommendation of 0 accent in-call with Leave in the `live`
state colour. The built screen makes Leave the accent instead; both pass the budget, and
the gate holds the built one.

### 4.3 Chat (inside the side column)

The chat is not a sheet. It sits under the roster in the side column the header toggle
opens and closes, so opening it changes no count.

- **Accent (0 added):** Send is outline, the input is a field. The screen's one accent
  stays Leave.
- **Elevated surfaces (0 added):** the message list and the composer are regions in the
  column. A refused message (sent too fast, or not sent) is shown as text, with no
  control.
- **Budget: 1 accent, 0 elevated surfaces. PASS.** Rows: roster and chat open with
  messages, chat refused for sending too fast, roster closed.

### Mobile

`apps/mobile/app/(app)/conference/` follows the same layout, adapted to a phone. The
controls are `TouchableOpacity` styled from `@chatofy/ui` tokens, the way the rest of the
app builds them, since shadcn exists only for web. No spec counts accents on mobile.

| Screen state                    | Accent                                            | Elevated surfaces                     |
| ------------------------------- | ------------------------------------------------- | ------------------------------------- |
| Lobby                           | 1 — Create a room (filled `primary`)              | 0                                     |
| In-call                         | 0 — Leave is filled `destructive`, a state colour | 0 — the control bar is a bordered bar |
| Chat, roster or transcript open | 0                                                 | 1 — the bottom sheet (`Modal`)        |
| Error states                    | 1 — Back to lobby                                 | 0                                     |
| End screen, loaded              | 1 — Back to lobby                                 | 2 — summary card, minutes card        |

Web and mobile differ on Leave: the accent on web, the destructive state colour on
mobile. Both pass the budget.

### 4.4 End screen

Built on web as `apps/web/app/(app)/conference/[roomId]/ended/page.tsx`. In-call
**Leave** goes here, and so does everyone still in the call when the owner ends the room
(both by `router.replace`, so Back does not rejoin). Leaving clears the
`conference:active` session key, so the lobby does not bounce back into the room.
Error states still offer **Back to lobby**. Mobile mirrors it as
`apps/mobile/app/(app)/conference/ended.tsx` (Leave and owner-ended both `replace` to it),
with the same two cards and the one accent; it writes the minutes in the language the
caller spoke in the call, since the mobile UI has no locale of its own yet.

```
┌─────────────────────────────────────────┐
│            Meeting ended                  │  ← heading
│                                           │
│   ┌───────────────────────────────┐      │
│   │  Duration        42 min        │      │  ← summary card (surface 1):
│   │  Participants    Alice, Bob    │      │     readout rows, no actions inside
│   │  Languages  Vietnamese ↔ English│     │
│   └───────────────────────────────┘      │
│                                           │
│          [  Back to lobby   ]             │  ← the ONE accent
│                                           │
│   ┌ Minutes ──────────── [Generate] ┐    │  ← minutes panel (surface 2),
│   │  summary · key points · ...      │    │     Generate/Regenerate is outline
│   └──────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

- **Accent (1):** **Back to lobby** (`bg-primary`), the single next step.
- **Elevated surfaces (2):** the **summary card**, and the **minutes panel**. The panel
  is the same `MinutesPanel` that `/translate` and history render, with
  `emphasis="quiet"`, so Generate is outline. It is a second card, not a section inside
  the summary card. It carries an action, and the summary card holds only readouts.
- **Minutes are generated on demand.** One copy is stored per room
  (`ConferenceMinutes`), written in the language of whoever generates it. Any
  participant may regenerate it, which replaces the copy. The source is the room's
  `ConferenceTurn` rows in creation order, labelled with each speaker's display name.
  The owner and every participant can read it. Anyone else gets the same 404 as
  `GET /conference/:id`. A failed pass keeps an existing `ready` copy.
- **Duration** runs from the first join to the end of the meeting: the owner ending the
  room, or — as is usual, since no client ends rooms — the last participant leaving
  (`conferenceDurationMinutes` in `@chatofy/types`, shared by web and mobile). While
  anyone is still in the room it reads "Not recorded".
- **States:** loading, not a room the caller was in, no minutes yet, generating,
  minutes ready, last pass failed. Each one is a row in `accent-budget-app.spec.tsx`.
  A room with no turns disables Generate and says there is nothing to summarize.
- **Budget: 1 accent, 2 elevated surfaces (0 while loading or refused). PASS.**

REST, both behind the room's access rule and `ThrottlerGuard`:

| Route                          | Body                               | Answer                                                                                                                                           |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /conference/:id`          | —                                  | detail, now with optional `startedAt` / `endedAt` (ISO)                                                                                          |
| `GET /conference/:id/minutes`  | —                                  | `{ minutes: ConferenceMinutes \| null }`, null until generated                                                                                   |
| `POST /conference/:id/minutes` | `{ language?: 'vi' \| 'en' \| … }` | `{ minutes: ConferenceMinutes }`. 400 nothing said or over `MINUTES_LIMITS.MAX_TOTAL_CHARS`, 404 not in the room, 503/502 provider fault, 10/min |

`ConferenceMinutes` is `{ conferenceId, status, summary, keyPoints, decisions,
actionItems, generatedAt, model }`. That is the shared `minutesContentSchema` in
`packages/types/src/domain/minutes.ts` under a room id.

### 4.5 Budget summary

Web, as built:

| Screen state                             | Accent (≤1)       | Elevated surfaces (≤2)          | Verdict | Gated |
| ---------------------------------------- | ----------------- | ------------------------------- | ------- | ----- |
| Lobby                                    | 1 — Create a room | 0                               | PASS    | yes   |
| In-call, connecting, reconnecting        | 1 — Leave         | 0                               | PASS    | yes   |
| In-call with roster and chat             | 1 — Leave         | 0                               | PASS    | yes   |
| Error and ended states                   | 1 — Back to lobby | 0                               | PASS    | yes   |
| End screen, loading or refused           | 1 — Back to lobby | 0                               | PASS    | yes   |
| End screen, loaded (every minutes state) | 1 — Back to lobby | 2 — summary card, minutes panel | PASS    | yes   |

---

## Unresolved questions

1. **Client/server version pair.** Answered by removal: the clients use plain WebRTC, so
   there is no SFU client library to keep in step with a server.
2. **`@config-plugins/react-native-webrtc` Android permission set.** Answered from the
   `14.0.0` source (§2.3): no foreground-service permission. The app's own microphone
   foreground service covers it.
3. **`react-native-webrtc` + RN 0.83 new architecture (Fabric).** Answered: `124.0.8`
   (exact) with `newArchEnabled: true` and `@config-plugins/react-native-webrtc` `14.0.0`
   (15.x needs Expo ≥ 56) gave two-way audio and video on a physical Android 14 phone on
   2026-10-12 (mediasoup), and again on 2026-10-26 through Cloudflare's SFU.
4. **Backgrounded meetings.** Decided 2026-10-26: audio stays, the camera turns off
   (§2.3). Verified on Android; iOS is config only until an iOS build runs.
5. **In-call accent (0 vs Leave-as-accent).** Decided 2026-10-26: keep what is built.
   Leave is the accent on web; mobile fills Leave with the destructive state colour and
   spends no accent. Both pass the budget.
6. **Cross-browser interop test matrix.** The #207 PoC and the 2026-10-25 live check each
   ran one browser engine; Chrome↔Safari and Chrome↔Firefox interop is unverified and
   belongs in the production test plan.
