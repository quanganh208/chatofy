# Video Translation Audio Path — Design & Latency

> **Status: Proposal — not implemented.** Resolves Issue #209. Builds on the
> mediasoup PoC on `feat/207-mediasoup-poc` (Open Decision 1 in
> [video-conferencing-architecture.md](./video-conferencing-architecture.md)).
> The conference module today (`apps/api/src/modules/conference/`) does
> signaling only — no translation is wired to it (verified: grep for
> `translate`/`PlainTransport`/`decode` in that module finds only the shared
> `ws-auth` import). Everything describing translation inside a meeting is
> proposed.

**Date:** 2026-10-06
**Scope:** How a speaker's audio in a mediasoup meeting reaches the existing
translation pipeline, and how each listener gets the result in their own
language.

---

## 0. What exists today (grounding)

The translation pipeline is a **turn cascade** reachable only over
`/ws/translate` (`TranslateGateway`, `apps/api/src/modules/translate/`):

```
mic PCM16 → client.audio.frame → STT (sidecar) → MT (cloud) → TTS (sidecar) → server.audio.frame
```

Facts the rest of this document depends on, each from source:

- **Client captures mic PCM**, gates speech locally (`CapturePump`,
  `packages/realtime-client/src/audio/capture-pump.ts`), and streams only
  speech as base64 PCM16 frames. The server never sees raw mic; it sees turns.
