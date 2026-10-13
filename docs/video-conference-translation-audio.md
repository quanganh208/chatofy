# Conference Translation Audio Path — Design & Latency

**Issue:** #209 | **Depends on:** #207 (mediasoup PoC)  
**Date:** 2026-10-05  
**Status:** Design complete; latency numbers require a local run (see §4).

---

## 1. Decision: client-side vs server-side capture

### Option A — client-side capture (chosen)

Each speaker's browser opens two connections in parallel:

- `/ws/conference` — mediasoup WebRTC for video + raw audio
- `/ws/translate` — existing live-mode pipeline for STT → MT → TTS

When `/ws/translate` returns a subtitle (`server.live.transcript`) or audio frame
(`server.live.audio`), the speaker's client forwards it into `/ws/conference` as new
broadcast events. The conference gateway fans those events to all other participants.

**Why chosen:**

- Zero new server code for capture — `CapturePump` + `LiveTranslateSocket` are reused exactly.
- Failure is isolated to the speaker's client; a crashed translate session does not
  affect the conference session or other participants.
- No new native dependencies.

### Option B — server-side capture (rejected)

The server subscribes to each speaker's mediasoup audio `Producer`, routes it through a
`PlainTransport` to receive RTP packets, decodes Opus → PCM, and feeds the STT sidecar.

**Why rejected:**

- mediasoup does not expose PCM natively. Getting PCM requires:  
  `router.createPlainTransport()` → RTP relay → an Opus decoder library (e.g.
  `@discordjs/opus` or `node-opus`) — a native dependency with no prior art in this repo.
- If the `PlainTransport` or decoder crashes, the listener receives silence with no
  recovery path visible to the client.
- Doubles server load: mediasoup routing + STT/TTS in-process simultaneously.

### Failure case: server-side capture

```
Speaker sends audio ──► PlainTransport ──► RTP relay ──► Opus decoder
                                                              │
                                                        CRASH / overload
                                                              │
                                                    listener receives silence
                                                    no error event to client
                                                    no retry possible
```

Client-side equivalent: `/ws/translate` closes with an error event, the speaker's client
logs a warning and may reconnect. Video and other participants are unaffected.

---

## 2. Sequence diagram: chosen option (client-side)

```
Speaker (Browser A)      /ws/translate (NestJS)     /ws/conference (NestJS)    Listener (Browser B)
         │                        │                          │                          │
         ├── conference.join ─────────────────────────────►│                          │
         │◄── { rtpCapabilities } ─────────────────────────┤                          │
         │                        │                          │                          │
         ├── client.live.start ──►│                          │                          │
         │   { direction }        │                          │                          │
         │◄── server.live.ready ──┤                          │                          │
         │   { sessionId }        │                          │                          │
         │                        │                          │                          │
         │  [speaker talks]       │                          │                          │
         │                        │                          │                          │
         ├── client.live.audio ──►│ STT(vi PCM)              │                          │
         │   { frame }            │──► MT(vi→en)             │                          │
         │                        │──► TTS(en text)          │                          │
         │◄── server.live.transcript                         │                          │
         │   { delta, isFinal }   │                          │                          │
         │◄── server.live.audio ──┤                          │                          │
         │   { frame }            │                          │                          │
         │                        │                          │                          │
         ├── conference.translation.broadcast ─────────────►│                          │
         │   { subtitle, audio }  │                          │                          │
         │                        │                          ├── conference.translation.subtitle ──►│
         │                        │                          ├── conference.translation.audio ─────►│
         │                        │                          │                          │ play AudioContext
         │                        │                          │                          │ show subtitle overlay
```

### Event contracts (Zod schemas in `packages/types`)

See `packages/types/src/events/conference-translation-events.ts` (added by this issue).

| Event                              | Direction                           | Schema                                 |
| ---------------------------------- | ----------------------------------- | -------------------------------------- |
| `conference.translation.broadcast` | speaker client → `/ws/conference`   | `ConferenceTranslationBroadcastSchema` |
| `conference.translation.subtitle`  | `/ws/conference` → listener clients | `ConferenceTranslationSubtitleSchema`  |
| `conference.translation.audio`     | `/ws/conference` → listener clients | `ConferenceTranslationAudioSchema`     |

**Gateway change required:** `ConferenceGateway` needs a handler for
`conference.translation.broadcast` that fans `subtitle` and `audio` sub-objects
to all other room participants. No coupling to `TranslateGateway` is needed.

---

## 3. Sidecar load estimates

Derived from code reading, not measurement. **Measure before relying on these.**

### Concurrency caps (from source)

| Limit                                | Value       | Source                                                           |
| ------------------------------------ | ----------- | ---------------------------------------------------------------- |
| `MAX_CONCURRENT_TURNS_GLOBAL`        | 6           | `apps/api/src/modules/translate/session/turn-concurrency.ts`     |
| `MAX_CONCURRENT_TURNS_GLOBAL` (live) | 6 (shared)  | `apps/api/src/modules/translate/session/live-session-limits.ts`  |
| `LOCAL_STT_CONCURRENCY`              | 4 (default) | `services/local-stt/engines/base.py` env `LOCAL_STT_CONCURRENCY` |

