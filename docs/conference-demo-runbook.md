# Conference Feature — Demo Runbook

**Branch:** `video-conferencing`  
**Target:** thesis demo on one host / loopback (single machine, same browser, multiple profiles)  
**Last verified:** 2026-10-15

---

## 1. Prerequisites

### Environment files

`apps/api/.env` must have at minimum:

```bash
# Required — the API refuses to start without it
AUTH_JWT_SECRET=<32-byte base-64 string>
# openssl rand -base64 32

# Required for machine-translation (Gemini)
GEMINI_API_KEY=<your key>

# Demo concurrency — raise these for 3+ simultaneous speakers.
# Default (6 / 4) is sufficient for a 2-participant demo.
# For 3 active speakers all translating at once, saturate hits the default cap;
# raise both before the demo and restart the STT sidecar after changing LOCAL_STT_CONCURRENCY.
MAX_CONCURRENT_TURNS_GLOBAL=12
LOCAL_STT_CONCURRENCY=6
```

`apps/web/.env.local` must have:

```bash
# Signs the Next-Auth session cookie
AUTH_SECRET=<32-byte base-64 string>
# openssl rand -base64 32

# Points the web app at the local API WebSocket
NEXT_PUBLIC_API_WS_URL=ws://localhost:3000
```

### Mobile environment file (only when testing the React Native app)

`apps/mobile/.env` must have:

```bash
# API address the device/emulator calls (the API is on port 3000, NOT web's 3001).
#   - Android emulator: the in-code default is already http://10.0.2.2:3000
#     (10.0.2.2 maps to the host machine's localhost) — no need to set it.
#   - Real device: you MUST set the host machine's LAN IP, e.g. http://192.168.1.50:3000
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3000

# Mobile auth is still a stub (no real sign-in yet), so the conference socket gets its
# token by logging in as a registered "bench" account. The /ws/conference gateway DOES
# validate the token, so it cannot be skipped. Use a registered account, or create a
# bench account quickly:
#   node apps/api/scripts/create-bench-user.cjs   # creates bench@dev.local / Benchmark123!
EXPO_PUBLIC_BENCH_EMAIL=bench@dev.local
EXPO_PUBLIC_BENCH_PASSWORD=Benchmark123!
```

### Accounts

You need 2–3 registered accounts (one per browser profile). Create them via
`http://localhost:3001/register` after the stack is up. Email verification links are
printed to the API console when `SMTP_*` env vars are unset — copy the link, open it in
the same browser, done.

---

## 2. Start sequence

```bash
# From the repo root — starts Postgres, Redis, both speech sidecars (local-stt on
# port 8002, local-tts on port 8003), the NestJS API on port 3000, and the Next.js
# web app on port 3001. Blocks in the terminal.
pnpm dev:all
```

Wait until the terminal shows:

- `[api] Application is running on: http://localhost:3000`
- `[web] ✓ Ready in ...`
- Both sidecars print a startup banner (local-stt and local-tts each log to stdout)

**URLs**

| Surface          | URL                              |
| ---------------- | -------------------------------- |
| Web app          | http://localhost:3001            |
| API (health)     | http://localhost:3000/health     |
| STT sidecar      | http://localhost:8002            |
| TTS sidecar      | http://localhost:8003            |
| Conference lobby | http://localhost:3001/conference |

---

## 3. Demo script (one host, 2–3 browser profiles)

### Setup

Open Chrome (or any Chromium browser) with two or three separate profiles. Each
profile should be signed in to a different Chatofy account. Arrange the windows
side-by-side.

### Step-by-step

1. **Profile A** — navigate to `http://localhost:3001/conference`.
2. Enter a name (e.g. "Quang Anh"), leave the room ID as generated, pick **Tiếng Việt**.
3. Click **Start** — the in-call screen opens. Copy the room ID from the URL bar
   (`/conference/<roomId>`).
