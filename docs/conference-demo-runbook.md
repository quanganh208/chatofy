# Conference Feature — Demo Runbook

**Target:** thesis demo on one machine (loopback, one browser with several profiles,
optionally an Android dev build on the same LAN)
**Last revised:** 2026-10-27

Conferencing is on `main` and always loaded. Everything below is a
local run. Meeting media goes through Cloudflare Realtime SFU even locally, so the machine
needs internet access and a Cloudflare Realtime app (Decision 7 in
[video-conferencing-architecture.md](./video-conferencing-architecture.md)). The production
keys are in [deployment-guide.md → Video conferencing](./deployment-guide.md#video-conferencing).

---

## 1. Prerequisites

### Environment files

`apps/api/.env`, at minimum:

```bash
# Required — the API refuses to start without it (openssl rand -base64 32)
AUTH_JWT_SECRET=<32-byte base-64 string>

# Required: Cloudflare dashboard > Realtime > Serverless SFU.
# The API refuses to boot without both. Never paste the secret into chat or a log.
CLOUDFLARE_REALTIME_APP_ID=<app id>
CLOUDFLARE_REALTIME_APP_SECRET=<app secret>

# Optional: Realtime > TURN Server. Only needed on a network that blocks UDP.
CLOUDFLARE_TURN_KEY_ID=
CLOUDFLARE_TURN_KEY_API_TOKEN=
```

Meeting speech is translated by the same cascade as /translate: local STT, the configured
translation provider (`AI_TRANSLATION_PROVIDER`, `deepseek` by default, which reads
`OPENAI_COMPATIBLE_API_KEY`), then local TTS. Chat messages use the same provider, so its
key must be set. Minutes are summarized by Gemini (`GEMINI_API_KEY`). The speech
sidecars are reached at `LOCAL_STT_URL` and `LOCAL_TTS_URL` (defaults `:8002`, `:8003`).

`apps/web/.env.local`:

```bash
AUTH_SECRET=<32-byte base-64 string>   # openssl rand -base64 32
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
```

### Accounts

One registered account per browser profile (2–3). Register at
`http://localhost:3001/register`; with `SMTP_*` unset the verification link is printed to
the API console.

---

## 2. Start sequence

A meeting needs the speech sidecars: every speaker's turn goes through local STT and TTS.

**On a machine without production**, start everything in Docker:

```bash
# Postgres, Redis, the speech sidecars, then the API (3000) and web (3001).
pnpm dev:all
```

**On a machine whose Docker VM also runs production, never start the dev sidecars in
Docker.** They share the VM's memory with production and have OOM-killed and restarted
the production STT. Run the sidecars natively on the host with `uv` instead, on the dev
ports, following "work on the Python directly" in
[`services/local-stt/README.md`](../services/local-stt/README.md) and
[`services/local-tts/README.md`](../services/local-tts/README.md) (including the
`libonnxruntime.so` link both need after a `uv sync`). Then:

```bash
docker compose up -d --wait postgres redis
pnpm --filter api dev          # 3000; reads LOCAL_STT_URL / LOCAL_TTS_URL
pnpm --filter web dev          # 3001
```

Never point a benchmark or load run at the production sidecars (`:8012`, `:8013`), and
stop the native sidecars when the demo ends.

Wait for `[api] Application is running on: http://localhost:3000` and `[web] ✓ Ready`.

| Surface          | URL                              |
| ---------------- | -------------------------------- |
| Web app          | http://localhost:3001            |
| API (health)     | http://localhost:3000/health     |
| Conference lobby | http://localhost:3001/conference |

---

## 3. Demo script (one host, 2–3 browser profiles)

Each profile is signed in to a different account; arrange the windows side by side.

1. **Profile A** opens **Conference** from the sidebar, enters a name, picks **Tiếng Việt**,
   and clicks **Create a room**. The lobby calls `POST /conference` and opens
   `/conference/<roomId>`. Copy the id from the URL.
2. **Profile B** opens **Conference**, enters a name, picks **English**, pastes the id and
   clicks **Join**. Both now see and hear each other.

The link is the access: anyone signed in who has the id can join. There are no
client-made ids; an id that `POST /conference` did not create shows the room-not-found
state, and an ended room shows room ended.

### Translation

3. **A** says a short Vietnamese sentence, then pauses. **B** sees the subtitle build up
   and hears English. The subtitle grows while A speaks and settles when the server
   finishes the turn; with one speaker the translated speech starts about 1.4 s after A
   stops (measured on the dev stack).
4. **B** answers in English; **A** sees and hears Vietnamese.
5. **Three languages.** A third profile joins as **中文**. From A's next sentence on, B
   sees English and C sees Chinese, and each hears only their own language; a sentence
   already in flight when C joined is not translated into Chinese. B and C speaking get
   the same treatment.

Point out: each participant picks their own language; subtitles reach only listeners of
another language, each in their own, and translated speech reaches only listeners of its
language. One speaker's turn is translated once into every language in the room.

### Controls, chat, leave, end

6. Mic and camera buttons: the other side's roster shows muted; the tile darkens. A muted
   speaker is not translated.
7. Chat: a message arrives translated into each recipient's language.
8. **Leave** returns to the lobby; the other side drops the tile. A sentence finished just
   before leaving is still delivered.
9. Ending the room as its creator (`DELETE /conference/:id`) closes every peer's call with
   the room-ended state. It does not reconnect.

### Smoke checklist

Run once on a real stack before trusting the demo; none of this is visible to unit tests.

- [ ] The **Conference** sidebar entry is shown.
- [ ] Create a room → the call opens; Join with the copied id from a second profile works.
- [ ] Joining a made-up id shows room not found, without retrying.
- [ ] vi → en and en → vi both show a subtitle and play translated audio.
- [ ] With a zh peer, each listener gets only its own language, text and audio.
- [ ] If audio is silent on first join, a **tap to enable sound** control appears and works.
- [ ] A **translating…** badge shows on your own tile while you speak and clears when the
      turn settles.
- [ ] Stop the API briefly mid-call: the UI shows **Reconnecting (n/3)…** and recovers.
      Stopped for longer than three attempts, it ends with a disconnected state.
- [ ] The same account joining from a second tab replaces the first; the first tab leaves
      the call and does not reconnect.

---

## 4. Mobile (Android dev client)

The phone signs in with a real account: **Sign in** on the landing screen, or opening the
**Conference** tab while signed out, leads to the sign-in screen. The session is kept in
the OS keystore and renewed like the web's; **Settings → Sign out** ends it. Register the
account on the web first (§1, Accounts): registration needs the mailed link.

`apps/mobile/.env`:

```bash
# The API port (3000), not web's. Emulator default is http://10.0.2.2:3000;
# a real device needs this machine's LAN IP.
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.50:3000
```

The phone reaches the API for sign-in, signaling and translation (`/ws/translate`, the
same cascade as the web); its media goes to Cloudflare like the browser's.

Build and run a dev client (Expo Go cannot load `react-native-webrtc`):

```bash
cd apps/mobile
npx expo prebuild --platform android
cd android && ./gradlew installDebug -PreactNativeArchitectures=<device ABI>
cd .. && npx expo start --dev-client
adb reverse tcp:8081 tcp:8081
```

Then: create a room on web (§3 step 1), open **Conference** on the phone, enter the id and
join; grant camera and mic. Two-way audio and video were confirmed this way on an Android
14 phone on 2026-10-12, and through Cloudflare's SFU on 2026-10-26. Check the same list as §3, plus that Leave turns the camera light
off. The language is picked in the lobby; it is read-only during the call.

**Translation on the phone.** The speaker leg runs the shared cascade leg from
`@chatofy/realtime-client`; Hermes lacks `crypto.randomUUID`, so a polyfill is imported
first in `apps/mobile/app/_layout.tsx` (`apps/mobile/src/polyfills/`). The translation
recorder needs the native patch `patches/react-native-audio-api@0.13.6.patch` (an
echo-cancelling input preset), so **rebuild the dev client** (`./gradlew installDebug`)
after pulling it: a JS reload alone keeps the unpatched recorder. On the loudspeaker the
phone still hears loud received translations; it holds back a new turn while one plays,
so speak after it, and keep the volume moderate or use headphones. Why:
[video-translation-audio-path.md § 5](./architecture/video-translation-audio-path.md#5-echo--ducking--the-original-voice-while-translation-plays).

**Old builds must update.** An APK built before meetings moved to the cascade speaks the
removed live path; a server with live mode off closes that socket with 4410, so the phone
joins the call but gets no translation. The same holds for a web tab opened before the
deploy until it reloads.

| Symptom                                  | Cause                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| No WebSocket connection                  | `EXPO_PUBLIC_API_BASE_URL` on the wrong port or host                                         |
| Not authenticated                        | Bench variables missing, or the account does not exist                                       |
| Native module error                      | Running in Expo Go instead of a dev client                                                   |
| Gradle: `SDK location not found`         | `ANDROID_HOME` unset: `export ANDROID_HOME=$HOME/Android/Sdk` (Linux default) and re-run     |
| Joins but no media                       | The network blocks UDP: set the two `CLOUDFLARE_TURN_*` keys so the join hands out TURN      |
| Call audio drops when translation starts | Mic contention between `react-native-webrtc` and the translation recorder; confirm by muting |
| Joins, but never translated              | An APK from before the cascade (the API closes its live socket with 4410): rebuild it        |

---

## 5. Edge-case states (expected, not errors)

| Situation                               | What the UI shows                           |
| --------------------------------------- | ------------------------------------------- |
| Browser blocks camera and mic           | Permission-required message + Back to lobby |
| Only the camera is blocked              | Joins audio-only with a banner              |
| Unknown room id                         | Room not found; no retry                    |
| Room ended by its creator               | Room ended; no reconnect                    |
| API gone for longer than three attempts | Connection lost + Back to lobby             |
| Opened before signing in                | Redirected to `/login`                      |

---

## 6. Known demo risks

| Risk                                | Impact                                      | Note                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local API, one LAN                  | A remote guest cannot join                  | Media crosses Cloudflare, but signaling needs the API; a guest elsewhere needs the production site.                                                               |
| Several people talking non-stop     | Some sentences are never translated         | Meeting legs share 4 of the server's 6 turns. Two continuous speakers lost 12–25 turns each per 200 s on the dev stack, and one can starve the other. Take turns. |
| en → vi under load                  | Some Vietnamese audio is missing            | One continuous English speaker saturates the Vietnamese voice engine; 15–25 % of its turns failed `engine_busy` on the dev stack.                                 |
| Phone on loudspeaker at high volume | The phone may translate the room's playback | See §4. Moderate volume or headphones.                                                                                                                            |
| One account in two places           | The first one drops out                     | The same user joining twice replaces the first socket, so give every phone and profile its own account.                                                           |

---

## 7. Reset between runs

On a host that also runs production, replace `pnpm dev:all` below with the native start
in §2.

```bash
pnpm dev:stop
pnpm dev:all
```

A fresh database:

```bash
pnpm dev:stop
docker compose down -v postgres
docker compose up -d --wait postgres
pnpm --filter api exec prisma migrate deploy
pnpm dev:all
```

---

## 8. Troubleshooting

**The API does not boot** — `CLOUDFLARE_REALTIME_APP_ID` or
`CLOUDFLARE_REALTIME_APP_SECRET` is missing from `apps/api/.env`.

**Joins, but tiles stay black** — the network blocks UDP to Cloudflare. Set both
`CLOUDFLARE_TURN_*` keys and rejoin; `chrome://webrtc-internals` shows a `relay` candidate
when TURN is in use.

**No subtitle or translated audio** — check that the STT and TTS sidecars answer
`/healthz` at `LOCAL_STT_URL` and `LOCAL_TTS_URL`, and the translation provider's key.
`too_many_turns` in the API log means the meeting legs, or the whole server, are at their
turn ceiling.

**Translation stops after an API restart** — a speaker's leg rebuilds its translate
socket three times (1, 2 and 4 s). An API that takes longer to come back (`nest start
--watch` took about 11 s) ends that speaker's translation; rejoin.

**Translation works one way only** — check each profile's lobby language (Tiếng Việt vs
English); it is fixed at join.