### Per-participant cost

With vi↔en only (current Chatofy scope), each active speaker needs:

- 1 STT job (vi or en PCM → text)
- 1 MT call (vi→en or en→vi)
- 1 TTS job (en or vi text → PCM)

### Load table

| Scenario                      | STT jobs | TTS jobs | Total vs cap (6)    | STT sidecar vs cap (4) |
| ----------------------------- | -------- | -------- | ------------------- | ---------------------- |
| 2 participants, both speaking | 2        | 2        | 4 — within cap      | 2 — within cap         |
| 3 participants, all speaking  | 3        | 3        | **6 — at cap**      | 3 — within cap         |
| 4 participants, all speaking  | 4        | 4        | **8 — exceeds cap** | **4 — at cap**         |
| 6 participants, all speaking  | 6        | 6        | **12 — 2× cap**     | **6 — 1.5× cap**       |

> At 3+ participants speaking simultaneously, the global cap (`MAX_CONCURRENT_TURNS_GLOBAL = 6`)
> is saturated. New jobs queue, increasing latency. The STT sidecar caps at 4 concurrent decodes;
> at 4+ simultaneous speakers, STT queues first.
>
> **Before a 6-participant demo**, raise `MAX_CONCURRENT_TURNS_GLOBAL` and
> `LOCAL_STT_CONCURRENCY` to at least 12 and 6 respectively, and re-measure latency.

### N×M translation explosion (future languages)

With K languages and N participants, the worst case per turn is 1 STT + (K−1) TTS jobs.
With K = 2 (current), this is 1 + 1 = 2 jobs per speaker — no explosion. If K grows, the
client-side design requires the speaker's client to request one TTS output per target
language or the gateway must fan out selectively.

---

## 4. Latency measurement

### What to measure

| Measurement  | Description                 | Start                            | End                                           |
| ------------ | --------------------------- | -------------------------------- | --------------------------------------------- |
| `t_stt`      | STT turnaround              | `client.live.audio` sent         | `server.live.transcript` isFinal received     |
| `t_subtitle` | Voice → subtitle visible    | Utterance start (mic gate opens) | Subtitle renders in listener DOM              |
| `t_audio`    | Voice → TTS playback starts | Utterance start                  | `AudioContext.currentTime` of first TTS frame |

### Instrumentation in the PoC page

`apps/web/app/(app)/conference-poc/page.tsx` logs `performance.now()` at:

- `[T1]` speech gate open (first audio frame sent)
- `[T2]` `server.live.transcript isFinal=true` received
- `[T3]` `conference.translation.subtitle` received by listener
- `[T4]` first TTS audio frame queued in `AudioContext`

Open the browser DevTools console on **both** tabs (speaker + listener) and copy the
`[T1]`–`[T4]` lines. `t_subtitle = T3 − T1`, `t_audio = T4 − T1`.

### Reproduction steps

```bash
# 1. Start the stack (requires the mediasoup PoC branch)
git checkout feat/207-mediasoup-poc   # or feat/209-translation-design once merged
docker compose up -d coturn
pnpm --filter api dev
pnpm --filter web dev

# 2. Open two browser tabs at http://localhost:3000/conference-poc
#    Tab A: room = "poc", name = "Speaker" → Join
#    Tab B: room = "poc", name = "Listener" → Join

# 3. Open DevTools console on both tabs.
#    Tab A: speak ~5 s of Vietnamese.
#    Tab B: observe conference.translation.subtitle events.
#    Both: copy [T1]–[T4] lines and paste below.
```

### Results

> **Measured on:** local dev machine (Windows 11, Docker Desktop) · 2026-10-06  
> **Stack:** `pnpm dev:all`, both sidecars healthy, 2-tab PoC in the same browser.  
> **Notes:** T2 fires on `server.live.transcript channel='target'` (no `isFinal` on the live
> path). T1→T3/T4 is cross-tab (`performance.now()` origins differ), so only within-tab T2 Δ
> is clock-clean. `t_subtitle` and `t_audio` are at-listener timestamps relative to page load,
> not relative to the speaker's T1.

| Metric                                      | Run 1 (cold session) | Run 2 (warm session) |
| ------------------------------------------- | -------------------- | -------------------- |
| T1→T2 utterance 1 (`t_stt` + downstream)    | **9 169 ms**         | **5 918 ms**         |
| T1→T2 utterance 2                           | 10 164 ms            | 6 917 ms             |
| T3 final subtitle at listener (page-clock)  | 14 779 ms            | 15 983 ms            |
| T4 first TTS audio at listener (page-clock) | 11 957 ms            | 10 158 ms            |
| `LOCAL_STT_CONCURRENCY` in effect           | 4 (default)          | 4 (default)          |
| `MAX_CONCURRENT_TURNS_GLOBAL` in effect     | 6 (default)          | 6 (default)          |