4. **Profile B** — navigate to `http://localhost:3001/conference`.
5. Enter a name (e.g. "Alice"), paste the room ID into the Room ID field, pick **English**.
6. Click **Start** — Profile B joins the same room. Both profiles now show each other's video.

### Translation demo

7. **Profile A (Vietnamese)** — speak a short sentence in Vietnamese (5–10 words, then pause).
   - Profile B (English) should see a subtitle appear within ~6 s (warm session) and hear the
     English translation spoken aloud shortly after.
8. **Profile B (English)** — respond with a short sentence in English.
   - Profile A (Vietnamese) should see and hear the Vietnamese translation.

**What to point out to the audience:**

- The subtitle appears **before** the translated audio (subtitle is faster — no TTS encoding delay).
- The room is a short alphanumeric ID anyone can type or share.
- Each participant independently picks their own language.

### Mute / camera controls

9. Profile A clicks the mic button → mic mutes; Profile B's roster shows the muted icon.
10. Profile A clicks the camera button → video tile goes dark on both sides.
11. Click both again to restore.

### Leave

12. Either profile clicks **Leave** → returns to the conference lobby. The other
    profile's grid removes the departed tile.

### Smoke checklist (tick each — maps to polish items A/B/C/D)

Run this once on a real stack before trusting the demo. Each line is a thing to see or hear
with your own eyes/ears — the unit tests cannot confirm any of it. Tick `[x]` as you go.

**Basics**

- [ ] Both profiles reach `/conference` from the sidebar **Conference** link (not just a typed URL).
- [ ] After both join the same room, each sees the other's **video** and hears the other's raw voice.
- [ ] Mic button mutes and the peer's roster shows the muted icon; camera button darkens the tile on both sides; **Leave** returns to the lobby and removes the tile for the other peer.

**Bidirectional translation (the core)**

- [ ] Vietnamese speaker → the English profile sees a **Vietnamese→English subtitle** and hears English audio.
- [ ] English speaker → the Vietnamese profile sees an **English→Vietnamese subtitle** and hears Vietnamese audio. (The old PoC failed this direction — it is the headline fix.)

**A — audio unlock**

- [ ] Translated speech is actually **audible** from the speakers/headphones.
- [ ] If it is silent on first join, a **"tap to enable sound"** control appears; clicking it makes audio play. (If audio plays without ever seeing that control, that is also a pass.)

**B — translating indicator**

- [ ] While you speak and before the subtitle lands, a **"translating…"** badge shows on your own tile, then clears when the subtitle arrives (and never stays stuck).

**C — active-speaker + subtitle styling**

- [ ] The tile of whoever is currently speaking/translating has a visible **highlight ring**.
- [ ] Subtitles are **large and legible** from across a room; a final line is solid, a partial one is dimmer.

**D — auto-reconnect** (kill the API mid-call to simulate a drop)

- [ ] With a call live, stop the API briefly (`Ctrl+C` the `pnpm dev:all` terminal, or `docker`/process kill), then restart it: the UI shows **"Reconnecting (1/3)…"** and the call **recovers** on its own — no duplicate tiles, audio resumes.
- [ ] Kill the API for longer than 3 attempts (~7 s): the UI falls through to **"Connection lost. The call ended."** with a Back to lobby button (the terminal dead-end, not a crash).

If any line fails, note the symptom and the browser DevTools console `[T1]`–`[T4]` lines for that
turn — they pinpoint which stage (audio sent / transcript / subtitle / TTS frame) broke.

---

## 4. Mobile testing (React Native) — mobile ↔ web in the same room

This brings the conference on the `apps/mobile` app to parity with web: video, realtime
translation (subtitles + TTS audio), and per-recipient translated chat. It all runs against
the same `pnpm dev:all` stack above — mobile is just a second client of the same API.

### 4.1 Mobile-specific prerequisites

- **You must build a dev client** — the app has native modules (`react-native-webrtc`,
  `react-native-audio-api`). **Expo Go will NOT work.** The first run has to build native.
