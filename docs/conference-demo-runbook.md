# Conference Feature — Demo Runbook

**Target:** thesis demo on one machine (loopback, one browser with several profiles,
optionally an Android dev build on the same LAN)
**Last revised:** 2026-10-25

Conferencing is on `main` behind flags that are off by default. Everything below is a
local run. Meeting media goes through Cloudflare Realtime SFU even locally, so the machine
needs internet access and a Cloudflare Realtime app (Decision 7 in
[video-conferencing-architecture.md](./video-conferencing-architecture.md)). The production
switch is in [deployment-guide.md → Video conferencing](./deployment-guide.md#video-conferencing-disabled-by-default).

---

## 1. Prerequisites

### Environment files

`apps/api/.env`, at minimum:

```bash
# Required — the API refuses to start without it (openssl rand -base64 32)
AUTH_JWT_SECRET=<32-byte base-64 string>

# Required: a meeting translates through the live mode of /ws/translate, which is Gemini Live.
GEMINI_API_KEY=<your key>

# Off by default. Without it there is no /ws/conference and no /conference.
CONFERENCE_ENABLED=true

# Required with CONFERENCE_ENABLED: Cloudflare dashboard > Realtime > Serverless SFU.
# The API refuses to boot without both. Never paste the secret into chat or a log.
CLOUDFLARE_REALTIME_APP_ID=<app id>
CLOUDFLARE_REALTIME_APP_SECRET=<app secret>

# Optional: Realtime > TURN Server. Only needed on a network that blocks UDP.
CLOUDFLARE_TURN_KEY_ID=
CLOUDFLARE_TURN_KEY_API_TOKEN=
```

Chat messages are translated per recipient through the configured translation provider
(`AI_TRANSLATION_PROVIDER`, Gemini by default), so that provider's key must be set too.

`apps/web/.env.local`:

```bash
AUTH_SECRET=<32-byte base-64 string>   # openssl rand -base64 32
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
# Build-time: restart `next dev` after changing it. 'false' (default) hides the
# Conference nav entry and makes every /conference route a 404.
NEXT_PUBLIC_CONFERENCE_ENABLED=true
```

### Accounts

One registered account per browser profile (2–3). Register at
`http://localhost:3001/register`; with `SMTP_*` unset the verification link is printed to
the API console.

---

## 2. Start sequence

```bash
# Postgres, Redis, the speech sidecars, then the API (3000) and web (3001).
pnpm dev:all
```

A meeting itself does not use the speech sidecars (live mode is speech-to-speech in the
cloud). On a machine whose Docker VM also runs production, do not start the dev sidecars:
they compete with production for the same memory.

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
   and hears English. The subtitle is cumulative: it grows while A speaks and settles
   about 1.5 s after the last translated word.
4. **B** answers in English; **A** sees and hears Vietnamese.

Point out: each participant picks their own language; subtitles reach only listeners of
the other language, and translated speech reaches only listeners of its language.

### Controls, chat, leave, end

5. Mic and camera buttons: the other side's roster shows muted; the tile darkens.
6. Chat: a message arrives translated into each recipient's language.
7. **Leave** returns to the lobby; the other side drops the tile.
8. Ending the room as its creator (`DELETE /conference/:id`) closes every peer's call with
   the room-ended state. It does not reconnect.

### Smoke checklist

Run once on a real stack before trusting the demo; none of this is visible to unit tests.

- [ ] The **Conference** sidebar entry exists only with `NEXT_PUBLIC_CONFERENCE_ENABLED=true`.
- [ ] Create a room → the call opens; Join with the copied id from a second profile works.
- [ ] Joining a made-up id shows room not found, without retrying.
- [ ] vi → en and en → vi both show a subtitle and play translated audio.
- [ ] If audio is silent on first join, a **tap to enable sound** control appears and works.
- [ ] A **translating…** badge shows on your own tile while you speak and clears when the
      turn settles.
- [ ] Stop the API briefly mid-call: the UI shows **Reconnecting (n/3)…** and recovers.
      Stopped for longer than three attempts, it ends with a disconnected state.
- [ ] The same account joining from a second tab replaces the first; the first tab leaves
      the call and does not reconnect.

---

## 4. Mobile (Android dev build only)

The conference entry, lobby and call screen exist only in development builds (`__DEV__`).
Mobile has no real sign-in for conferences yet, so a dev build logs in with a bench
account from `EXPO_PUBLIC_BENCH_EMAIL` / `EXPO_PUBLIC_BENCH_PASSWORD`; a release build
ignores them and has no conference screens. Never set those variables for a build you hand
to anyone.

`apps/mobile/.env`:

```bash
# The API port (3000), not web's. Emulator default is http://10.0.2.2:3000;
# a real device needs this machine's LAN IP.
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.50:3000
EXPO_PUBLIC_BENCH_EMAIL=bench@dev.local
EXPO_PUBLIC_BENCH_PASSWORD=<the bench account's password>
```

Create the bench account with `node apps/api/scripts/create-bench-user.cjs`. The phone
needs to reach the API for signaling only; its media goes to Cloudflare like the browser's.

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
14 phone on 2026-10-12. Check the same list as §3, plus that Leave turns the camera light
off. The language is picked in the lobby; it is read-only during the call.

| Symptom                                  | Cause                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| No WebSocket connection                  | `EXPO_PUBLIC_API_BASE_URL` on the wrong port or host                                         |
| Not authenticated                        | Bench variables missing, or the account does not exist                                       |
| Native module error                      | Running in Expo Go instead of a dev client                                                   |
| Joins but no media                       | The network blocks UDP: set the two `CLOUDFLARE_TURN_*` keys so the join hands out TURN      |
| Call audio drops when translation starts | Mic contention between `react-native-webrtc` and the translation recorder; confirm by muting |

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

| Risk                                     | Impact                         | Note                                                                                                                    |
| ---------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Local API, one LAN                       | A remote guest cannot join     | Media crosses Cloudflare, but signaling needs the API; a guest elsewhere needs the production site with both flags on.  |
| At most six translating participants     | A seventh gets no translation  | The API allows six live translation sessions server-wide, `/translate` users included. A code constant, not an env var. |
| ~6 s warm translation latency            | The audience notices the delay | Measured on a 2-tab local run. Use short turns with pauses; the subtitle arrives before the audio.                      |
| Cold first utterance (~9 s)              | First translation is slow      | Warm each profile up with one throwaway sentence before the demo.                                                       |
| Mobile is a dev build with a bench login | Two phones share one account   | The same user joining twice replaces the first socket, so use one phone plus browser profiles.                          |

---

## 7. Reset between runs

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

**`/conference` is a 404 or the nav entry is missing** — `NEXT_PUBLIC_CONFERENCE_ENABLED`
is not `true`, or `next dev` was not restarted after setting it.

**The call never connects** — `CONFERENCE_ENABLED` is not `true` in `apps/api/.env`, so
`/ws/conference` does not exist.

**The API does not boot** — `CONFERENCE_ENABLED=true` without both
`CLOUDFLARE_REALTIME_APP_ID` and `CLOUDFLARE_REALTIME_APP_SECRET`.

**Joins, but tiles stay black** — the network blocks UDP to Cloudflare. Set both
`CLOUDFLARE_TURN_*` keys and rejoin; `chrome://webrtc-internals` shows a `relay` candidate
when TURN is in use.

**No subtitle or translated audio** — check `GEMINI_API_KEY`. A live session refused with
`too_many_sessions` means six are already open server-wide.

**Translation works one way only** — check each profile's lobby language (Tiếng Việt vs
English); it is fixed at join.
