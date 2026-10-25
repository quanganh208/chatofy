# Video Client Support and Meeting Screen Design

> **Status: Research for Issue #210, since built in part.** It confirms web and mobile
> client SDK support for the mediasoup media server (chosen in #207, see
> [video-conferencing-architecture.md](../video-conferencing-architecture.md) Open
> Decision 1) and designs the meeting screens. The lobby and call screens are on `main`
> behind the conference flags (`apps/web/app/(app)/conference/`, web, when
> `NEXT_PUBLIC_CONFERENCE_ENABLED=true`; `apps/mobile/app/(app)/conference/`, development
> builds only). The end screen (§4.4) is not built.

**Date:** 2026-10-06
**Media server:** mediasoup (SFU library in-process with NestJS)
**Client SDK (web):** `mediasoup-client`

Every SDK/version claim below cites the npm registry (queried 2026-10-06) or the
mediasoup/library docs. "PoC" means observed on the #207 PoC page, since removed.

---

## 1. Web client (Next.js 16)

### 1.1 SDK version

`apps/web/package.json` pins `mediasoup-client` at **`3.7.18`** (exact, no caret).
This version was published **2024-11-26**. The latest published version is **`3.24.4`**
(2026-10-01) — the installed pin is ~23 minor releases and nearly two years behind.

**Finding — version gap is an adoption risk, not a blocker.** The PoC works on 3.7.18,
so the signaling/media path is proven. But the server-side mediasoup library version
must match the client's negotiated capabilities, and the browser-handler set has grown
since 3.7.18 (see 1.2). Before production, pin client and server to a current, matching
pair and re-run the PoC. Treat this as a deliberate upgrade with a test gate, not a
silent bump — `mediasoup-client` has had breaking changes across majors historically,
and the server library (`mediasoup`) ships a C++ Worker whose ABI is version-coupled.

Source: `https://registry.npmjs.org/mediasoup-client` dist-tags and `time` map.

### 1.2 Browser compatibility

mediasoup-client's `Device` auto-detects the browser and selects a WebRTC handler. The
built-in handlers (mediasoup-client API docs):

| Handler          | Target                                             |
| ---------------- | -------------------------------------------------- |
| `Chrome111`      | Chrome/Chromium >= 111                             |
| `Chrome74`       | Chrome/Chromium >= 74                              |
| `Firefox120`     | Firefox >= 120                                     |
| `Safari12`       | Safari >= 12                                       |
| `ReactNative106` | React Native with `react-native-webrtc` >= 106.0.0 |

**Chrome, Firefox and Safari are all supported** on modern versions. Web apps pass no
`handlerName`/`handlerFactory`; the PoC relies on this auto-detection
(`new mediasoupClient.Device()`, `page.tsx:109`). The handler table is a property of
the installed client version — 3.7.18 predates some handler refinements, which is the
second reason to upgrade before production (1.1).

Source: mediasoup-client API docs (Device handlers).

**Known limitation not covered by this research:** Safari's WebRTC has historically had
the most codec/behaviour quirks (VP8 vs H264, unified-plan edge cases). The PoC was
tested on two tabs of one browser (#207 evidence); cross-browser interop (Chrome↔Safari,
Chrome↔Firefox) is unverified. Flag as a production test-matrix item.

### 1.3 How joining fits the App Router auth session

The PoC already demonstrates the pattern, and it reuses the existing translate-socket
auth path with no new mechanism:

1. `getSession()` from `next-auth/react` returns the session;
   `session.accessToken` is the 15-minute bearer (`auth.ts` exposes it in the `session`
   callback — readable from client JS by design, same as `/ws/translate`).
2. The token rides the WebSocket subprotocol header, not a query string:
   `new WebSocket(url, [WS_SUBPROTOCOL, token])` (`page.tsx:89`). This is the same
   `Sec-WebSocket-Protocol` handshake the API refuses-at-upgrade path already enforces.
3. No access token → the PoC refuses to open the socket (`page.tsx:84`).