- `apps/mobile/.env` filled per §1 (`EXPO_PUBLIC_API_BASE_URL` on port 3000 and
  `EXPO_PUBLIC_BENCH_*`).
- The API/web/sidecar stack is running (`pnpm dev:all`).
- A bench account exists (create with `node apps/api/scripts/create-bench-user.cjs` if not).

### 4.2 Build and open the app

```bash
# Build + install the dev client onto an emulator/device (first run takes a few minutes
# because it builds native).
pnpm --filter mobile android      # or: pnpm --filter mobile ios
```

When the app opens, go to the **Conference** screen → the conference lobby.

### 4.3 Demo steps (mobile joins as the second participant)

1. **On web (Profile A, Tiếng Việt)** — create a room at `http://localhost:3001/conference`,
   copy the room ID (`/conference/<roomId>`).
2. **On mobile** — open Conference → enter a name (e.g. "Minh"), **paste the room ID**, pick
   **English** → tap **Start**.
3. When the OS prompts, **grant camera + mic**. Mobile joins the same room as web.

### 4.4 Checklist — what to test and what "OK" looks like

Like web, each line is something to see/hear on the device. Tick `[x]` when it passes.

**Video (Phase 1)**

- [ ] Mobile joins the web-created room; **both sides see each other's video** (RTCView renders)
      and hear raw voice. OK = video flows both ways, no duplicate tiles, no crash.
- [ ] On mobile tap **mic** → web's roster shows the muted icon; tap **camera** → the mobile
      tile darkens on both sides; tapping again restores.
- [ ] Tap **Leave** → mobile returns to the lobby; web's grid drops the mobile tile; **the
      device camera light goes off** (teardown released mic/cam).

**Translation audio (Phase 2) — TOP RUNTIME RISK: mic contention**

- [ ] Speak **English** on mobile → web (Tiếng Việt) sees an **English→Vietnamese subtitle**
      and hears Vietnamese. ⚠ This is the most likely thing to fail: `react-native-webrtc`
      holds the mic for the call, while the `react-native-audio-api` recorder is a **second**
      mic consumer. OK = the raw call audio is kept **and** a transcript shows on web. A typical
      FAIL = the recorder cannot open, or the call loses audio when translation starts → use the
      "tap the webrtc audio track directly" fallback (documented in the Phase 2 report), not a
      logic bug.
- [ ] Web speaks **Vietnamese** → mobile sees a Vietnamese→English subtitle and **hears English
      from the mobile speaker**, in order, no overlap. OK = TTS audio is clear and sequential.

**Translation UX (Phase 3)**

- [ ] While you speak on mobile, your own tile shows a **"translating…"** badge, then clears
      when the final subtitle lands (or after a timeout) — never stuck.
- [ ] Subtitles render on the active speaker's tile; opening the **transcript sheet** shows the
      turns accumulating.
- [ ] The **language picker** shows the chosen language correctly. Note: it is a **locked
      readout** during a call (the screen auto-joins on open) — to change language, pick it in
      the lobby BEFORE joining. OK = the picker reflects the right language, no mid-call change.

**Per-recipient translated chat (Phase 4)**

- [ ] Open the **chat** panel, send from mobile → web receives the message **translated into
      web's language**; web sends → mobile receives it **translated into mobile's language**.
      Your own message shows immediately (echo). OK = each side reads messages in its own
      language; Leave stays the single accent control, chat is a secondary panel.

> Chat translation is done on the **server** (the gateway translates per recipient) — the client
> only sends `conference.chat` and renders. If one direction does not translate, check
> `GEMINI_API_KEY` as for web.

### 4.5 Mobile troubleshooting