- **STT and TTS are CPU sidecars** (`services/local-stt` :8002,
  `services/local-tts` :8003). Each STT engine serves a bounded number of
  concurrent decodes through a lane semaphore (`LOCAL_STT_CONCURRENCY`, default
  4; a request that cannot get a lane within `LOCAL_STT_LANE_WAIT_MS`=2000ms is
  refused **503**, not queued — [ai-providers.md § STT sidecar concurrency](./ai-providers.md#speech-backend-routing)).
  Sidecars lock **per engine**, so a `vi` turn and an `en` turn are genuinely
  concurrent.
- **Translation is a cloud call** (Gemini default, DeepSeek in prod) — a
  translation turn is never fully offline ([ai-providers.md](./ai-providers.md)).
- **The browser extension already translates one meeting in both directions**
  (`apps/extension/src/meeting-capture.ts`): it opens a `/ws/translate` session
  on `settings.direction` and a second on `reverseDirection(...)`, from one
  tab-captured audio source. This is a working two-party precedent for Option A.
- **mediasoup is server-side**: the Worker is a C++ child process of the API;
  rooms carry Opus (48 kHz, 2ch) + VP8/H264 codecs
  (`conference-room-registry.service.ts`). The server CAN reach a track via a
  mediasoup `PlainTransport`, which is the basis of Option B.

---

## 1. Option A vs Option B — where audio is captured

### Option A — Client-side capture (each client re-sends mic to `/ws/translate`)

Each participant's client opens its mic twice: once into the mediasoup
`sendTransport` (for the SFU, unchanged from the PoC) and once into the existing
`/ws/translate` socket. This is exactly what `meeting-capture.ts` does today,
generalized from 2 parties to N.

```
Speaker mic ──┬── mediasoup sendTransport ── SFU ── listeners (original voice)
              └── CapturePump ── /ws/translate ── STT→MT→TTS ── server.audio.frame
```

### Option B — Server-side capture (server subscribes to the mediasoup track)

The server, on each new audio producer, creates a mediasoup `PlainTransport`,
`consume`s the producer to receive its RTP, decodes Opus→PCM16 (ffmpeg or an
Opus decoder lib), chunks it into turns, and feeds the existing pipeline. No
extra client upload.

```
Speaker mic ── mediasoup producer ── SFU ──┬── listeners (original voice)
                                            └── server PlainTransport ── Opus→PCM
                                                 ── turn cut ── STT→MT→TTS
```

### Comparison

| Dimension          | Option A (client capture)                                                                                                | Option B (server capture)                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Complexity**     | **Low.** Reuses `CapturePump` + `/ws/translate` verbatim; the extension proves the N-session pattern. No new media code. | **High.** New: `PlainTransport` per producer, Opus decode, **server-side turn segmentation** (`CapturePump` runs in the browser on the Web Audio clock — porting VAD/endpointing server-side is net-new and is where the project says its defects have lived, `capture-pump.ts` header). |
| **Latency**        | Client already has clean mic PCM; no decode. One WS hop to API.                                                          | Adds encode→SFU→decode **before** STT (≈ one Opus round trip + jitter buffer, est. +80–150 ms, see §6).                                                                                                                                                                                  |
| **Bandwidth**      | Speaker uploads audio **twice** (SFU + WS). Mic Opus ~24–32 kbps; WS PCM16 @16 kHz ~256 kbps **per speaking client**.    | Speaker uploads **once**. Server pulls RTP locally (loopback-ish, no client cost). Lowest client bandwidth.                                                                                                                                                                              |
| **Sidecar load**   | Identical STT/TTS job count either way (§3) — capture location does not change how many turns exist.                     | Identical, plus server CPU for N Opus decodes.                                                                                                                                                                                                                                           |
| **Who cuts turns** | Browser VAD (shipped, tuned, tested).                                                                                    | Server VAD (greenfield).                                                                                                                                                                                                                                                                 |
| **Mobile/Expo**    | Same `realtime-client` path the mobile app would use anyway.                                                             | Client untouched for translation — but mobile still needs the SFU track.                                                                                                                                                                                                                 |
| **Degradation**    | A client can drop its WS session without affecting the SFU media.                                                        | Server failure drops translation for everyone in the room.                                                                                                                                                                                                                               |

**On bandwidth**, note A's double-upload only costs while a participant is
_speaking_ (CapturePump gates silence), and PCM16 could be Opus-encoded on the
WS leg to close most of the gap — but that re-introduces a decode server-side,
eroding A's main advantage. The honest read: A costs more uplink per speaking
client; B costs more server CPU and a large net-new segmentation module.

---

## 2. Listener delivery — how a listener receives the translation

Two independent channels, matching how `/ws/translate` already splits them:

### Subtitles (text)

Emit a per-room broadcast event carrying the finished translation, keyed by
speaker and **by target language**:

```
server.subtitle.live { speaker, sourceText, translations: {en:"…", vi:"…"}, ts }
```

Each listener's client renders `translations[myLanguage]`. **Deliver over the
existing conference WebSocket**, not a mediasoup data channel: the signaling
socket already exists per peer, the payload is tiny, and the room-broadcast
helper is already written (`ConferenceGateway.broadcast`). A data channel buys
nothing here and adds SCTP setup.

### TTS audio

The expensive question is **avoiding one TTS stream per listener-language
pair**. The design rule: **synthesize once per (speaker, target-language), fan
out that one stream to every listener who wants that language.**

- A turn is translated into the **set of distinct languages present in the
  room** (`plan.targets`), not per listener. `translateAll` already fans out
  over `plan.targets` with `Promise.all`
  (`pipeline-translator.service.ts:568`).
- Each target language is **synthesized once** (one TTS job), producing one PCM
  stream.
- That stream is injected back into mediasoup as a **new audio producer** via a
  `PlainTransport` (server → RTP → SFU), tagged with its language in `appData`.
  Listeners `consume` only the producer matching their language. The SFU
  forwards one stream to K subscribers — the same selective-forwarding model
  the PoC already uses for voice.

So for N participants and K languages, the room carries at most **K translated
audio producers**, regardless of listener count — not N×(N−1) streams.

Fallback when server-side RTP injection is not built yet: send TTS as
`server.audio.frame` over the per-listener WebSocket (today's path). This is
correct but does **not** deduplicate — it sends the same language stream once
per listener. Acceptable for a thesis demo of 2–4; the producer-injection model
is the scale answer.

---

## 3. Scale — STT and TTS job count

Let **N** = participants, **K** = distinct languages in the room, and assume at
most one person speaks at a time (meetings mostly hold this).

| Stage   | Jobs per active speaker-turn | Notes                                                                                             |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| **STT** | **1**                        | One recognition of the speaker's own language. Independent of N and K.                            |
| **MT**  | **K−1**                      | Translate into every _other_ language present. `translateAll` fan-out. Cloud — not sidecar-bound. |
| **TTS** | **K−1**                      | One synthesis per target language (§2), **not** per listener. Sidecar-bound.                      |

**The binding constraint is the STT/TTS sidecar, at real-time factor ≈ 1×.**
Each STT engine serves `LOCAL_STT_CONCURRENCY` (default 4) concurrent decodes
per language before refusing 503
([ai-providers.md](./ai-providers.md#speech-backend-routing)). TTS locks **per
engine for the whole turn** ([data-flow.md § Streaming Turn](./data-flow.md) —
a second `vi` turn waits up to 15 s, then 503 `engine_busy`).

**Worst case — simultaneous speakers.** If M people speak at once in distinct
languages, STT load is M concurrent decodes (fine up to 4 per engine) but TTS is
M×(K−1) syntheses competing for per-engine locks. With a single `vi` TTS engine
and two `vi` turns needing synthesis, the second waits ≤15 s or fails
`engine_busy`.

**The limit, stated plainly:** at RTF 1× and per-engine TTS locking, the room
is comfortable at **K=2 languages and 1–2 concurrent speakers**. Beyond that,
TTS is the bottleneck — concurrent same-language turns serialize on the engine
lock. This matches Open Decision 4's unmeasured-capacity flag; it has **not**
been measured on this project's hardware (§7).

Mitigations (all proposed): cap room language count; prioritize the active
speaker and drop translation for interrupted overlap; run more TTS engine
instances behind the sidecar; accept subtitles-only above a threshold.

---

## 4. Echo / ducking — the original voice while translation plays

**What the extension does today**, and the mechanism is directly reusable:

- **Ducking** (`apps/extension/src/duck-controller.ts`): while a translation is
  playing, the original audio is dropped to `DUCKED_GAIN = 0.2` (audible, not
  muted) via a `GainNode`, with a 40 ms ramp (no click) and a 250 ms release
  delay (so a gap between clauses of one turn does not swell the original back
  up). It follows `OrderedPlayback.isBusy` — turns _queued or playing_, not
  "a sample is sounding right now" — because a growing backlog means something
  is always about to sound.
- **Echo measurement** (`echo-monitor.ts`, and `CapturePump`'s `echoGate`): the
  mic is watched during playback to count how much of our own audio returns.
- **Half-duplex mute**: on a shared device, the mic is ignored entirely while
  our translation plays (`CapturePump.isMuted`), preventing the loudspeaker from
  triggering a self-translation loop.

**In a conference the problem is milder than a shared phone**: each participant
is on their own device with their own headset/speaker, so acoustic echo between
_my_ translation playback and _my_ mic is the normal WebRTC echo case —
`getUserMedia({ echoCancellation: true })` + mediasoup's built-in handling
covers it. The real UX question is **talker overlap**: the original speaker's
voice (forwarded by the SFU) still plays while the translated voice plays on
top.

**Recommended behavior:** duck the **original speaker's forwarded track** to
~0.2 for listeners who have TTS enabled, using the same `DuckController` applied
to the consumed remote track's gain node, keyed on whether a translated producer
for that speaker is currently sounding. Listeners who prefer original audio
(subtitles-only) duck nothing. This reuses the shipped controller unchanged; the
only new wiring is driving `setBusy` from the translated-producer playback state
instead of `OrderedPlayback.isBusy`.

---

## 5. Gemini Live — does live mode fit a meeting?

**Live mode today** (`GeminiLiveTranslateProvider`, the `realtime` kind behind
`translateMode: 'live'`) is one upstream speech-to-speech session per
`/ws/translate` connection: `client.live.audio` in, `server.live.audio` out,
continuous, no turn cascade ([data-flow.md § Live mode](./data-flow.md#live-mode-on-the-same-socket)).

**Does it fit a meeting?** Partially, and only under Option A:

- **It fits per-direction, client-side.** A client could open one Gemini Live
  session per target language from its own clean mic PCM, exactly as it opens
  cascade sessions today. mediasoup's server-side track access is **irrelevant**
  to live mode as currently built, because live mode consumes client PCM over
  the WebSocket, not RTP from the SFU. So "mediasoup does server-side track
  access" does not enable live mode — live mode never looks at the SFU track.
- **It does not fit the fan-out requirement cleanly.** Live mode is one
  bidirectional stream; the K-languages-once-each dedup in §2 assumes a
  turn-shaped result (one finished translation per language, fanned out). A
  continuous speech-to-speech stream is per-session, so N speakers × (K−1)
  targets = N×(K−1) concurrent live sessions, each a metered cloud stream. That
  is the cost explosion §2 exists to avoid, moved to the cloud bill.
- **Cost/quota:** every live session is a sustained upstream connection on
  metered quota, versus the cascade's per-turn requests. For a multi-party room
  this multiplies fast.

**Verdict on Gemini Live:** viable as a **1:1 or demo** path (low latency,
speech-to-speech), **not** the multi-party room engine. It is orthogonal to the
Option A/B choice because it bypasses the SFU track entirely.

---

## 6. Latency estimates

Per-hop numbers come from the project's own measurements where they exist;
everything else is labelled **estimated**.

### Measured hops (from the shipped cascade)

| Hop                                           | Value                                     | Source                                                                   |
| --------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| Speculative first-audio (guess survives)      | **p50 870 ms** endpoint→first audio       | [data-flow.md](./data-flow.md) (32 synthesized vi turns; 19/32 survived) |
| First-audio (guess lost)                      | **p50 1760 ms**                           | same                                                                     |
| Translation→first-audio (streamed TTS)        | **231 ms** median (was 586 ms pre-stream) | [data-flow.md](./data-flow.md), 15 en→vi turns                           |
| STT whole-turn                                | **p50 58 ms, max 136 ms**                 | [data-flow.md](./data-flow.md), 422 transcriptions                       |
| MT (Gemini flash)                             | **0.7–1.1 s** per sentence                | [ai-providers.md](./ai-providers.md)                                     |
| Display restore (parallel, off critical path) | p95 ~110 ms                               | `pipeline-translator.service.ts:160`                                     |
| Live-preview first words                      | ~630 ms after speech start                | [data-flow.md](./data-flow.md)                                           |

The dominant term is **MT (~0.7–1.1 s)**. STT is cheap; streamed TTS first-audio
is ~230 ms. The speculative-endpoint trick is what gets first audio to ~870 ms
despite a ~1 s translation.

### Option A — client capture

```
mic → CapturePump (local, ~0) → WS to API (~RTT/2) → STT 58ms → MT 700–1100ms
    → TTS first-audio 231ms → server.audio.frame → listener playback
```

**Estimated endpoint→first-audio ≈ 870 ms–1.8 s**, i.e. **the same as the
shipped cascade** — Option A _is_ the shipped cascade, run per participant. The
only addition over 1:1 is the listener-delivery hop (WS event or SFU producer),
estimated **+20–50 ms** for a room broadcast.

### Option B — server capture

Same pipeline, with extra hops **before** STT:

```
mic → WebRTC Opus encode (est. 20–40ms + 20ms frame) → SFU forward (est. 5–30ms LAN)
    → server PlainTransport recv + jitter buffer (est. 20–60ms) → Opus decode (est. 5–15ms)
    → server turn segmentation (est. 0, overlaps) → [then identical: STT→MT→TTS]
```

**Estimated added latency vs Option A: +80–150 ms** before the first STT call,
plus the loss of the client-side speculative endpoint (server-side VAD would
have to re-implement `client.turn.speculate` to recover the ~890 ms saving — if
it does not, Option B pays the **1760 ms** "guess lost" path, not 870 ms).

**Net estimate:**

|          | Endpoint → first translated audio (est.)                                            |
| -------- | ----------------------------------------------------------------------------------- |
| Option A | **~870 ms** (speculation intact)                                                    |
| Option B | **~950 ms–1.1 s** (if speculation re-implemented server-side) / **~1.9 s** (if not) |

All Option B figures are **estimated** — no server-side capture path exists to
measure.

---

## 7. Recommendation

**Adopt Option A (client-side capture).** Ranked rationale:

1. **It is already built and tuned.** `meeting-capture.ts` runs the exact
   pattern — one client, N `/ws/translate` sessions, ducking, echo monitoring —
   for 2 parties today. Generalizing to N participants and K languages is
   configuration and fan-out, not new media infrastructure. Option B is a
   greenfield server-side VAD + Opus-decode + turn-segmentation module, in the
   layer the codebase explicitly says its defects live in
   (`capture-pump.ts` header).
2. **Lower latency.** A keeps the client-side speculative endpoint (~870 ms
   first audio); B adds 80–150 ms of transport and risks losing speculation
   entirely (→1.76 s) unless that logic is re-ported server-side.
3. **Better failure isolation.** A client dropping its translation WS does not
   touch SFU media; a server-capture failure removes translation for the whole
   room.
4. **KISS/DRY.** A reuses `CapturePump`, `DuckController`, `/ws/translate`,
   `translateAll`, and `streamed-speech-delivery` unchanged.

**The cost A pays** is uplink bandwidth (each speaking client uploads audio to
both the SFU and the WS). For a thesis-scale room (2–6) on the target VM this is
acceptable; if it ever bites, Opus-encode the WS leg before reaching for B.

**Listener delivery:** subtitles over the conference WebSocket; TTS synthesized
once per (speaker, language) and fanned out as one mediasoup producer per
language (§2). Build the per-listener WebSocket-frame fallback first for the
demo, then the producer-injection dedup for scale.

**Gemini Live:** keep as a separate 1:1/demo path; do not use it as the
multi-party room engine (§5).

---

## Unresolved questions

1. **Sidecar capacity is unmeasured (Open Decision 4).** The K=2 / 1–2
   concurrent-speaker limit in §3 is derived from `LOCAL_STT_CONCURRENCY` and
   per-engine TTS locking, **not** measured on this project's hardware. A load
   test (Phase 3/7) is needed before committing a participant ceiling.
2. **Server-side RTP injection of TTS** into mediasoup (producer-per-language,
   §2) is unproven on this stack — the PoC only forwards client-produced tracks.
   The WebSocket-frame fallback is the safe interim.
3. **Speaker language per participant**: §3 assumes each participant has one
   known source language (from `ConferenceParticipant.sourceLanguage`, proposed
   schema). Code-switching within one speaker is out of scope here.
4. **TTS voice per translated producer**: should a listener hear a consistent
   voice per remote speaker, or one voice per language? Affects whether TTS
   fan-out is per-(speaker,language) or per-language only.
