# Chatofy: Video Conferencing + Real-time Translation Architecture

**Date:** 2026-09-29  
**Status:** Strategic Analysis & Roadmap  
**Scope:** Evolution from standalone translation → unified video conferencing platform

---

## 1. Vision: Unified Video Conferencing Platform

### Current State

- Standalone **real-time voice translation** (Chatofy Web/Mobile/Extension)
- Monologue/bilateral conversation support
- Text-only chat in history
- Post-meeting minutes generation

### Target State

- **Video conferencing** (Zoom/Meet competitor) with:
  - Real-time multimedia translation (audio + subtitles)
  - Live messaging (text chat during meeting)
  - Speaker attribution & participant roster
  - Meeting recording & transcription with translation
  - AI-powered meeting summaries
  - Context-aware translation per meeting

---

## 2. Architectural Reuse: What's Built ✅

### 2.1 Translation Stack (100% Reusable)

| Component                | Today                                    | Reuse in Video                 |
| ------------------------ | ---------------------------------------- | ------------------------------ |
| **Language Registry**    | `packages/types/src/domain/languages.ts` | ✅ Per-participant, per-stream |
| **Type Contracts**       | Zod schemas → TypeScript types           | ✅ Extend with video events    |
| **Provider Abstraction** | STT/TTS/Translation interfaces           | ✅ Add video encoding provider |
| **Local Sidecars**       | STT (port 8002), TTS (port 8003)         | ✅ Reuse unchanged             |
| **Speaker Attribution**  | CAM++ embeddings + clustering            | ✅ Identify participants       |
| **AI Context (hints)**   | Glossary + hotwords                      | ✅ Per-meeting context library |
| **Streaming WebSocket**  | `/ws/translate` pipeline                 | ✅ Extend to `/ws/conference`  |

### 2.2 Authentication & Session Management (100% Reusable)

- JWT + rotating refresh tokens ✅
- Redis session state ✅
- Password reset & email verification ✅
- Google OAuth link ✅
- Per-user throttling patterns ✅

### 2.3 Database & Storage (95% Reusable)

| Layer               | Reuse                                                    |
| ------------------- | -------------------------------------------------------- |
| **Postgres**        | Extend schema for meetings, participants, messages       |
| **Redis**           | Add room-state cache (participants, active streams)      |
| **R2 (Cloudflare)** | Video recording + transcript storage                     |
| **Search**          | `pg_trgm` for transcript search, extend to chat messages |

### 2.4 Frontend Patterns (80% Reusable)

| Component                | Reuse                                             |
| ------------------------ | ------------------------------------------------- |
| **Next.js app layout**   | Extend with `/conference` route                   |
| **shadcn UI components** | Extend with video grid, participant list          |
| **Real-time client**     | `@chatofy/realtime-client` + video track handling |
| **Audio/Video capture**  | Extend `CapturePump` for multi-participant        |

---

## 3. New Components: What's Missing 🔧

### 3.1 Video Codec & Transport

```
NEW: packages/video-provider/
├── interfaces/
│   ├── video-provider.ts       # VP8/H264 encoding, SDP negotiation
│   └── codec-factory.ts         # Select codec per bandwidth
├── providers/
│   ├── webrtc-provider.ts       # Pion WebRTC library
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
NEW: apps/web/src/app/(app)/conference/
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

## 4. Data Flow: Video Conferencing + Translation

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

```
1. Bob sends audio frames (vi PCM16)
2. TranslationRouter.process():
   ├─ STT(vi audio) → Vietnamese transcript
   ├─ Speaker attribution: CAM++ embedding → identify Bob
   ├─ Translate(vi → en) → English text
   ├─ TTS(en text, voice:fem) → English audio
   │   └─ Real-time streaming via /synthesize/stream
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

```
1. Conference ends (all participants leave)
2. Background job: RecordingCompositor
   ├─ Mux video streams (grid layout)
   ├─ Overlay translated subtitles
   ├─ Sync audio: Bob's voice (vi) + translation (en) on separate tracks
   └─ Output: .mp4 with multilingual audio tracks
3. Generate MeetingMinutes
   ├─ Transcript source: ConversationTurn (with speaker attribution)
   ├─ Call Gemini with transcript + context
   └─ Store MeetingMinutes (summary, key points, action items)
4. Archive: R2 bucket
   ├─ recordings/{meetingId}/{timestamp}.mp4
   └─ transcripts/{meetingId}.jsonl
```

---

## 5. Schema Evolution: Database

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
  embedding BYTEA, -- Speaker embedding (CAM++)
  createdAt TIMESTAMPTZ,
  displayText TEXT, -- searchText equivalent
  FOREIGN KEY (conferenceId) REFERENCES Conference(id),
  FOREIGN KEY (participantId) REFERENCES ConferenceParticipant(id),
  INDEX (conferenceId, createdAt)
);