**Finding — no new auth work for web.** Conference signaling reuses the translate
socket's auth exactly. The session's `error` flag (`isLiveSession`) and the
30-day-sliding cookie behaviour (`auth.ts`) apply unchanged. The one caveat is token
lifetime: a meeting longer than 15 minutes outlives one access token. The socket is
authenticated only at upgrade, so an established conference socket is unaffected
mid-call; but any new signaling request that re-reads the token (a reconnect) needs the
renewed token. `getSession()` returns the renewed value because `/api/auth/session`
re-mints server-side — so a reconnect handler must call `getSession()` again rather than
caching the first token. This is a client-code note for the production implementation,
not an architecture gap.

### 1.4 CSP additions needed

`apps/web/next.config.ts` sets a strict CSP. Checked against WebRTC's needs:

| Directive                       | Current value            | Meeting need                                                                             |
| ------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `connect-src 'self' <api> <ws>` | API over http(s) + ws(s) | Signaling socket `/ws/conference` — **already covered** (same origin as `/ws/translate`) |
| `media-src 'self' blob:`        | present                  | Remote `MediaStream` → `<video srcObject>` — **already covered**                         |
| `img-src ... blob:`             | present                  | Video frame snapshots if ever used — covered                                             |
| `worker-src 'self' blob:`       | present                  | mediasoup-client uses no extra worker origin — covered                                   |

**Finding — no CSP change is needed for same-origin signaling + SFU-relayed media.**
This is the critical and often-misunderstood point:

**WebRTC ICE/STUN/TURN traffic is NOT governed by CSP.** CSP's `connect-src` controls
`fetch`/`XHR`/`WebSocket`/`EventSource` — it does **not** apply to the UDP/TCP media
transport that `RTCPeerConnection` opens to STUN/TURN servers or peers. There is no CSP
directive for ICE candidates. So adding TURN origins to `connect-src` is neither
required nor effective; the browser's WebRTC stack dials TURN directly, outside the
fetch/socket model CSP sees. (This is a well-known WebRTC/CSP interaction; the W3C
WebRTC spec routes media through the ICE agent, not the fetch stack CSP intercepts.)

**One real deployment constraint, already recorded in #207:** the Cloudflare Tunnel
fronting the web/API hostnames blocks UDP (TCP only), so media must relay through coturn
(TURN over TCP/TLS). That is an infrastructure fact, not a CSP fact — coturn's address
reaches the client as an ICE server in the transport params (`page.tsx:130` already logs
`iceServers`), and the browser contacts it outside CSP.

**Only change if signaling moves off-origin.** If a future deployment puts the
conference socket on a different host than the API (e.g. a dedicated SFU gateway domain),
that host's `ws(s)://` origin must be added to `connect-src`. On today's in-process
mediasoup design the socket is same-origin as the API, so nothing changes.

---

## 2. Mobile client (Expo 55 / React Native 0.83)

### 2.1 Does mediasoup-client work in React Native?

**Yes, but not standalone — it requires `react-native-webrtc`.** mediasoup-client ships a
`ReactNative106` handler that depends on `react-native-webrtc >= 106.0.0` to provide the
`RTCPeerConnection`/`getUserMedia` native implementation (React Native has no browser
WebRTC). The #207 comparison table already states this:
`mediasoup-client@3.7.18 + react-native-webrtc`.

So the architecture is: **same `mediasoup-client` package** as web, with
`react-native-webrtc` supplying the native WebRTC layer and the `ReactNative106` handler
selected (auto-detected, or forced via `handlerName`/`handlerFactory` in
`DeviceOptions`). Signaling code (join, transport create, produce, consume) is portable
from the web PoC; only media capture (`getUserMedia`) resolves to the native module.

Sources: mediasoup-client API docs (handler list), #207 comparison table,
`https://registry.npmjs.org/react-native-webrtc` (latest `124.0.8`, 2026-07-21,
peer `react-native >= 0.60.0`).

### 2.2 Does it need a dev client (custom native build)?

**Yes.** `react-native-webrtc` contains native code (Android/iOS), so it is **not
available in Expo Go**. The mobile app must build a **custom dev client**
(`expo-dev-client` + `expo prebuild` / EAS Build). This is the single biggest mobile
adoption cost: the current `apps/mobile` is a managed Expo app with no custom native
modules (its `package.json` lists only JS/Expo-managed deps, and `newArchEnabled: true`).
Adding WebRTC moves mobile off Expo Go onto a dev-client workflow for every developer and
every device test.

