# Conference Feature — Demo Runbook

**Branch:** `video-conferencing`  
**Target:** thesis demo on one host / loopback (single machine, same browser, multiple profiles)  
**Last verified:** 2026-10-13

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

---

## 4. Edge-case states (what to expect, not errors)

| Situation                                | What the UI shows                                                    |
| ---------------------------------------- | -------------------------------------------------------------------- |
| Browser blocks camera AND mic            | "Camera and microphone access is required" + Back to lobby button    |
| Browser blocks only camera (mic granted) | Joins audio-only; soft banner: "No camera — joining with audio only" |
| WS disconnected mid-call (killed API)    | "Connection lost. The call ended." + Back to lobby button            |
| Opened before signing in                 | Browser redirected to `/login` automatically                         |

---

## 5. Known demo risks (stated plainly)

| Risk                                          | Impact                                         | Note                                                                                                                                                                |
| --------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One-host / loopback only**                  | A remote guest cannot join                     | Cross-network media (TURN/STUN, UDP 40000–49999) is **untested** (Issue #208). Demo on the same machine.                                                            |
| **Mobile untested on real device**            | —                                              | Mobile real-device test is pending (Issue #210). Demo on web browser only.                                                                                          |
| **Multi-speaker concurrent translation load** | Translation queues at 3+ simultaneous speakers | `MAX_CONCURRENT_TURNS_GLOBAL` default (6) saturates at 3 speakers × 2 jobs each. Raise to 12 per §1 above. Not formally load-tested with all caps raised.           |
| **~6 s warm translation latency**             | Audience may notice the delay                  | Measured: ~6 s warm (T1→T2 on a local stack). Script speakers to use short turns and pause between them. Lead with the subtitle — it appears before the audio.      |
| **Cold-session first-utterance penalty**      | First translation takes ~9 s                   | The STT model buffers ~2–3 s of audio before emitting a transcript on a cold session. Warm up each profile by speaking one throwaway sentence before the live demo. |

---

## 6. Reset between runs

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

## 7. Troubleshooting

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