-- Conference minutes (same as Conversation.MeetingMinutes)
CREATE TABLE ConferenceMeetingMinutes (
  id UUID PRIMARY KEY,
  conferenceId UUID NOT NULL UNIQUE,
  summary TEXT,
  keyPoints TEXT[], -- JSON array
  decisions TEXT[], -- JSON array
  actionItems JSONB, -- [{id, description, owner, dueDate}, ...]
  status ENUM ('never_generated', 'generating', 'completed', 'failed'),
  generatedAt TIMESTAMPTZ,
  FOREIGN KEY (conferenceId) REFERENCES Conference(id)
);
```

---

## 6. Technical Challenges & Solutions

### Challenge 1: Multi-Participant Bandwidth

**Problem:** Video + audio + translation = 10 Mbps per participant × N  
**Solutions:**

- ✅ Simulcast (VP8 multi-bitrate): Client adapts layer per bandwidth
- ✅ SFU (not MCU): API routes streams, doesn't re-encode
- ✅ Client-side rendering: Browser composites grid, not server
- ✅ Selective forwarding: Don't route A→A video

### Challenge 2: Translation Latency

**Problem:** Translate N participants' audio simultaneously in real-time  
**Solution:**

- ✅ Parallel translation: One `TurnSession` per participant (no merge)
- ✅ Live preview: Show translation while speaker continues
- ✅ Speculative decoding: Guess endpoint, move on if wrong
- ✅ Prioritize active speaker: Mute others' translation during interruptions

### Challenge 3: Speaker Attribution Accuracy

**Problem:** Who said what in a crowded room?  
**Solution:**

- ✅ CAM++ embeddings per turn (already built)
- ✅ Optional: voice enrollment (enroll once, match ongoing)
- ✅ Validate: `settings.confirmAttribution: bool` let users correct
- ✅ Consensus: >2 participants' embeddings agree before label sticks

### Challenge 4: Subtitle Synchronization

**Problem:** Subtitles must match audio, lag < 500ms  
**Solutions:**

- ✅ Timestamp every translation with frame time
- ✅ Stream TTS output frame-by-frame (no chunking delay)
- ✅ Client-side buffering: queue frames, play in order
- ✅ Fallback to captions if audio fails (degrade gracefully)

### Challenge 5: Recording Multi-Track Audio

**Problem:** Video recording with separate audio tracks (vi + en + translated)  
**Solutions:**

- ✅ Mux 3 audio tracks into one .mp4 (FFmpeg, Opus codec)
- ✅ Metadata: track language, speaker, offset timestamp
- ✅ Playback: UI lets user select audio track
- ✅ Async job: Don't block meeting end; run compositor in background

### Challenge 6: Database Consistency at Scale

**Problem:** Chat + transcript + metrics written concurrently  
**Solutions:**

- ✅ Prisma `Serializable` isolation on conference writes
- ✅ Separate read path: `ConferenceTurn` is append-only (no contention)
- ✅ Message cache: Redis pubsub for live delivery, DB only for history
- ✅ Metrics: Log lines (JSONL) first, async insert into DB (no failing)

---

## 7. Phased Implementation Roadmap

### Phase 1: Infrastructure (Weeks 1-3)

**Goal:** Build foundation, no video yet

- [ ] Add `packages/video-provider` interface (abstraction layer)
- [ ] Schema: `Conference`, `ConferenceParticipant`, `ConferenceTurn`, `ConferenceMessage`
- [ ] API: Basic CRUD for conferences (`POST /conference`, `GET /conference/{id}`)
- [ ] Redis: Room state cache (participants online, active streams)
- [ ] Tests: In-memory conference store + controller tests
- **Verification:** `pnpm typecheck && pnpm test` pass

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

- [ ] WebRTC SFU (Pion library): ICE, DTLS, RTP
- [ ] Video codec negotiation (VP8 default, H264 fallback)
- [ ] Client: Video capture + send (extend `CapturePump`)
- [ ] Client: Video grid layout (4-up, speaker pinned)
- [ ] Test: Two browsers, video streams visible
- **Verification:** `pnpm --filter web dev` → video grid renders

### Phase 4: Translation in Video (Weeks 9-11)

**Goal:** Audio translation + subtitles in conference

- [ ] Extend `TranslationRouter` for multi-participant
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

- [ ] Extend `MeetingMinutes` for conferences (reuse GeminiSummarizationProvider)
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

## 8. Architecture Diagram: Multi-Participant Flow

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
     │ Translation API (Gemini)│
     │                         │
     │ (Unchanged from Chatofy)│
     └─────────────────────────┘
```

---

## 9. File Structure: New Modules