Source: react-native-webrtc README ("not available in the Expo Go app by default… use
expo-dev-client").

### 2.3 Config plugin, permissions

An out-of-tree Expo config plugin exists: **`@config-plugins/react-native-webrtc`**
(latest `15.0.2`, 2026-08-15; "Config plugin to setup react-native-webrtc on prebuild").
It wires the native module into the prebuild and declares permissions.

**iOS (`Info.plist`, added by the plugin):**

| Key                            | Purpose           | Plugin default (overridable)                      |
| ------------------------------ | ----------------- | ------------------------------------------------- |
| `NSCameraUsageDescription`     | camera access     | "Allow $(PRODUCT_NAME) to access your camera"     |
| `NSMicrophoneUsageDescription` | microphone access | "Allow $(PRODUCT_NAME) to access your microphone" |

Plugin props: `cameraPermission`, `microphonePermission` (both strings) to localise the
prompt copy.

**Background audio (iOS):** the config plugin does **not** add the `audio` background
mode. A meeting that must keep audio alive when the app is backgrounded needs
`UIBackgroundModes` → `audio` added separately (via `expo-build-properties` or an
`infoPlist` entry in `app.json`). Decide whether backgrounded meeting audio is in scope;
if yes, this is an extra config step the plugin will not do for you.

**Android:** `react-native-webrtc` requires `CAMERA` and `RECORD_AUDIO`, and typically
`MODIFY_AUDIO_SETTINGS`, `INTERNET`, and (for foreground calls) a foreground-service
permission. The config plugin's exact Android permission set was **not confirmed from the
plugin docs in this research** — the README directs to the platform install guide. This
is an **unresolved item**: confirm the plugin's Android manifest additions against the
`@config-plugins/react-native-webrtc@15.0.2` source before relying on it, and add any
missing permission (e.g. `FOREGROUND_SERVICE_MICROPHONE` on Android 14+) explicitly.

**Config example (illustrative, for the production plan — not to commit now):**

```jsonc
// app.json plugins[]
[
  "@config-plugins/react-native-webrtc",
  {
    "cameraPermission": "Chatofy needs your camera for meetings",
    "microphonePermission": "Chatofy needs your microphone for meetings",
  },
]
```

### 2.4 Mobile adoption risk summary

| Factor              | Assessment                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| SDK works?          | Yes — `mediasoup-client` + `react-native-webrtc` (`ReactNative106`)                                                                 |
| Expo Go?            | **No** — custom dev client / prebuild required                                                                                      |
| Native build cost   | High for this app: it is currently pure managed Expo                                                                                |
| New-arch (Fabric)   | `newArchEnabled: true`; `react-native-webrtc` supports the new arch on recent versions — **verify** against RN 0.83 before building |
| Permissions         | Camera/mic via config plugin; background audio + full Android set are manual                                                        |
| Code reuse from web | High — signaling is portable; only capture differs                                                                                  |

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

### 4.1 Pre-join (device check)

**Layout.** A single centred column on the page ground:

```
┌─────────────────────────────────────────┐
│            Join "Team sync"               │  ← heading (text-heading, serif)
│                                           │
│   ┌───────────────────────────────┐      │
│   │                               │      │  ← local camera preview (media region,
│   │        [ camera preview ]      │      │     not a card — like the PoC's <video>)
│   │                               │      │
│   └───────────────────────────────┘      │
│                                           │
│   Camera   [ FaceTime HD      ▾ ]         │  ← Select (field/well)
│   Mic      [ MacBook Mic       ▾ ]        │  ← Select (field/well)
│   Language [ Tiếng Việt / English ]       │  ← SegmentedControl (two named things)
│                                           │
│            [    Join now    ]             │  ← the ONE accent
└─────────────────────────────────────────┘
```

- **Accent (1):** the **Join now** button (`bg-primary`). It is the single action the
  screen exists for.
- **Elevated surfaces (0):** the device-check column sits on the page ground. The camera
  preview is a media region (black `srcObject` rect), not a card. Device selectors are
  fields (wells cut into the surface, `--inset-field`), which are not elevated surfaces.
- Language is a `SegmentedControl` (two named things = segmented, per design-guidelines
  "No longer duplicated"), **not** an accent — a selected segment is a readout.
- **Budget: 1 accent, 0 elevated surfaces. PASS.**

### 4.2 In-call

**Layout.** Participant grid fills the content area; a control bar floats at the bottom;
name labels and the subtitle overlay sit on the video, not in a panel.

```
┌─────────────────────────────────────────────────────┐
│  ┌──────────────┐  ┌──────────────┐                  │
│  │              │  │              │                  │  ← participant grid
│  │  [video]     │  │  [video]     │                  │     (media regions)
│  │  Alice       │  │  Bob         │   name label      │
│  └──────────────┘  └──────────────┘   on each tile    │
│                                                       │
│        Bob: "Let's start with the budget."            │  ← subtitle overlay (on video,
│                                                       │     text on scrim, no surface)
│  ┌─────────────────────────────────────────────┐     │
│  │  [mic] [cam]  [chat]        [ Leave ]         │     │  ← control bar (1 elevated surface)
│  └─────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────┘
```

- **Accent (1):** exactly one control gets `bg-primary`. The controls split into two
  kinds: toggles (mic, cam, chat-panel) and the terminal action (Leave). **Leave is a
  destructive-ish terminal action, not the accent** — and mute/cam/chat are toggles
  (readouts of state), also not the accent. That leaves a choice: the design budget needs
  **at most** one accent, and zero is allowed. **Recommendation: spend the one accent on
  the mic toggle's "unmute" active affordance is wrong** (a toggle is a readout). So
  **in-call spends 0 accent** — every control is a ghost/outline icon button, Leave is an
  outline button in the `live`/destructive treatment if needed. This mirrors `/translate`,
  which spends its accent on Start/Generate but an _active call_ is a running state, not a
  start action.
  - If product wants a visible primary, the only defensible accent is **Leave** rendered
    as the one filled control — but Leave is better as a `live`-toned outline (it ends the
    session, like the translate Stop button which uses `liveFill`, not the accent). **So:
    0 accent, Leave uses `liveFill` state colour (not counted as accent).**
- **Elevated surfaces (1):** the **control bar** is one elevated surface (a panel over
  the page, `elevation-lg`). Video tiles are media regions, not surfaces. The subtitle
  overlay is text on a scrim on the video, not a surface.
- **Budget: 0 accent, 1 elevated surface. PASS.** (Headroom for the chat panel, 4.3.)

Note on the subtitle overlay: it reuses the _concept_ of the extension overlay (text over
someone else's video) but renders in-app, so it uses app tokens, not the overlay-only
tokens. State colours (`speaking` when a translation is playing) are allowed and are not
the accent.

### 4.3 Chat panel (overlay on in-call)

**Layout.** A side sheet slides in over the in-call screen; the grid reflows to the
remaining width. The chat is a `Sheet`/panel.

```
┌───────────────────────────────┬───────────────────┐
│  ┌──────────┐ ┌──────────┐    │  Chat             │  ← panel heading
│  │ [video]  │ │ [video]  │    │ ───────────────   │
│  │ Alice    │ │ Bob      │    │  Bob  10:02       │
│  └──────────┘ └──────────┘    │  Let's start...   │  ← message list
│                               │                   │     (list on panel ground)
│   Bob: "..."  (subtitle)      │  Alice 10:03      │
│                               │  Sounds good      │
│  ┌─────────────────────────┐  │ ───────────────   │
│  │ [mic][cam][chat] [Leave] │  │ [ type a message ]│  ← input (field) + send
│  └─────────────────────────┘  │              [↑]  │  ← the ONE accent (send)
└───────────────────────────────┴───────────────────┘
```

- **Accent (1):** the chat **send** button (`bg-primary`), the one action the panel adds.
  In-call spends 0 accent (4.2), so opening the chat brings the screen-state to exactly 1.
- **Elevated surfaces (2):** the **control bar** (still present, elevated) + the **chat
  panel** (a `Sheet`, elevated). That is the budget's ceiling of two — which is why the
  chat panel must be the _second_ surface and nothing else on this state may elevate. The
  message list is a list on the panel ground, not a third surface; the input is a field.
- **Budget: 1 accent, 2 elevated surfaces. PASS (at ceiling).**

**Design constraint this creates:** because chat-open is at the 2-surface ceiling, the
in-call state (4.2) **must** stay at one elevated surface — if the control bar ever
became two stacked surfaces, opening chat would break the budget. The gate
(`accent-budget-app.spec.tsx`) would catch it if these screens were added as `SCREENS`
rows, which the production implementation should do.

### 4.4 End screen

**Layout.** A single centred summary card on the page ground.

```
┌─────────────────────────────────────────┐
│            Meeting ended                  │  ← heading
│                                           │
│   ┌───────────────────────────────┐      │
│   │  Duration        42 min        │      │  ← summary card (1 elevated surface):
│   │  Participants    Alice, Bob    │      │     readout rows, no actions inside
│   │  Languages       vi ↔ en       │      │
│   └───────────────────────────────┘      │
│                                           │
│          [   Back to chat   ]             │  ← the ONE accent
└─────────────────────────────────────────┘
```

- **Accent (1):** the **Back to chat** button (`bg-primary`), the single next step.
- **Elevated surfaces (1):** the **summary card** (`elevation-md`). It is a card because
  you read it as a unit; it holds only readouts, no nested action.
- **Budget: 1 accent, 1 elevated surface. PASS.**

**Deferred: the end screen, and minutes on it.** Issue #210 asks for an end screen "with
minutes". Neither is built: Leave returns to the conference lobby. Minutes are deferred
because conferences have no minutes pipeline yet. The minutes that exist on `main` are
generated from a `/translate` conversation's stored turns; a conference stores
`ConferenceTurn` rows, but nothing summarises them. When that pipeline exists, a
**Minutes** readout section goes inside the summary card, keeping the budget above.

### 4.5 Budget summary

| Screen state         | Accent (≤1)                            | Elevated surfaces (≤2)       | Verdict |
| -------------------- | -------------------------------------- | ---------------------------- | ------- |
| Pre-join             | 1 — Join now                           | 0                            | PASS    |
| In-call              | 0 (Leave = `liveFill`, a state colour) | 1 — control bar              | PASS    |
| Chat panel (on call) | 1 — send                               | 2 — control bar + chat panel | PASS    |
| End screen           | 1 — Back to chat                       | 1 — summary card             | PASS    |

All four pass both budgets. The tightest is chat-open at exactly 2 surfaces, which pins
in-call to one elevated surface.

---

## Unresolved questions

1. **mediasoup-client / mediasoup version pair.** Installed client is `3.7.18`
   (2024-11); latest is `3.24.4` (2026-10). The production plan must choose a current,
   matching client+server pair and re-run the PoC — do not assume 3.7.18 is the target.
2. **`@config-plugins/react-native-webrtc` Android permission set.** Not confirmed from
   plugin docs in this research; verify the manifest additions against
   `@config-plugins/react-native-webrtc@15.0.2` source, and confirm Android 14+
   foreground-service-microphone handling.
3. **`react-native-webrtc` + RN 0.83 new architecture (Fabric).** Answered: `124.0.8`
   (exact) with `newArchEnabled: true` and `@config-plugins/react-native-webrtc` `14.0.0`
   (15.x needs Expo ≥ 56) gave two-way audio and video on a physical Android 14 phone on
   2026-10-12.
4. **Backgrounded meeting audio on iOS.** The config plugin does not add
   `UIBackgroundModes: audio`. Decide whether meetings continue audio when backgrounded;
   if yes, add it manually.
5. **In-call accent (0 vs Leave-as-accent).** This document recommends 0 accent in-call
   with Leave rendered in the `live` state colour (mirroring the translate Stop button).
   A product decision could instead make Leave the one accent; both pass the budget, but
   the state-colour treatment is more consistent with existing patterns.
6. **Cross-browser interop test matrix.** The #207 PoC tested one browser; Chrome↔Safari
   and Chrome↔Firefox interop is unverified and belongs in the production test plan.