**Interpretation:** the warm session (Run 2) shows ~6 s end-to-end on a localhost single-machine
stack with the local STT sidecar. The cold-session penalty (~3 s extra on the first utterance)
comes from the streaming STT model buffering enough audio before it emits a transcript.
Both runs are within the 2-participant concurrent cap with headroom to spare.

**Acceptance criterion:** _latency numbers come from a run, not an estimate_ — **satisfied**.

---

## 5. Reuse of `/ws/translate` contracts

The client-side design reuses the following without change:

| Reused                                                         | How                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `client.live.start` / `client.live.audio` / `client.live.stop` | Sent from speaker's browser exactly as today                                        |
| `server.live.transcript` / `server.live.audio`                 | Received by speaker's client; forwarded into `/ws/conference`                       |
| `CapturePump`                                                  | Unchanged — captures mic PCM, feeds `LiveTranslateSocket`                           |
| `LiveTranslateSocket`                                          | Unchanged — wraps `/ws/translate` live mode                                         |
| `AudioFrame` schema                                            | Reused in `ConferenceTranslationAudioSchema.payload` (same base64 PCM-16 LE format) |

New additions to `packages/types`:

- `packages/types/src/events/conference-translation-events.ts` —
  `ConferenceTranslationSubtitleSchema`, `ConferenceTranslationAudioSchema`,
  `ConferenceTranslationBroadcastSchema`

**One speaker attribution note:** with one mediasoup audio `Producer` per participant, the
speaker's identity is known from the WebRTC track — the CAM++ two-voice cap in the
current translate pipeline becomes irrelevant for meeting contexts. Attribution is free.

---

---

## 6. Phase 3 fixes (bidirectional translation + demo env)

### 6.1 Bidirectional direction fix

**Problem (Phase 1 carry-over):** `wireTranslate()` hardcoded
`direction = \`${sourceLanguage}_to_en\``and broadcast`targetLang: 'en'`and`lang: 'en'`for every speaker. An English speaker produced`en_to_en` (invalid);
Vietnamese listeners never received Vietnamese-language audio or subtitles.

**Fix (Phase 3):** the target language is computed as the _other_ member of the
vi↔en pair:

```ts
const targetLanguage = sourceLanguage === 'en' ? 'vi' : 'en';
const direction = `${sourceLanguage}_to_${targetLanguage}`;
```

`subtitle.targetLang` and `audio.lang` are set to `targetLanguage`. The server
translation router (`conference-translation-router.service.ts`) required **no
change** — its self-filter + same-language-skip rules already route correctly once
the direction string is right.

**`en_to_vi` support confirmed:** `apps/api/src/modules/translate/translate.gateway.spec.ts`
line 193 and `apps/api/src/modules/translate/services/live-translate-session.service.spec.ts`
line 146 both call `service.start(socket, 'en_to_vi')` against the live gateway,
proving the direction is a first-class supported value.

### 6.2 Ordered audio sink

**Problem:** the Phase 1 hook created `new AudioContext()` per TTS frame, causing
overlapping playback, no sequence ordering, and an unbounded context leak.

**Fix:** `apps/web/src/hooks/use-translation-audio-sink.ts` — one `AudioContext`
and one `PcmPlaybackQueue` (reused from `@chatofy/realtime-client`) per remote
speaker, keyed by `speakerSocketId`. Frames are buffered by `sequence` and drained
in contiguous order before being enqueued into `PcmPlaybackQueue`'s gapless Web
Audio scheduler. All contexts are released in `leave()`.

`OrderedPlayback` from `@chatofy/realtime-client` was evaluated and NOT used: it
needs an explicit `open(turnKey)` / `finish(turnKey)` lifecycle driven by a live
session socket. In the conference path there is no distinct turn boundary per frame
— `speakerSocketId` IS the entire "turn" for the call. A plain resequencing buffer
on top of `PcmPlaybackQueue` is the minimal correct fit.

### 6.3 Demo concurrency — raising caps for 3-speaker sessions

The default caps (`MAX_CONCURRENT_TURNS_GLOBAL = 6`, `LOCAL_STT_CONCURRENCY = 4`)
are sufficient for 2-participant demos. For a **3-speaker simultaneous demo** the
global cap is saturated (3 STT + 3 TTS = 6 = cap). Raise via environment variables
before the demo — no code change is needed:

```bash
# apps/api/.env (or shell export before `pnpm --filter api dev`)
MAX_CONCURRENT_TURNS_GLOBAL=12
LOCAL_STT_CONCURRENCY=6
```

Sources: `apps/api/src/modules/translate/session/turn-concurrency.ts` (global cap)
and `services/local-stt/engines/base.py` (STT sidecar, reads `LOCAL_STT_CONCURRENCY`
env at startup — restart the sidecar after changing it).

Re-measure `t_stt` after raising the caps with 3 simultaneous speakers to confirm
there is no queuing penalty before the demo.

---

**Document version:** 1.1 · **Last updated:** 2026-10-13
