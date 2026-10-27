# Video Translation Audio Path — Design & Latency

> **Status: Option A is built and always loaded** (see
> [deployment-guide.md → Video conferencing](../deployment-guide.md#video-conferencing)).
> Each speaker's client runs the same turn cascade the /translate page runs, over
> `/ws/translate`, and relays the result into `/ws/conference`, which narrows it per
> listener (§2). An earlier build ran meetings on the live (Gemini Live) mode instead; that
> path is gone from every client and production refuses it (§6). §3's per-language producer
> injection and §5's ducking are still proposals. The design was written while mediasoup
> was the SFU; Cloudflare Realtime SFU replaced it on 2026-10-25, which changes nothing in
> Option A and removes the server-side track access Options B and §3 relied on (§0).

**Date:** 2026-10-06 (design), 2026-10-27 (as-built section and measurements)
**Scope:** How a speaker's audio in a meeting reaches the existing
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
- **Translation is a cloud call** (`AI_TRANSLATION_PROVIDER`, DeepSeek by default) — a
  translation turn is never fully offline ([ai-providers.md](./ai-providers.md)).
- **The browser extension already translates one meeting in both directions**
  (`apps/extension/src/meeting-capture.ts`): it opens a `/ws/translate` session
  on `settings.languagePair` and a second on `reversePair(...)`, from one
  tab-captured audio source. This is a working two-party precedent for Option A.
- **The SFU is Cloudflare's, not the API's.** The API drives Cloudflare Realtime SFU over
  HTTPS and never sees RTP. At design time the SFU was mediasoup inside the API (replaced
  2026-10-25), whose `PlainTransport` let the server reach a track: the basis of Option B
  and of §3's producer injection. Cloudflare's server-side track access is its WebSocket
  adapter, which needs a publicly reachable endpoint
  ([changelog](https://developers.cloudflare.com/realtime/sfu/platform/changelog/)), and
  this host has none ([video-network-path.md](./video-network-path.md)).

---

## 1. Option A vs Option B — where audio is captured

### Option A — Client-side capture (each client re-sends mic to `/ws/translate`)

Each participant's client opens its mic twice: once into its SFU publish
connection (for the room) and once into the existing
`/ws/translate` socket. This is exactly what `meeting-capture.ts` does today,
generalized from 2 parties to N.

```
Speaker mic ──┬── SFU publish session ────── SFU ── listeners (original voice)
              └── CapturePump ── /ws/translate ── STT→MT→TTS ── server.audio.frame
```

### Option B — Server-side capture (rejected; designed on the replaced mediasoup SFU)

The server, on each new audio producer, creates a mediasoup `PlainTransport`,
`consume`s the producer to receive its RTP, decodes Opus→PCM16 (ffmpeg or an
Opus decoder lib), chunks it into turns, and feeds the existing pipeline. No
extra client upload.

```
Speaker mic ── SFU producer ──────── SFU ──┬── listeners (original voice)
                                            └── server PlainTransport ── Opus→PCM
                                                 ── turn cut ── STT→MT→TTS
```

### Comparison

| Dimension          | Option A (client capture)                                                                                                | Option B (server capture)                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Complexity**     | **Low.** Reuses `CapturePump` + `/ws/translate` verbatim; the extension proves the N-session pattern. No new media code. | **High.** New: `PlainTransport` per producer, Opus decode, **server-side turn segmentation** (`CapturePump` runs in the browser on the Web Audio clock — porting VAD/endpointing server-side is net-new and is where the project says its defects have lived, `capture-pump.ts` header). |
| **Latency**        | Client already has clean mic PCM; no decode. One WS hop to API.                                                          | Adds encode→SFU→decode **before** STT (≈ one Opus round trip + jitter buffer, est. +80–150 ms, see §7).                                                                                                                                                                                  |
| **Bandwidth**      | Speaker uploads audio **twice** (SFU + WS). Mic Opus ~24–32 kbps; WS PCM16 @16 kHz ~256 kbps **per speaking client**.    | Speaker uploads **once**. Server pulls RTP locally (loopback-ish, no client cost). Lowest client bandwidth.                                                                                                                                                                              |
| **Sidecar load**   | Identical STT/TTS job count either way (§4) — capture location does not change how many turns exist.                     | Identical, plus server CPU for N Opus decodes.                                                                                                                                                                                                                                           |
| **Who cuts turns** | Browser VAD (shipped, tuned, tested).                                                                                    | Server VAD (greenfield).                                                                                                                                                                                                                                                                 |
| **Mobile/Expo**    | Same `realtime-client` path the mobile app would use anyway.                                                             | Client untouched for translation — but mobile still needs the SFU track.                                                                                                                                                                                                                 |
| **Degradation**    | A client can drop its WS session without affecting the SFU media.                                                        | Server failure drops translation for everyone in the room.                                                                                                                                                                                                                               |

**On bandwidth**, note A's double-upload only costs while a participant is
_speaking_ (CapturePump gates silence), and PCM16 could be Opus-encoded on the
WS leg to close most of the gap — but that re-introduces a decode server-side,
eroding A's main advantage. The honest read: A costs more uplink per speaking
client; B costs more server CPU and a large net-new segmentation module.

---

## 2. As built — Option A over the cascade

Each speaker's client runs a **speaker leg**: the `ConversationSession` the /translate page
runs, over the same `/ws/translate`, with its output relayed into the room instead of
played locally. The leg is written once,
`packages/realtime-client/src/conference/conference-cascade-leg.ts`; web
(`apps/web/src/conference/conference-cascade-leg-web.ts`) and mobile
(`apps/mobile/src/conference/conference-cascade-leg-native.ts`) only hand it their capture
and sockets. Both read one tuning object, `CASCADE_RUNTIME_OPTIONS`
(`packages/realtime-client/src/conversation/cascade-runtime-options.ts`).

```
mic ─(web: cloned track | mobile: recorder → pushed PCM)─▶ ConversationSession
  ─ client.session.start {languagePair, alsoTranslateInto?, meeting: true} ─▶ /ws/translate
       STT → MT into every target → TTS per voiced language
  ◀─ transcript/translation deltas · server.audio.frame {lang?} · server.transcript.final
leg ─▶ conference.translation.broadcast {subtitle?, audio?} ─▶ /ws/conference
  ─▶ ConferenceTranslationRouter ─▶ each listener: its own language only
  final subtitle ─▶ one ConferenceTurn row
```

Why each part is shaped the way it is (the code owns the details):

- **Targets come from the room.** The first other language present is the turn's
  primary target; the rest go in `alsoTranslateInto`, so one turn slot carries every
  language instead of one turn per language (`roomTargets` in
  `packages/types/src/domain/languages.ts`). A peer who joins mid-call is in the next
  turn, not the one already running. With nobody else in the room the leg asks for text
  only.
- **The server closes turns.** `turnId` is the server's session id, and the only
  `isFinal: true` frame is the one built from `server.transcript.final`, carrying the
  server's text (`cascade-subtitle-relay.ts`). Stop, abandon or socket loss emit no
  final; `leave()` waits up to 3 s for an in-flight turn's real final.
- **One subtitle frame, narrowed per listener.** The frame carries the primary
  translation and, for several targets, a `translations` map. The router
  (`apps/api/src/modules/conference/services/conference-translation-router.service.ts`)
  sends each listener the frame narrowed to their language and never forwards the map,
  so listener parsing did not change; a language with no entry yet shows the source
  text. Audio still goes only to peers whose `sourceLanguage` equals its `lang`.
- **Audio language and order.** The leg tags each relayed frame with the server's
  `lang`, or the turn's primary when the server sent none, and numbers each language's
  frames itself (`leg-sequence-counter.ts`), so a sequence never resets across turns or
  restarts. Untagged audio of an unknown turn is dropped rather than guessed.
- **What is stored.** One row per final, with translations filtered to languages someone
  else in the room speaks (`conference-translation-relay.service.ts`). Minutes read only
  `sourceText`.
- **Restarts.** A dropped translate socket is rebuilt up to 3 times (1/2/4 s), with a
  fresh token each time, and never after a 1008 or 4xxx close
  (`conference-leg-restart-policy.ts`). Muting pauses the leg, so a muted speaker holds
  no turn.
- **Relay limits** are sized for a cascade burst: the relay sends faster than real time,
  so a three-language speaker with every turn in flight can burst about 3 M characters.
  The arithmetic is in the comment above `RELAY_CHAR_BURST`.

**Superseded: the live-mode build.** Until the cascade leg, meetings ran on the live mode
(`client.live.start` over `gemini-live`, vi↔en only). The live stream has no utterance
boundary, so the client closed its own turns after 1500 ms with no delta and minted its
own `turnId`, and meetings ran on a second, metered engine beside the cascade /translate
uses, with no Chinese. The client code for it is deleted (web `conference-translate-wiring.ts`,
mobile `translate-bridge-native.ts`, the realtime-client live session and socket).

### The failure case Option B would have had

```
Speaker audio ──► PlainTransport ──► RTP relay ──► Opus decoder
                                                        │
                                              crash / overload
                                                        │
                                    every listener in the room gets silence,
                                    with no error event and no client retry
```

Under Option A the same fault is one speaker's `/ws/translate` closing: that
speaker's client sees the error and the media of the call is untouched.

---

## 3. Listener delivery at scale (proposed, not built)

What shipped is this section's fallback: one translation per (speaker, language) with
the `translations` map on the subtitle, delivered per listener over the conference
WebSocket (§2). The SFU producer per language below is still a proposal.

Two independent channels, matching how `/ws/translate` already splits them:

### Subtitles (text)

Emit a per-room broadcast event carrying the finished translation, keyed by
speaker and **by target language**:

```
server.subtitle.live { speaker, sourceText, translations: {en:"…", vi:"…"}, ts }
```

Each listener's client renders `translations[myLanguage]`. **Deliver over the
existing conference WebSocket**, not a WebRTC data channel: the signaling
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
- That stream is injected back into the SFU as a **new audio producer** (designed as a
  mediasoup `PlainTransport`, server → RTP → SFU, before that SFU was replaced; on
  Cloudflare it would need the WebSocket adapter, §0), tagged with its language.
  Listeners `consume` only the producer matching their language. The SFU
  forwards one stream to K subscribers — the same selective-forwarding model
  the PoC already uses for voice.

So for N participants and K languages, the room carries at most **K translated
audio producers**, regardless of listener count — not N×(N−1) streams.

Fallback when server-side RTP injection is not built yet: send TTS as
`conference.translation.audio` over each listener's conference WebSocket (today's path). This is
correct but does **not** deduplicate — it sends the same language stream once
per listener. Acceptable for a thesis demo of 2–4; the producer-injection model
is the scale answer.

---

## 4. Scale — STT and TTS job count

Let **N** = participants, **K** = distinct languages in the room, and assume at
most one person speaks at a time (meetings mostly hold this).

| Stage   | Jobs per active speaker-turn | Notes                                                                                             |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| **STT** | **1**                        | One recognition of the speaker's own language. Independent of N and K.                            |
| **MT**  | **K−1**                      | Translate into every _other_ language present. `translateAll` fan-out. Cloud — not sidecar-bound. |
| **TTS** | **K−1**                      | One synthesis per target language (§3), **not** per listener. Sidecar-bound.                      |

**The binding constraint is the STT/TTS sidecar, at real-time factor ≈ 1×.**
Each STT engine serves `LOCAL_STT_CONCURRENCY` (default 4) concurrent decodes
per language before refusing 503
([ai-providers.md](./ai-providers.md#speech-backend-routing)). TTS locks **per
engine**: VieNeu (vi) for a whole streamed turn, Kokoro (en and zh, one shared lock) per
clause ([data-flow.md § Streaming Turn](./data-flow.md) — a waiter gives up after 15 s
with 503 `engine_busy`).

**Worst case — simultaneous speakers.** If M people speak at once in distinct
languages, STT load is M concurrent decodes (fine up to 4 per engine) but TTS is
M×(K−1) syntheses competing for per-engine locks. With a single `vi` TTS engine
and two `vi` turns needing synthesis, the second waits ≤15 s or fails
`engine_busy`.

**The design-time estimate** was that a room is comfortable at K=2 and 1–2 concurrent
speakers, with TTS the bottleneck. The measurements below replace it.

### The ceilings that bind the build

All in `apps/api/src/modules/translate/session/turn-concurrency.ts`, as code constants
rather than env vars (each carries its reasoning):

| Ceiling                  | Value                  | Why                                                                          |
| ------------------------ | ---------------------- | ---------------------------------------------------------------------------- |
| per socket               | 3                      | one continuous speaker's working depth                                       |
| per user, across sockets | 3                      | a meeting leg plus a /translate tab, or two meetings, cannot pin the process |
| meeting legs together    | 4, inside the global 6 | two continuous meeting speakers otherwise hold all 6                         |
| global                   | 6                      | two full-rate speakers on the shared sidecars                                |

A leg says it is one with `meeting: true` on `client.session.start`; a start without the
field lands in the shared pool. A turn holds its slot until its slowest language is
delivered.

### Measured capacity (dev stack, 2026-10-26 and 2026-10-27)

Fake-audio Playwright peers, 180 s of continuous speech per run, against native STT and
TTS sidecars outside the Docker VM with production idle; TTS lock holds were logged by an
instrumented launcher. Ranges are across repetitions. "Extra" is the zh voice a speaker
adds when a zh listener is present.

| Measure                                          | One speaker (vi→en, + zh extra)         | Two continuous speakers, vi/en/zh room |
| ------------------------------------------------ | --------------------------------------- | -------------------------------------- |
| Primary first audio, p50, sentence turns         | 1.38–1.43 s; 1.42–1.52 s with the extra | 3.5–4.1 s (vi speaker)                 |
| Primary first audio, p50, 8 s turns              | 1.65–1.70 s; 1.76–2.00 s with the extra | 4.3–5.8 s (vi speaker)                 |
| Extra (zh) first audio, p50                      | 1–1.5 s after the primary               | 7.5–20 s                               |
| Kokoro lock occupancy (en and zh share one lock) | 0.26–0.28; 0.52–0.60 with the extra     | 0.91–0.97                              |
| Slot hold, p50                                   | 4.7–5.8 s (sentence), 9.7–12.1 s (8 s)  | 10–16 s (sentence), 23–41 s (8 s)      |
| `limit_reached` on the relay                     | 0                                       | 0                                      |

- **Extras cost the primary little.** A zh extra doubles Kokoro time per turn (0.9 →
  1.85 s per sentence turn, 2.0 → 4.3 s per 8 s turn) but moves the primary's p50 by
  0.07–0.3 s. The primary is spoken first; each extra starts after its first audio.
- **VieNeu saturates with one speaker.** A single continuous en→vi speaker holds the
  Vietnamese engine 0.94–0.97 of the time with or without extras, and 15–25 % of its
  turns fail `engine_busy` after the 15 s lock wait
  (`ENGINE_LOCK_WAIT_S`, `services/local-tts/engines/base.py`). This is the engine's
  whole-turn lock, not the meeting path, and it is a known limit: /translate vi users
  share that engine.
- **/translate during a busy meeting.** Before the meeting ceiling, a /translate user
  got 0 of 112 starts admitted in 5 of 6 runs while two continuous meeting speakers ran.
  With it, 4 of 4 /translate turns were admitted and finished in all 5 runs.
- **The meeting pays for it.** With two continuous speakers the legs sit at the meeting
  ceiling for 178–190 s of 200. Refused turns are retried and given up after the
  client's pending window (`MAX_PENDING_MS`,
  `packages/realtime-client/src/conversation/turn-pipeline.ts`): in the sentence-turn
  runs 12–25 turns per leg per 200 s were never translated. The per-user 3 lets one leg take 3 of the 4 slots and
  starve the other (9 vs 17 rows in one run, 23 vs 10 in the next).
- **A speaker slower than real time loses audio.** The relay sink drops the audio of
  some turns for backlog (up to 37 per leg per run under two speakers); their subtitles and rows
  still arrive.

## 5. Echo / ducking — the original voice while translation plays

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
`getUserMedia({ echoCancellation: true })` + the WebRTC stack's built-in handling
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

### Measured: a phone on its loudspeaker (2026-10-26 and 2026-10-27)

The paragraph above assumed each device's echo canceller covers its own playback. On
Android it did not. The leg's recorder is a second microphone stream beside WebRTC's, and
`react-native-audio-api` opened it with no input preset, so it captured as
`VOICE_RECOGNITION` with no effects. Received translations play as media
(`USAGE_MEDIA`, the music volume), the peer's original voice as a call.

Galaxy A13 joined as vi on its loudspeaker with nobody near it; one en web peer talked
continuously for 3.5 min. A phantom is an A13 row that is really the room's playback.

| Recorder                                      | Onset gate | Media volume    | Phantom rows | Of which the peer's translation       |
| --------------------------------------------- | ---------- | --------------- | ------------ | ------------------------------------- |
| no preset (`VOICE_RECOGNITION`, no effects)   | off        | 1/15            | 47           | 0 (23 were the peer's original voice) |
| no preset                                     | on         | 1/15            | 0            | 0                                     |
| `VoiceCommunication` preset only              | off        | 1/15            | 0            | 0, but no echo canceller attached     |
| preset + session id (echo canceller attached) | off        | 1/15            | 0            | 0                                     |
| preset + session id                           | off        | 10/15           | 1            | 0                                     |
| preset + session id                           | off        | 15/15, call 8/8 | 40           | 35                                    |

A same-language peer, whose translation never plays on the phone, gave 0 rows.

What this settled:

- **The recorder patch.** `patches/react-native-audio-api@0.13.6.patch` sets the
  `VoiceCommunication` input preset and an allocated session id. The preset alone opened
  AAudio's MMAP path, which runs no effects; the session id forces the legacy path, where
  `dumpsys audio` shows `'Acoustic Echo Canceler'` on the leg recorder. The reason is in
  `pnpm-workspace.yaml` beside the patch entry.
- **The patch is not enough on its own.** At 1/15 the playback peaks around −35 dBFS at
  the recorder, just under the lowest level the speech gate can open on (about −33 dBFS,
  `MIN_NOISE_FLOOR + SPEECH_MARGIN` in `packages/realtime-client/src/audio/speech-gate.ts`);
  the canceller did not measurably lower that peak. At full volume the translation reaches
  the recorder at about −18 dBFS median and is read back as the phone's own speech.
- **So mobile keeps the received-audio onset gate.** While any received translation is
  sounding on the device and no turn is open, capture blocks do not reach the speech gate,
  so playback cannot open a turn. An open turn is never cut by it, which is why it is not
  the half-duplex mute: in a three-person room the speaker who talks over a peer's
  translation would be cut on every block. It is an optional `receivedSounding` option on
  the capture pump and the leg; only mobile sets it
  (`apps/mobile/src/conference/use-conference-native.ts`, over
  `NativeTranslationAudioSink.isAnySounding()`), and /translate never does.
- **What the gate does not cover.** It keys on received translations, not on the peer's
  WebRTC voice: at full volume one row per run still matched the peer's original words.

**Not yet measured.** The gate-on run at full volume (the phone was in use); a person
speaking at the phone while a translation plays; iOS, whose capture probably has no voice
processing because the library never enables it on its input node (unverified, no iOS
build); and web on Chrome and Firefox, which needs a machine with a microphone and
speakers. Web does not wire the gate, by the rule that it ships only where a measurement
fails.

---

## 6. Gemini Live — does live mode fit a meeting?

**Live mode today** (`GeminiLiveTranslateProvider`, the `realtime` kind behind
`translateMode: 'live'`) is one upstream speech-to-speech session per
`/ws/translate` connection: `client.live.audio` in, `server.live.audio` out,
continuous, no turn cascade ([data-flow.md § Live mode](./data-flow.md#live-mode-on-the-same-socket)).

**Does it fit a meeting?** Partially, and only under Option A:

- **It fits per-direction, client-side.** A client could open one Gemini Live
  session per target language from its own clean mic PCM, exactly as it opens
  cascade sessions today. Server-side track access is **irrelevant** to live
  mode as currently built, because live mode consumes client PCM over the
  WebSocket, not RTP from the SFU — live mode never looks at the SFU track.
- **It does not fit the fan-out requirement cleanly.** Live mode is one
  bidirectional stream; the K-languages-once-each dedup in §3 assumes a
  turn-shaped result (one finished translation per language, fanned out). A
  continuous speech-to-speech stream is per-session, so N speakers × (K−1)
  targets = N×(K−1) concurrent live sessions, each a metered cloud stream. That
  is the cost explosion §3 exists to avoid, moved to the cloud bill.
- **Cost/quota:** every live session is a sustained upstream connection on
  metered quota, versus the cascade's per-turn requests. For a multi-party room
  this multiplies fast.

**Verdict at design time on Gemini Live:** viable as a **1:1 or demo** path (low
latency, speech-to-speech), **not** the multi-party room engine. It is orthogonal to
the Option A/B choice because it bypasses the SFU track entirely.

**What happened.** A first build used it anyway: one live session per participant,
vi↔en only, bounded by six live sessions server-wide. The cascade leg (§2) replaced it,
for one engine across /translate and meetings, Chinese in rooms, and turns the server
closes.

**Where live mode is today.** Server-side only, for `apps/api/test/live-translate-ws.e2e-spec.ts`
and the `benchmarks/live-translate` harness, which run against a dev API. Whether it is
served is `liveModeEnabled` in `apps/api/src/config/env.schema.ts`: an explicit
`TRANSLATE_LIVE_MODE` wins, and unset it is on only when `NODE_ENV` is exactly
`development` or `test`. Elsewhere `client.live.start` is answered with
`server.live.error` `mode_unavailable` and the socket is closed with 4410, so a client
built for the old path stops streaming instead of sending audio into errors.

---

## 7. Latency

Per-hop numbers come from the project's own measurements where they exist;
everything else is labelled **estimated**.

### Measured in a meeting on the cascade (2026-10-26 and 2026-10-27)

Endpoint to the first translated audio on the speaker's socket, one speaker, from the
capacity runs in §4: **p50 1.38–1.43 s, p95 1.73–2.08 s** on sentence turns, and p50
1.42–1.52 s with a zh extra, whose own audio follows about 1 s later. Under two continuous
speakers in a vi/en/zh room the primary p50 rises to 3.5–4.1 s. These are dev-stack
numbers with fake-audio peers on one machine; the relay hop to the listener is not
included.

### Superseded: measured on live mode (2-tab PoC, 2026-10-06)

One machine (Windows 11, Docker Desktop, both sidecars healthy), two tabs in one
browser, `client.live.*` path. T1 = first speech frame sent, T2 = first
`server.live.transcript` on the `target` channel, both in the speaker tab, so only
T1→T2 is clock-clean. T3 (final subtitle) and T4 (first TTS frame) were read in the
listener tab against its own page clock, so they are not deltas from T1.

| Metric                                      | Run 1 (cold session) | Run 2 (warm session) |
| ------------------------------------------- | -------------------- | -------------------- |
| T1→T2 utterance 1                           | **9 169 ms**         | **5 918 ms**         |
| T1→T2 utterance 2                           | 10 164 ms            | 6 917 ms             |
| T3 final subtitle at listener (page-clock)  | 14 779 ms            | 15 983 ms            |
| T4 first TTS audio at listener (page-clock) | 11 957 ms            | 10 158 ms            |

About 6 s warm, with a ~3 s cold-session penalty on the first utterance, on the live
path meetings no longer use. The cascade hops below are much faster because the cascade
is turn-shaped.

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

## 8. Recommendation

**Adopt Option A (client-side capture)** — adopted and built (§2), first on live mode,
now on the cascade. Ranked rationale at design time:

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
once per (speaker, language) and fanned out as one SFU producer per
language (§3). Build the per-listener WebSocket-frame fallback first for the
demo, then the producer-injection dedup for scale.

**Gemini Live:** recommended as a separate 1:1/demo path, not the multi-party room
engine (§6). A first build used it anyway; meetings have since moved to the cascade.

---

## Unresolved questions

1. **Meeting fairness under overload.** With two continuous speakers one leg can take 3
   of the 4 meeting slots and starve the other, and both lose turns (§4). A per-leg cap
   of 2, or a longer pending window for legs, is an open owner decision.
2. **VieNeu capacity.** One continuous en→vi speaker saturates the Vietnamese engine (§4);
   accepted as a known limit for now.
3. **Echo still to measure** (§5): the mobile gate at full volume, barge-in at the phone,
   iOS, and web on Chrome and Firefox with real speakers.
4. **Server-side injection of TTS** into the SFU (producer-per-language, §3) is
   unproven, and on Cloudflare it needs the WebSocket adapter's public endpoint (§0) —
   the SFU only forwards client-published tracks.
5. **Speaker language per participant**: each participant has one known source
   language (`ConferenceParticipant.sourceLanguage`, set at join). Code-switching within
   one speaker is out of scope here.
6. **Who picks the translated voice**: today the speaker does (web reuses their
   /translate voice settings, mobile the defaults), so a listener may hear a different
   voice per remote speaker and cannot choose one.