```
apps/api/src/modules/
├── conference/
│   ├── conference.controller.ts       (POST /conference, GET /{id}, etc.)
│   ├── conference.gateway.ts          (WS /ws/conference/{roomId})
│   ├── conference.module.ts
│   ├── services/
│   │   ├── conference.service.ts      (room lifecycle)
│   │   ├── participant.service.ts     (join/leave)
│   │   ├── meeting-orchestrator.ts    (translate + TTS routing)
│   │   └── stream-router.ts           (who gets what track)
│   ├── session/
│   │   ├── room-session.ts            (room state)
│   │   ├── participant-session.ts     (user state)
│   │   ├── live-subtitle-generator.ts (render translations)
│   │   └── stream-handler.ts          (PCM → translation pipeline)
│   └── store/
│       └── prisma-conference.store.ts
│
├── messaging/
│   ├── message.controller.ts          (POST /messages, GET /messages/{id})
│   ├── message.gateway.ts             (WS events)
│   ├── services/
│   │   └── message.service.ts         (save + translate)
│   └── store/
│       └── prisma-message.store.ts
│
├── recording/
│   ├── recording.service.ts           (composite + encode)
│   ├── transcript-compositor.ts       (overlay subtitles)
│   └── store/
│       └── prisma-recording.store.ts
│
├── video-provider/
│   ├── interfaces/
│   │   ├── video-provider.ts          (abstraction)
│   │   └── codec-factory.ts
│   ├── providers/
│   │   ├── webrtc-provider.ts         (Pion SFU)
│   │   ├── simulcast-config.ts
│   │   └── bandwidth-adaptation.ts
│   └── codecs/
│       ├── vp8-config.ts
│       └── h264-config.ts
│
└── translate/                         (EXTEND, not replace)
    └── session/
        ├── conference-turn-session.ts (per-participant, no merge)
        └── room-translation-router.ts (route to all others)

apps/web/src/
├── app/(app)/conference/
│   ├── [roomId]/
│   │   ├── page.tsx                   (main conference screen)
│   │   └── components/
│   │       ├── video-grid.tsx         (responsive layout)
│   │       ├── participant-list.tsx   (roster)
│   │       ├── chat-panel.tsx         (messages)
│   │       ├── subtitle-overlay.tsx   (translations)
│   │       └── control-bar.tsx        (camera/mic/settings)
│   ├── create/
│   │   └── page.tsx                   (new meeting form)
│   └── utils/
│       ├── video-layout.ts            (grid algorithm)
│       └── rtc-config.ts              (TURN servers)
│
└── hooks/
    ├── use-conference.ts              (conference state)
    ├── use-video-stream.ts            (local video)
    └── use-participant-audio.ts       (remote audio playback)

packages/
├── video-provider/
│   ├── src/
│   │   ├── interfaces/
│   │   ├── providers/
│   │   └── codecs/
│   └── tsconfig.json
│
└── realtime-client/
    └── EXTEND with video track handling
```

---

## 10. Risk Mitigation

| Risk                           | Probability | Impact              | Mitigation                                        |
| ------------------------------ | ----------- | ------------------- | ------------------------------------------------- |
| Video latency > 1s             | HIGH        | Session quality ↓   | Simulcast + adaptive bitrate                      |
| Translation lag delays video   | MEDIUM      | Subtitle mismatch   | Live preview + frame-based timing                 |
| Speaker attribution wrong      | MEDIUM      | Confusion           | User manual override + logging                    |
| Redis outage → room state lost | LOW         | Participants kicked | Checkpoint room state to DB every 5s              |
| Recording composition fails    | LOW         | Lost meeting        | Retry job + alert ops                             |
| N×M translation cost explosion | MEDIUM      | Budget overrun      | Rate limit by conference size, cache translations |

---

## 11. Success Metrics

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

1. **Week 1:** Review + approve architecture
2. **Week 2:** Create implementation plan with detailed task breakdown
3. **Week 3:** Set up video-provider package scaffolding
4. **Week 4:** Begin Phase 1 (infrastructure)

---

## Appendix: Comparison Matrix

### Reuse: Translation Stack

```
Component              Reuse   Effort  Note
Language Registry      100%    0h      No change
Type Contracts         100%    4h      Extend for video events
Provider Abstraction    95%    8h      Add video codec provider
STT/TTS Sidecars       100%    0h      Unchanged
Speaker Attribution    100%    0h      Reuse CAM++ clustering
AI Context             100%    2h      Extend to per-meeting
WebSocket Pipeline      80%    16h     Adapt for multi-participant
```

### Build: Video Conferencing

```
Component              New    Effort  Complexity
WebRTC SFU            YES     40h     🔴 HIGH (Pion library)
Video Grid UI         YES     24h     🟡 MEDIUM
Message Service       YES      8h     🟢 LOW
Recording Compositor  YES     32h     🔴 HIGH (FFmpeg)
Subtitle Overlay      YES     12h     🟡 MEDIUM
Database Schema       YES      4h     🟢 LOW
TOTAL                          164h   = 4-5 weeks (1 eng)
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-09-29