| Symptom                                               | Common cause                                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Join fails immediately / no WS connection             | `EXPO_PUBLIC_API_BASE_URL` wrong port (must be **3000**) or wrong host (emulator uses `10.0.2.2`, a real device uses the host machine's LAN IP).         |
| Joins straight to `not-authenticated`                 | Missing `EXPO_PUBLIC_BENCH_*` or the bench account does not exist → run `create-bench-user.cjs`.                                                         |
| App won't build / native module error                 | Running Expo Go — you must build a **dev client** (`expo run:android`/`ios`).                                                                            |
| Video works but enabling translation kills call audio | Mic contention (top risk) — confirm by turning translation off; if the call regains audio it is contention, and the webrtc-track-tap fallback is needed. |

---

## 5. Edge-case states (what to expect, not errors)

| Situation                                | What the UI shows                                                    |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Browser blocks camera AND mic            | "Camera and microphone access is required" + Back to lobby button    |
| Browser blocks only camera (mic granted) | Joins audio-only; soft banner: "No camera — joining with audio only" |
| WS disconnected mid-call (killed API)    | "Connection lost. The call ended." + Back to lobby button            |
| Opened before signing in                 | Browser redirected to `/login` automatically                         |

---

## 6. Known demo risks (stated plainly)

| Risk                                                    | Impact                                         | Note                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One-host / loopback only**                            | A remote guest cannot join                     | Cross-network media (TURN/STUN, UDP 40000–49999) is **untested** (Issue #208). Demo on the same machine.                                                                                                                                                                                            |
| **Mobile fully coded but NOT smoke-tested on a device** | May fail right at the mobile demo              | All four phases (video, translation audio, UX, chat) are implemented and pass static checks (typecheck/lint), but have **not been run at runtime** — that needs a dev-client build + 2 devices. Run §4 before trusting it. Top risk: mic contention between `react-native-webrtc` and the recorder. |
| **Multi-speaker concurrent translation load**           | Translation queues at 3+ simultaneous speakers | `MAX_CONCURRENT_TURNS_GLOBAL` default (6) saturates at 3 speakers × 2 jobs each. Raise to 12 per §1 above. Not formally load-tested with all caps raised.                                                                                                                                           |
| **~6 s warm translation latency**                       | Audience may notice the delay                  | Measured: ~6 s warm (T1→T2 on a local stack). Script speakers to use short turns and pause between them. Lead with the subtitle — it appears before the audio.                                                                                                                                      |
| **Cold-session first-utterance penalty**                | First translation takes ~9 s                   | The STT model buffers ~2–3 s of audio before emitting a transcript on a cold session. Warm up each profile by speaking one throwaway sentence before the live demo.                                                                                                                                 |

---

## 7. Reset between runs

```bash
# Stop everything (Postgres, Redis, sidecars, API, web)
pnpm dev:stop

# Restart for a fresh run
pnpm dev:all
```

To reset participant accounts between runs, sign out of each browser profile and
sign back in — no database wipe is needed.

To reset the Postgres data entirely:

```bash
pnpm dev:stop
docker compose down -v postgres
docker compose up -d --wait postgres
pnpm --filter api exec prisma migrate deploy
pnpm dev:all
```

---

## 8. Troubleshooting

**"Application is running" but `/health` returns 500**  
Check `AUTH_JWT_SECRET` and `GEMINI_API_KEY` are set in `apps/api/.env`.

**STT sidecar does not start**  
Docker Desktop must be running. `docker compose up -d --wait` is included in
`pnpm dev:all`; if a sidecar exits, check `docker compose logs local-stt`.

**No translated audio from Profile B (English speaker)**  
Confirm `GEMINI_API_KEY` is valid. The MT step (Google Gemini) is the one cloud
call in the pipeline; STT and TTS run locally.

**`LOCAL_STT_CONCURRENCY` change had no effect**  
This env var is read at **sidecar startup**. After changing it, restart the
sidecar: `docker compose restart local-stt`.

**Translation works one way but not the other**  
Verify each profile's language is set correctly in the lobby (Tiếng Việt vs English).
The direction is computed at join time from the language selected on the lobby page.
