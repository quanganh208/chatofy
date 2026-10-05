# Chatofy: Video Conferencing + Real-time Translation Architecture

> **Status: Proposal — not implemented.** No conferencing code exists on `main` as of
> 2026-10-05. Progress is tracked in [project-roadmap.md](./project-roadmap.md); the
> choices that must be made before building are in [Open decisions](#open-decisions).

**Date:** 2026-09-29  
**Scope:** Proposed evolution from standalone translation → unified video conferencing platform

Everything below describing conferences, rooms, participants, video, chat or recordings
is **proposed**. Statements about the current system cite the document or source that
owns them.

---

## 1. Vision: Unified Video Conferencing Platform

### Current State

- Standalone **real-time voice translation** (Chatofy Web/Mobile/Extension)
- Two-language conversations (vi ↔ en today), with per-turn speaker attribution that
  distinguishes at most two voices — see
  [Per-turn speaker attribution](./architecture/ai-providers.md#per-turn-speaker-attribution)
- Saved conversation history: transcripts with diacritic-insensitive search and a
  per-conversation audio recording — see
  [History search](./architecture/ai-providers.md#history-search)
- Post-conversation minutes generation — see
  [Meeting minutes](./architecture/ai-providers.md#meeting-minutes-llm)
- No in-app text chat and no video

### Target State (proposed)

- **Video conferencing** (Zoom/Meet competitor) that would provide:
  - Real-time multimedia translation (audio + subtitles)
  - Live messaging (text chat during meeting)
  - Speaker attribution & participant roster
  - Meeting recording & transcription with translation
  - AI-powered meeting summaries
  - Context-aware translation per meeting

---

## 2. Architectural Reuse: What Exists and How the Proposal Would Reuse It

The "Today" columns describe the current system; the "Proposed reuse" columns and the
reuse percentages are the proposal's estimates, not measurements.

### 2.1 Translation Stack (estimated 100% reusable)

| Component                | Today                                                                                                                                                           | Proposed reuse in video                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Language Registry**    | `packages/types/src/domain/languages.ts` (vi, en)                                                                                                               | Per-participant, per-stream                                                                                                                                                               |
| **Type Contracts**       | Zod schemas in `packages/types` → TypeScript types                                                                                                              | Extend with video events                                                                                                                                                                  |
| **Provider Abstraction** | STT / TTS / translation / summarization / speaker providers behind one `ProviderRegistry` (`packages/ai-providers`)                                             | Add a video encoding provider                                                                                                                                                             |
| **Local Sidecars**       | `services/local-stt` :8002 (STT + CAM++ speaker vectors), `services/local-tts` :8003                                                                            | Reuse unchanged; capacity for N concurrent speakers is unmeasured (see [Open decisions](#open-decisions))                                                                                 |
| **Speaker Attribution**  | CAM++ vector from the STT sidecar; online clustering in the browser, capped at two voices, session-scoped, never persisted                                      | Needs rework, not reuse: the two-voice cap and the no-persistence rule conflict with this proposal ([Open decisions](#open-decisions)); one track per participant may make it unnecessary |
| **AI Context (hints)**   | Saved `TranslationContext` (topic, hotwords, style, glossary) — see [Data Flow](./architecture/data-flow.md#ai-context-and-the-path-a-hint-takes-to-the-prompt) | Per-meeting context library                                                                                                                                                               |
| **Streaming WebSocket**  | `/ws/translate` turn pipeline — see [Data Flow](./architecture/data-flow.md#streaming-turn-wstranslate)                                                         | Extend to a new `/ws/conference`                                                                                                                                                          |

### 2.2 Authentication & Session Management (exists; reuse proposed)

What exists today ([Authentication](./architecture/authentication.md)):

- 15-minute access JWT + rotating refresh tokens held in Redis
- Redis holds only the refresh-token families (`RefreshTokenStore`); there is no other
  Redis state today
- Password reset & email verification
- Google account linking
- Route-level `@Throttle` limits; in-process storage, so limits are per API instance
- WebSocket auth refused at the upgrade, which a conference socket could reuse

### 2.3 Database & Storage (estimated 95% reusable)

| Layer               | Today                                                                                                                                                                                   | Proposed reuse                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Postgres**        | Prisma schema in `apps/api/prisma/schema.prisma`                                                                                                                                        | Extend schema for meetings, participants, messages                |
| **Redis**           | Refresh tokens only                                                                                                                                                                     | Add room-state cache (participants, active streams) — a new use   |
| **R2 (Cloudflare)** | One shared, **public-read** bucket with `avatars/` and `conversations/` prefixes — see [Bucket layout](./architecture/authentication.md#bucket-layout-and-the-one-rule-that-governs-it) | Video recording + transcript storage (access is an open decision) |
| **Search**          | `pg_trgm` GIN index on `ConversationTurn.searchText` — see [History search](./architecture/ai-providers.md#history-search)                                                              | Extend to conference transcripts and chat messages                |

### 2.4 Frontend Patterns (estimated 80% reusable)

| Component                | Today                                                            | Proposed reuse                                           |
| ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------- |
| **Next.js app layout**   | App routes under `apps/web/app/(app)/`                           | Add a `/conference` route                                |
| **shadcn UI components** | `packages/ui`                                                    | Extend with video grid, participant list                 |
| **Real-time client**     | `@chatofy/realtime-client`                                       | Add video track handling                                 |
| **Audio/Video capture**  | `CapturePump` (`packages/realtime-client`) — microphone PCM only | Extend for multi-participant; video capture would be new |

---

## 3. New Components (proposed)

### 3.1 Video Codec & Transport

The provider below names Pion; the media server is undecided (see
[Open decisions](#open-decisions)).

```
NEW: packages/video-provider/
├── interfaces/
│   ├── video-provider.ts       # VP8/H264 encoding, SDP negotiation
│   └── codec-factory.ts         # Select codec per bandwidth
├── providers/
│   ├── webrtc-provider.ts       # Pion WebRTC library (assumption)
│   ├── simulcast-config.ts      # Multi-bitrate streams
│   └── bandwidth-adaptation.ts  # Adjust resolution on network change
└── codecs/
    ├── vp8-config.ts
    └── h264-config.ts
```

### 3.2 SFU (Selective Forwarding Unit) / Meeting Room Logic

```
NEW: apps/api/src/modules/conference/
├── conference.controller.ts     # HTTP endpoints for room create/list/join
├── conference.gateway.ts        # WebSocket: /ws/conference/{roomId}
├── services/
│   ├── conference.service.ts    # Room lifecycle
│   ├── participant.service.ts   # Join/leave, track routing
│   ├── meeting-orchestrator.ts  # Coordinate translation + TTS per participant
│   └── live-transcription.service.ts  # Real-time transcript generation
├── session/
│   ├── room-session.ts          # Room state (participants, streams, quality)
│   ├── participant-session.ts   # Per-user state (language, voice, volume)
│   └── stream-router.ts         # Which tracks to which participants
└── store/
    └── prisma-conference.store.ts  # Persist meetings, participants
```

### 3.3 Messaging/Chat Module

```
NEW: apps/api/src/modules/messaging/
├── message.controller.ts        # REST: POST /messages, GET /messages/{conversationId}
├── message.gateway.ts           # WebSocket: /ws/conference/{roomId} → message events
├── services/
│   └── message.service.ts       # Save & fanout messages
└── store/
    └── prisma-message.store.ts  # Persist chat history
```

### 3.4 Real-time Translation Engine (Multi-Participant)

```
EXTEND: apps/api/src/modules/translate/
├── session/
│   ├── conference-turn-session.ts  # Per-participant turn (no merge)
│   ├── room-translation-router.ts  # Route participant A's turn → all others' languages
│   └── live-subtitle-generator.ts  # Generate subtitles per participant
└── providers/
    └── subtitle-provider.ts       # Render translations to VP8 canvas overlay
```

### 3.5 Video Recording & Post-Processing

```
NEW: apps/api/src/modules/recording/
├── recording.service.ts         # Mux + encode streams, embed translation
├── transcript-compositor.ts     # Overlay subtitles onto video
└── store/
    └── prisma-recording.store.ts  # Persist recording metadata
```

### 3.6 Frontend: Video Conferencing UI

```
NEW: apps/web/app/(app)/conference/
├── [roomId]/
│   ├── page.tsx                 # Conference screen
│   └── components/
│       ├── video-grid.tsx       # Speaker + thumbnails (responsive)
│       ├── participant-list.tsx # Roster + mute/remove controls
│       ├── chat-panel.tsx       # Message history + input
│       ├── subtitle-overlay.tsx # Real-time translated text
│       └── control-bar.tsx      # Camera/mic/speaker/settings
├── create/
│   └── page.tsx                 # Create new meeting
└── utils/
    ├── video-layout.ts          # Grid layout algorithm
    └── rtc-config.ts            # TURN servers, codec preferences
```

---

## 4. Proposed Data Flow: Video Conferencing + Translation

### 4.1 Participant Joins Conference

```
1. Alice (en) joins room /conference/abc123
2. POST /conference/{roomId}/join
   ├─ Create ConferenceParticipant row
   ├─ Load her AI Context (glossary, hotwords)
   ├─ Get language preferences + voice selection
   └─ Return ICE candidates + SDP offer

3. WS /ws/conference/{roomId}
   ├─ Upload video/audio tracks
   ├─ server.participant.joined → broadcast to others
   ├─ Create input PCM streams for STT (Vietnamese, English)
   └─ Ready to receive translated media
```

### 4.2 Bob Speaks (Vietnamese) → Alice Hears (English)

`TranslationRouter` is a proposed class; nothing by that name exists today. With one
audio track per participant the speaker is known from the track, so the CAM++ step
below may be unnecessary (see [Open decisions](#open-decisions)).

```
1. Bob sends audio frames (vi PCM16)
2. TranslationRouter.process():
   ├─ STT(vi audio) → Vietnamese transcript
   ├─ Speaker attribution: CAM++ embedding → identify Bob
   ├─ Translate(vi → en) → English text
   ├─ TTS(en text, voice:fem) → English audio
   │   └─ Real-time streaming via the TTS sidecar's /synthesize/stream
   ├─ Emit subtitle: server.translation.live {speaker: "Bob", text: "...", ts}
   └─ Route audio frame to Alice's stream

3. Alice receives:
   ├─ Subtitle overlay: "Bob: [translation]" (styled, fading)
   ├─ Audio frame: Bob's voice translated to English
   ├─ Transcript row: {speaker: "Bob", sourceText: "vi ...", targetText: "en ..."}
```

### 4.3 Chat During Meeting

```
1. Alice types "Let's break for lunch" in chat
2. POST /messages { conversationId, text, language: "en" }
3. Broadcast message.sent → all participants
4. Optional: Auto-translate to meeting languages:
   ├─ Translate(en → vi) for Vietnamese participants
   ├─ Emit message.translated { sourceText, translations: {vi, ...} }
   └─ Participants see original + their language in chat
```

### 4.4 Meeting Ends → Recording + Summary

Minutes today hang off a stored `Conversation` and read its `ConversationTurn` rows
through `GeminiSummarizationProvider`; the proposal would do the same over
`ConferenceTurn`. R2 is public-read today, so the archive step depends on the
recording-access decision in [Open decisions](#open-decisions).

```
1. Conference ends (all participants leave)
2. Background job: RecordingCompositor
   ├─ Mux video streams (grid layout)
   ├─ Overlay translated subtitles
   ├─ Sync audio: Bob's voice (vi) + translation (en) on separate tracks
   └─ Output: .mp4 with multilingual audio tracks
3. Generate MeetingMinutes
   ├─ Transcript source: ConferenceTurn (with speaker attribution)
   ├─ Call Gemini (summarization provider) with transcript + context
   └─ Store minutes (summary, key points, action items)
4. Archive: R2 bucket
   ├─ recordings/{meetingId}/{timestamp}.mp4
   └─ transcripts/{meetingId}.jsonl
```

---

## 5. Schema Evolution: Database

The full proposed schema is in
[database-schema-conference.md](./database-schema-conference.md). Note that the current
schema uses `cuid()` string ids and plain `ownerId` columns rather than `UUID` keys and
`User` foreign keys; the SQL below has not been reconciled with that convention.

### 5.1 New Tables (Minimum)

```sql
-- Conference rooms
CREATE TABLE Conference (
  id UUID PRIMARY KEY,
  ownerId UUID NOT NULL,
  title VARCHAR(256),
  description TEXT,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  startedAt TIMESTAMPTZ,
  endedAt TIMESTAMPTZ,
  recordingKey VARCHAR(512), -- R2 path
  FOREIGN KEY (ownerId) REFERENCES User(id)
);

-- Participants in a conference
CREATE TABLE ConferenceParticipant (
  id UUID PRIMARY KEY,
  conferenceId UUID NOT NULL,
  userId UUID NOT NULL,
  joinedAt TIMESTAMPTZ,
  leftAt TIMESTAMPTZ,
  sourceLanguage VARCHAR(2),
  displayName VARCHAR(256),
  FOREIGN KEY (conferenceId) REFERENCES Conference(id),
  FOREIGN KEY (userId) REFERENCES User(id)
);

-- Chat messages during conference
CREATE TABLE ConferenceMessage (
  id UUID PRIMARY KEY,
  conferenceId UUID NOT NULL,
  participantId UUID NOT NULL,
  text TEXT,
  sourceLanguage VARCHAR(2),
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (conferenceId) REFERENCES Conference(id),
  FOREIGN KEY (participantId) REFERENCES ConferenceParticipant(id)
);

-- Message translations (optional, cached)
CREATE TABLE MessageTranslation (
  id UUID PRIMARY KEY,
  messageId UUID NOT NULL,
  targetLanguage VARCHAR(2),
  translatedText TEXT,
  FOREIGN KEY (messageId) REFERENCES ConferenceMessage(id)
);

-- Per-turn translations in conference (parallel to ConversationTurn)
CREATE TABLE ConferenceTurn (
  id UUID PRIMARY KEY,
  conferenceId UUID NOT NULL,
  participantId UUID NOT NULL,
  sourceText TEXT,
  translations JSONB, -- {vi: "...", en: "..."} keyed by language
  embedding BYTEA, -- Speaker embedding (CAM++); today no voice vector is ever persisted
  createdAt TIMESTAMPTZ,
  displayText TEXT, -- ConversationTurn.displayText is the repaired rendering; search uses searchText
  FOREIGN KEY (conferenceId) REFERENCES Conference(id),
  FOREIGN KEY (participantId) REFERENCES ConferenceParticipant(id),
  INDEX (conferenceId, createdAt)
);

-- Conference minutes (modelled on MeetingMinutes, which today is keyed by conversationId)
CREATE TABLE ConferenceMeetingMinutes (
  id UUID PRIMARY KEY,
  conferenceId UUID NOT NULL UNIQUE,
  summary TEXT,
  keyPoints TEXT[], -- JSON array
  decisions TEXT[], -- JSON array
  actionItems JSONB, -- [{id, description, owner, dueDate}, ...]
  status ENUM ('pending', 'generating', 'ready', 'failed'), -- MeetingMinutes' status values
  generatedAt TIMESTAMPTZ,
  FOREIGN KEY (conferenceId) REFERENCES Conference(id)
);
```

---

## 6. Technical Challenges & Proposed Solutions

### Challenge 1: Multi-Participant Bandwidth

**Problem:** Video + audio + translation = 10 Mbps per participant × N (estimate)  
**Proposed solutions:**

- Simulcast (VP8 multi-bitrate): Client adapts layer per bandwidth
- SFU (not MCU): the media server routes streams, doesn't re-encode
- Client-side rendering: Browser composites grid, not server
- Selective forwarding: Don't route A→A video

### Challenge 2: Translation Latency

**Problem:** Translate N participants' audio simultaneously in real-time  
**Proposed solutions:**

- Parallel translation: One `TurnSession` per participant (no merge)
- Live preview: Show translation while speaker continues (exists today for turns past
  three seconds — `server.translation.partial`, see
  [Data Flow](./architecture/data-flow.md#streaming-turn-wstranslate))
- Speculative decoding: Guess endpoint, move on if wrong (exists today —
  `client.turn.speculate`, up to four guesses per turn)
- Prioritize active speaker: Mute others' translation during interruptions

### Challenge 3: Speaker Attribution Accuracy

**Problem:** Who said what in a crowded room?  
**Proposed solutions:**

- CAM++ embeddings per turn (exist today, but clustering runs in the browser and is
  capped at two voices — see
  [Per-turn speaker attribution](./architecture/ai-providers.md#per-turn-speaker-attribution))
- Optional: voice enrollment (enroll once, match ongoing). The current product replaced
  an enrolment design because it could not start without confirmed turns; read that
  section before reviving it
- Validate: a proposed `settings.confirmAttribution: bool` would let users correct
  (today a person can overrule any label from the chip on a finished turn)
- Consensus: >2 participants' embeddings agree before label sticks

### Challenge 4: Subtitle Synchronization

**Problem:** Subtitles must match audio, lag < 500ms (target, unverified)  
**Proposed solutions:**

- Timestamp every translation with frame time
- Stream TTS output frame-by-frame (no chunking delay)
- Client-side buffering: queue frames, play in order
- Fallback to captions if audio fails (degrade gracefully)

### Challenge 5: Recording Multi-Track Audio

**Problem:** Video recording with separate audio tracks (vi + en + translated)  
**Proposed solutions:**

- Mux 3 audio tracks into one .mp4 (FFmpeg, Opus codec)
- Metadata: track language, speaker, offset timestamp
- Playback: UI lets user select audio track
- Async job: Don't block meeting end; run compositor in background

### Challenge 6: Database Consistency at Scale

**Problem:** Chat + transcript + metrics written concurrently  
**Proposed solutions:**

- Prisma `Serializable` isolation on conference writes (not used anywhere today)
- Separate read path: `ConferenceTurn` is append-only (no contention)
- Message cache: Redis pubsub for live delivery, DB only for history (a new Redis use)
- Metrics: Log lines (JSONL) first, async insert into DB (no failing)

---

## 7. Phased Implementation Roadmap (proposed)

Week numbers and effort are the proposal's estimates and have not been checked against
this project's capacity (see [Open decisions](#open-decisions)).

### Phase 1: Infrastructure (Weeks 1-3)

**Goal:** Build foundation, no video yet

- [ ] Add `packages/video-provider` interface (abstraction layer)
- [ ] Schema: `Conference`, `ConferenceParticipant`, `ConferenceTurn`, `ConferenceMessage`
- [ ] API: Basic CRUD for conferences (`POST /conference`, `GET /conference/{id}`)
- [ ] Redis: Room state cache (participants online, active streams)
- [ ] Tests: In-memory conference store + controller tests
- **Verification:** `pnpm typecheck && pnpm --filter api test` pass

### Phase 2: Real-time Signaling (Weeks 4-5)

**Goal:** WebSocket foundation for multi-user

- [ ] Extend `/ws/conference/{roomId}` handler
- [ ] Events: `client.participant.join`, `server.participant.joined`, `participant.left`
- [ ] Implement `RoomSession` (manages participants, streams)
- [ ] Implement `ParticipantSession` (per-user state: language, voice, mute)
- [ ] Tests: Integration tests for join/leave scenarios
- **Verification:** Chatofy Web can connect to empty room

### Phase 3: Video Basics (Weeks 6-8)

**Goal:** Video transport + grid layout

- [ ] WebRTC SFU (media server per [Open decisions](#open-decisions); this text assumed
      the Pion library): ICE, DTLS, RTP
- [ ] Video codec negotiation (VP8 default, H264 fallback)
- [ ] Client: Video capture + send (alongside `CapturePump`, which is audio-only)
- [ ] Client: Video grid layout (4-up, speaker pinned)
- [ ] Test: Two browsers, video streams visible
- **Verification:** `pnpm --filter web dev` → video grid renders

### Phase 4: Translation in Video (Weeks 9-11)

**Goal:** Audio translation + subtitles in conference

- [ ] Add a `TranslationRouter` for multi-participant
  - One `TurnSession` per participant
  - No merge; route to all others in their language
- [ ] Subtitle generation: `LiveSubtitleGenerator`
  - Emit `server.subtitle.live {speaker, text, ts}`
  - Client overlay component
- [ ] Audio synthesis: Stream TTS to video stream
  - Route translated audio to all participants
- [ ] Tests: 2-participant translation scenario
- **Verification:** Meeting page shows live subtitles + translated audio

### Phase 5: Chat + Recording (Weeks 12-14)

**Goal:** Messaging + permanent record

- [ ] Messaging module: Save/broadcast chat messages
  - `POST /messages` (authenticated)
  - `server.message.new` event
- [ ] Message translation (opt-in): Auto-translate to meeting languages
- [ ] Recording: Composite video stream
  - Mux participant videos + translated audio
  - FFmpeg async job
- [ ] R2 storage: Upload completed recording
- [ ] Tests: Recording playback verification
- **Verification:** Download recording, play in VLC (multiple audio tracks)

### Phase 6: Minutes + Polish (Weeks 15-17)

**Goal:** Meeting summary + UI refinement

- [ ] Extend `MeetingMinutes` for conferences (reuse `GeminiSummarizationProvider`)
- [ ] Background job: Generate minutes post-meeting
- [ ] UI: Minutes page, share/export
- [ ] Participant management: Mute, remove, settings
- [ ] Accessibility: WCAG AA compliance
- [ ] Tests: E2E for 3-participant meeting
- **Verification:** Meeting ends → minutes generated within 2 minutes

### Phase 7: Production Hardening (Weeks 18-20)

**Goal:** Scale, reliability, monitoring

- [ ] Load testing: 10 concurrent conferences, 5 participants each
- [ ] Failover: Redis down, sidecar unavailable
- [ ] Monitoring: Prometheus metrics (latency, dropout rate, CPU)
- [ ] Logging: Structured logs for debugging
- [ ] Deployment: Update deployment-guide.md
- **Verification:** `pnpm audit --audit-level=high` passes

---

## 8. Architecture Diagram: Proposed Multi-Participant Flow

```
┌────────────────────────────────────────────────────────────────┐
│                        Video Conferencing                       │
│                     (Zoom/Meet Competitor)                      │
└────────────────────────────────────────────────────────────────┘

                    ┌─ Alice (en)
                    │
     ┌──────────┐   ├─ Bob (vi)
     │  Browser │   │
     │   App    │   ├─ Carol (vi)
     │  (Web/   │   │
     │  Mobile) │   └─ David (en)
     └────┬─────┘
          │
          │ WebRTC SFU + WebSocket
          │
     ┌────▼──────────────────────────────────────────┐
     │  apps/api (NestJS)                            │
     ├───────────────────────────────────────────────┤
     │                                               │
     │  ┌─ ConferenceGateway /ws/conference/{id}   │
     │  │  ├─ RoomSession (room state)             │
     │  │  └─ ParticipantSession (per-user)        │
     │  │                                           │
     │  ├─ TranslationRouter (multi-participant)   │
     │  │  ├─ Alice listens: vi→en                 │
     │  │  ├─ Bob listens: en→vi                   │
     │  │  └─ Parallel TurnSessions (no merge)    │
     │  │                                           │
     │  ├─ LiveSubtitleGenerator                   │
     │  │  └─ server.subtitle.live events         │
     │  │                                           │
     │  ├─ MessagingService                        │
     │  │  └─ Save + broadcast chat                │
     │  │                                           │
     │  ├─ RecordingCompositor (async)             │
     │  │  └─ Mux video + multilingual audio       │
     │  │                                           │
     │  └─ MeetingMinutesService                   │
     │     └─ Summarize post-meeting              │
     │                                               │
     └───────────────────────────────────────────────┘
                    │
          ┌─────────┼─────────┐
          │         │         │
     ┌────▼──┐ ┌────▼──┐ ┌───▼────┐
     │Postgres│ │ Redis │ │ R2     │
     │        │ │ (room)│ │(video) │
     │Conference   WebSocket  Recording
     │Participant  cache      metadata
     │Turn         + TTL
     │Message      60s
     │Minutes
     └────────┘ └────────┘ └────────┘
          │
     ┌────▼─────────────────────┐
     │ Local Sidecars (Docker)  │
     ├─────────────────────────┤
     │ STT :8002 (vi + en)     │
     │ TTS :8003 (vi + en)     │
     │                         │
     │ (Unchanged from Chatofy)│
     └─────────────────────────┘
     Translation: Gemini (cloud API, not a sidecar)
```

---

## 9. File Structure: Proposed New Modules

The API modules (`conference/`, `messaging/`, `recording/`, the `translate/` extension),
`packages/video-provider` and the web route `apps/web/app/(app)/conference/` are laid out
in §3.1–§3.6; the one difference is that this section's layout put `video-provider/`
under `apps/api/src/modules/` as well as under `packages/`. Not shown in §3:

```
apps/web/src/hooks/
├── use-conference.ts              (conference state)
├── use-video-stream.ts            (local video)
└── use-participant-audio.ts       (remote audio playback)

apps/api/src/modules/conference/
├── conference.module.ts
└── session/
    ├── live-subtitle-generator.ts (render translations)
    └── stream-handler.ts          (PCM → translation pipeline)

packages/realtime-client/
└── EXTEND with video track handling
```

---

## 10. Risk Mitigation

Detailed analysis is in [technical-risks-mitigation.md](./technical-risks-mitigation.md).

| Risk                           | Probability | Impact              | Mitigation                                        |
| ------------------------------ | ----------- | ------------------- | ------------------------------------------------- |
| Video latency > 1s             | HIGH        | Session quality ↓   | Simulcast + adaptive bitrate                      |
| Translation lag delays video   | MEDIUM      | Subtitle mismatch   | Live preview + frame-based timing                 |
| Speaker attribution wrong      | MEDIUM      | Confusion           | User manual override + logging                    |
| Redis outage → room state lost | LOW         | Participants kicked | Checkpoint room state to DB every 5s              |
| Recording composition fails    | LOW         | Lost meeting        | Retry job + alert ops                             |
| N×M translation cost explosion | MEDIUM      | Budget overrun      | Rate limit by conference size, cache translations |

---

## 11. Success Metrics (proposed targets, unverified)

### Phase Completion (0-20 weeks)

- [ ] 2-participant video conference works end-to-end
- [ ] Subtitles appear < 500ms after translation
- [ ] Recording plays back with correct speaker labels
- [ ] Meeting minutes generate < 2 minutes after end

### Production (Post-launch)

- [ ] P50 latency: audio → translation → subtitle < 1.5s
- [ ] P99 latency < 3s
- [ ] Video frame drop rate < 1%
- [ ] Subtitle accuracy > 95%
- [ ] Speaker attribution > 90%

---

## 12. Next Steps

1. Settle the [Open decisions](#open-decisions) (Gate 0 in
   [project-roadmap.md](./project-roadmap.md))
2. Review + approve architecture
3. Create implementation plan with detailed task breakdown
4. Set up video-provider package scaffolding
5. Begin Phase 1 (infrastructure)

---

## Open decisions

Nothing below is settled. Each item changes what the phases above contain, and the
other two video documents link here.

### 1. Media server (SFU) — undecided

The text above names Pion (§3.1, §7 Phase 3, §9, Appendix). That is an assumption made
while writing, not a decision. Three candidates:

| Criterion                              | LiveKit                                                                                                  | mediasoup                                                                                        | Pion                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| What it is                             | Self-hosted SFU server (Go) with JS, React and React Native SDKs                                         | Node.js library (C++ media workers); SFU primitives only                                         | Go WebRTC library; the SFU is ours to write                              |
| Fit with the NestJS stack              | NestJS only mints access tokens and stores room metadata; media and signaling stay in the LiveKit server | Runs in or beside the Node API; signaling is ours (could ride the existing `ws` gateway pattern) | A separate Go service beside NestJS, plus a control channel between them |
| Ops on the prod VM (~3.4 GiB headroom) | One more container; recording (Egress) is a separate, heavier service. Footprint unmeasured              | Worker processes in or beside the API container. Footprint unmeasured                            | One more service; footprint depends on our code. Unmeasured              |
| Mobile (Expo)                          | React Native SDK; native WebRTC module, so an Expo development build rather than Expo Go                 | `mediasoup-client` over `react-native-webrtc`; development build                                 | Plain WebRTC client over `react-native-webrtc`; development build        |
| Effort                                 | Lowest: rooms, simulcast, reconnection and recording come with it                                        | Medium: signaling, room state and simulcast layer selection are ours                             | Highest: SFU logic is ours (the Appendix's 40h assumes this)             |

Common to all three: production is published through a Cloudflare Tunnel (see
[deployment-guide.md](./deployment-guide.md)), which serves the web and API hostnames.
How media packets reach the SFU — an open UDP port on the host or a TURN relay — is
unresolved for every option. Any footprint figure must be measured under a
`docker --memory` cap before it is trusted against the VM's headroom.

### 2. Pion implies a Go service beside NestJS

Every Pion reference assumes a Go process the repo does not have: no Go toolchain, CI
job, Dockerfile or deploy step exists for one today. Choosing Pion adds a language and a
service to build, test and deploy. The references are kept, flagged as assumptions,
until item 1 is decided.

### 3. Billing vs a non-commercial thesis

The design includes per-minute billing: `ConferenceBillingLine`, the `costEstimateCents`
/ `billingStatus` columns on `Conference`, the cost model and revenue/margin metrics in
[technical-risks-mitigation.md](./technical-risks-mitigation.md). Chatofy is a
non-commercial graduation thesis, and the default Vietnamese STT model is licensed for
academic/thesis use only (see [README → Model licences](../README.md#model-licences)).
The billing design is **kept but marked optional and out of thesis scope** pending a
decision. Tracking API cost (not revenue) may still be useful against the free-tier
quotas.

### 4. Stated targets are unverified on this project's hardware

6 participants, 720p at 60 fps, VP8, 2.5 Mbps per stream, the latency budgets, the
effort hours (164h) and the 20-week schedule are the proposal's targets, not
measurements. Speech runs on CPU in the sidecars, and the STT sidecar serves a bounded
number of concurrent decodes per engine (`LOCAL_STT_CONCURRENCY`, see
[Speech backend routing](./architecture/ai-providers.md#speech-backend-routing)); six
simultaneous speakers have not been measured against it.

### 5. Persisting speaker embeddings

The schema stores CAM++ vectors (`ConferenceTurn.embedding`,
`ConferenceSpeaker.embedding`). Today no voice vector is ever persisted — vectors stay
in the browser tab and leave with the conversation, by design (see
[Per-turn speaker attribution](./architecture/ai-providers.md#per-turn-speaker-attribution)).
With one audio track per participant the speaker may be known without acoustic
attribution at all. Decide whether attribution is needed, and if so whether storing
vectors is acceptable.

### 6. Recording access

Recordings are proposed for R2. The project's bucket is public-read and a prefix is not
an access boundary (see
[Bucket layout](./architecture/authentication.md#bucket-layout-and-the-one-rule-that-governs-it)),
so a stored meeting recording would be fetchable by anyone with its URL. Decide on a
private bucket or another store before recording ships.

---

## Appendix: Comparison Matrix (estimates)

### Reuse: Translation Stack

```
Component              Reuse   Effort  Note
Language Registry      100%    0h      No change
Type Contracts         100%    4h      Extend for video events
Provider Abstraction    95%    8h      Add video codec provider
STT/TTS Sidecars       100%    0h      Unchanged (capacity unmeasured)
Speaker Attribution    100%    0h      Reuse CAM++ clustering (capped at 2 voices today; see Open decisions)
AI Context             100%    2h      Extend to per-meeting
WebSocket Pipeline      80%    16h     Adapt for multi-participant
```

### Build: Video Conferencing

```
Component              New    Effort  Complexity
WebRTC SFU            YES     40h     🔴 HIGH (Pion library — assumption)
Video Grid UI         YES     24h     🟡 MEDIUM
Message Service       YES      8h     🟢 LOW
Recording Compositor  YES     32h     🔴 HIGH (FFmpeg)
Subtitle Overlay      YES     12h     🟡 MEDIUM
Database Schema       YES      4h     🟢 LOW
TOTAL                          164h   = 4-5 weeks (1 eng)
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-09-29 (reconciled with the current system 2026-10-05)
