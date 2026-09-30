# Database Schema: Video Conferencing

**Date:** 2026-09-29  
**Scope:** Complete schema for Conference, Participants, Messages, Turns, Recording  
**Decisions:** SFU architecture, 6 participants max, 720p60fps, per-minute billing

---

## 1. Core Tables

### `Conference`

Represents a meeting/call room.

```sql
CREATE TABLE "Conference" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ownerId UUID NOT NULL,

  -- Metadata
  title VARCHAR(256),
  description TEXT,
  startedAt TIMESTAMPTZ,
  endedAt TIMESTAMPTZ,
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Recording
  recordingKey VARCHAR(512), -- R2 path: recordings/{conferenceId}/{timestamp}.mp4
  recordingStatus ENUM('not_requested', 'pending', 'completed', 'failed') DEFAULT 'not_requested',
  recordingSize BIGINT, -- bytes
  recordingDurationMs INT,

  -- AI Context (optional, per-meeting)
  translationContextId UUID, -- FK to TranslationContext (optional)

  -- Billing
  participantCount INT DEFAULT 0,
  durationSeconds INT,
  costEstimateCents INT, -- Calculated: durationSeconds * participantCount * COST_PER_PARTICIPANT_SECOND
  billingStatus ENUM('unpaid', 'paid', 'waived') DEFAULT 'unpaid',

  -- Uniqueness
  @@unique([ownerId, createdAt]) -- Owner can't create 2 meetings in same second (not enforced, just safety)
);

-- Indexes
CREATE INDEX ON "Conference"(ownerId, startedAt DESC);
CREATE INDEX ON "Conference"(ownerId, createdAt DESC);
CREATE INDEX ON "Conference"(recordingStatus) WHERE recordingStatus != 'completed';
```

**Notes:**

- `translationContextId` is optional; if set, all participants share it (per design)
- `costEstimateCents` is calculated post-meeting by the billing job
- `recordingKey` format: `recordings/{conferenceId}/{ISO_TIMESTAMP}.mp4`
- No `participantInvites` column; participants join via room link or code

---

### `ConferenceParticipant`

Each user in a conference.

```sql
CREATE TABLE "ConferenceParticipant" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conferenceId UUID NOT NULL,
  userId UUID NOT NULL,

  -- Presence
  joinedAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  leftAt TIMESTAMPTZ,

  -- Identity
  displayName VARCHAR(256), -- Can differ from User.name (nickname in room)
  avatarUrl VARCHAR(512), -- Snapshot at join time (reuse from User.avatarUrl)

  -- Language & Voice
  sourceLanguage VARCHAR(2) NOT NULL, -- What language they speak (vi, en)
  targetLanguages VARCHAR(2)[], -- What languages they want to hear (derived from conversation.languages)
  voiceGender VARCHAR(16) DEFAULT 'female', -- female | male | neutral (for synthesis)
  voicePresetId VARCHAR(64), -- Preset voice id (e.g., "vieneu-nhân", "kokoro-default")

  -- Audio Quality
  audioLevel FLOAT DEFAULT 1.0, -- [0.0, 1.0] gain adjustment (user's output volume)
  isMuted BOOLEAN DEFAULT FALSE,

  -- Video Quality (SFU: client side bitrate control)
  videoEnabledAtJoin BOOLEAN DEFAULT TRUE,
  preferredBitrateKbps INT DEFAULT 2500, -- Client preference (SFU adapts)

  -- Speaker Attribution
  speakerId UUID, -- Links to speaker ordinal in auto-attribution (see ConferenceSpeaker)
  manualSpeakerOverride BOOLEAN DEFAULT FALSE, -- User corrected auto-attribution

  -- Metrics
  turnCount INT DEFAULT 0, -- Turns spoken by this participant
  messageCount INT DEFAULT 0, -- Chat messages

  -- Uniqueness
  @@unique([conferenceId, userId]) -- One user per room
  FOREIGN KEY (conferenceId) REFERENCES "Conference"(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES "User"(id)
);

-- Indexes
CREATE INDEX ON "ConferenceParticipant"(conferenceId, joinedAt);
CREATE INDEX ON "ConferenceParticipant"(userId); -- Find user's meetings
CREATE INDEX ON "ConferenceParticipant"(speakerId) WHERE speakerId IS NOT NULL;
```

**Notes:**

- `sourceLanguage` is what THEY speak; `targetLanguages` is what they want to hear
- `targetLanguages` is a copy at join time (conference.languages); doesn't update mid-meeting
- `speakerId` is auto-populated by speaker attribution engine
- `voicePresetId` is opaque token from `/translate/voices` (never hardcoded)

---

### `ConferenceSpeaker`

Auto-attributed speaker identities (ordinal-based, per-room).

```sql
CREATE TABLE "ConferenceSpeaker" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conferenceId UUID NOT NULL,

  -- Identity
  ordinal INT NOT NULL, -- 0, 1, 2, ... (rendered as "Speaker 1", "Speaker 2")
  primaryParticipantId UUID, -- FK (may be null if speaker never confirmed)

  -- Attribution Confidence
  embedding BYTEA, -- CAM++ vector (512D, float32) for speaker clustering
  embeddingConfidence FLOAT, -- [0.0, 1.0] how confident is this cluster

  -- History
  firstSeenAt TIMESTAMPTZ DEFAULT NOW(),
  lastSeenAt TIMESTAMPTZ,
  turnCount INT DEFAULT 0,

  FOREIGN KEY (conferenceId) REFERENCES "Conference"(id) ON DELETE CASCADE,
  FOREIGN KEY (primaryParticipantId) REFERENCES "ConferenceParticipant"(id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX ON "ConferenceSpeaker"(conferenceId, ordinal);
CREATE UNIQUE INDEX ON "ConferenceSpeaker"(conferenceId, ordinal); -- One ordinal per room
CREATE INDEX ON "ConferenceSpeaker"(primaryParticipantId);
```

**Notes:**

- `ordinal` is the public label ("Speaker 1", "Speaker 2")
- `primaryParticipantId` null if speaker never joined or was unidentified
- `embedding` is the CAM++ 512D vector; used for clustering new turns
- Auto-attribution updates `embeddingConfidence` on each turn

---

## 2. Translation/Transcript Tables

### `ConferenceTurn`

Each utterance in the conference (parallel to ConversationTurn, never merged).

```sql
CREATE TABLE "ConferenceTurn" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conferenceId UUID NOT NULL,
  speakerId UUID NOT NULL, -- FK to ConferenceSpeaker

  -- Audio
  audioStartMs INT NOT NULL, -- Millisecond offset from conference start
  audioDurationMs INT NOT NULL,
  audioOffsetInRecordingMs INT, -- Offset in final recording (set post-compositing)

  -- Transcription
  sourceLanguage VARCHAR(2) NOT NULL, -- What was spoken
  sourceText TEXT NOT NULL, -- Raw transcript (vi: lowercase, en: sentence-cased)
  sourceTextNormalized TEXT, -- normalizeForSearch() output

  -- Translation
  translations JSONB, -- {vi: "...", en: "...", ...} partial map (keyed by language)
  translationModelUsed VARCHAR(64), -- gemini-3.5-flash-lite, deepseek-flash, etc.
  translationCostMicros INT, -- Estimated API cost (for billing)

  -- Speaker Attribution
  embedding BYTEA, -- CAM++ 512D vector of this turn
  embeddingConfidence FLOAT, -- Cosine similarity to cluster

  -- Display
  displayText TEXT, -- searchText: what the user saw (merges multi-turn)
  isMergedDisplay BOOLEAN DEFAULT FALSE, -- Part of a display group (turns 1-3 show as turn 1)

  -- Metadata
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (conferenceId) REFERENCES "Conference"(id) ON DELETE CASCADE,
  FOREIGN KEY (speakerId) REFERENCES "ConferenceSpeaker"(id) ON DELETE RESTRICT
);

-- Indexes
CREATE INDEX ON "ConferenceTurn"(conferenceId, audioStartMs); -- Query by time
CREATE INDEX ON "ConferenceTurn"(speakerId); -- Query by speaker
CREATE INDEX ON "ConferenceTurn"(createdAt DESC); -- Recent turns
CREATE INDEX ON "ConferenceTurn"(sourceTextNormalized) USING GIN (pg_trgm); -- Trigram search
CREATE INDEX ON "ConferenceTurn"(translations) USING GIN; -- Search translations
```

**Notes:**

- **NO MERGE across participants.** Each turn is independent; route to all others.
- `translations` is a partial map; only keys actually translated are present
- `sourceTextNormalized` for search (diacritic-insensitive, lowercase)
- `audioStartMs` is relative to conference start, NOT to participant join
- `displayText` is used for search; kept in sync by client-side display-group merge

---

### `ConferenceSubtitle` (Optional, for rendering performance)

Cache of rendered subtitles (if real-time rendering is slow).

```sql
CREATE TABLE "ConferenceSubtitle" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conferenceId UUID NOT NULL,
  turnId UUID NOT NULL,

  -- Target participant
  participantId UUID NOT NULL,

  -- Content
  targetLanguage VARCHAR(2) NOT NULL,
  translatedText TEXT NOT NULL, -- The subtitle to show

  -- Timing
  startMs INT NOT NULL,
  endMs INT NOT NULL,

  FOREIGN KEY (conferenceId) REFERENCES "Conference"(id) ON DELETE CASCADE,
  FOREIGN KEY (turnId) REFERENCES "ConferenceTurn"(id) ON DELETE CASCADE,
  FOREIGN KEY (participantId) REFERENCES "ConferenceParticipant"(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX ON "ConferenceSubtitle"(conferenceId, startMs, endMs); -- Render query
```

**Notes:**

- Optional table; omit if rendering in real-time is fast enough
- Useful for pre-computing subtitles for recording playback

---

## 3. Messaging Tables

### `ConferenceMessage`

Chat messages during the conference.

```sql
CREATE TABLE "ConferenceMessage" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conferenceId UUID NOT NULL,
  participantId UUID NOT NULL,

  -- Content
  text TEXT NOT NULL,
  sourceLanguage VARCHAR(2) NOT NULL,

  -- Attachments (optional)
  attachments JSONB, -- [{type: "image", url: "...", size: ...}, ...]

  -- Metadata
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (conferenceId) REFERENCES "Conference"(id) ON DELETE CASCADE,
  FOREIGN KEY (participantId) REFERENCES "ConferenceParticipant"(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX ON "ConferenceMessage"(conferenceId, createdAt DESC);
CREATE INDEX ON "ConferenceMessage"(participantId);
```

**Notes:**

- No edit/delete; messages are immutable (set createdAt, no updatedAt)
- `sourceLanguage` is the author's language (for auto-translation opt-in)
- Search is optional; use `text` directly without `pg_trgm` unless high volume

---

### `ConferenceMessageTranslation` (Optional, cached)

Auto-translated versions of messages.

```sql
CREATE TABLE "ConferenceMessageTranslation" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  messageId UUID NOT NULL,

  -- Translation
  targetLanguage VARCHAR(2) NOT NULL,
  translatedText TEXT NOT NULL,

  FOREIGN KEY (messageId) REFERENCES "ConferenceMessage"(id) ON DELETE CASCADE,
  @@unique([messageId, targetLanguage])
);
```

**Notes:**

- Only created if message translation is opt-in and user requests
- Cached; re-translation only on explicit user action

---

## 4. Recording & Metadata

### `ConferenceRecording`

Metadata for a completed recording.

```sql
CREATE TABLE "ConferenceRecording" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conferenceId UUID NOT NULL UNIQUE,

  -- Storage
  s3Key VARCHAR(512), -- recordings/{conferenceId}/{timestamp}.mp4
  s3Bucket VARCHAR(64) DEFAULT 'chatofy-prod',

  -- Video Properties
  videoCodec VARCHAR(32), -- vp8, h264
  widthPx INT DEFAULT 1280,
  heightPx INT DEFAULT 720,
  fpsNum INT DEFAULT 60,
  bitrateMbps FLOAT DEFAULT 2.5,

  -- Audio Tracks
  audioTracks JSONB, -- [{lang: "vi", speakerId: UUID, codec: "opus"}, {lang: "en", ...}]
  audioSampleRate INT DEFAULT 16000,

  -- Duration
  videoLengthMs INT,

  -- Status & Errors
  status ENUM('pending', 'compositing', 'completed', 'failed') DEFAULT 'pending',
  errorMessage TEXT,

  -- Metadata
  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  startedAt TIMESTAMPTZ,
  completedAt TIMESTAMPTZ,

  FOREIGN KEY (conferenceId) REFERENCES "Conference"(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX ON "ConferenceRecording"(status) WHERE status != 'completed';
CREATE INDEX ON "ConferenceRecording"(createdAt DESC);
```

**Notes:**

- Async job populates this after conference ends
- `audioTracks` is JSONB for flexibility (future: multiple TTS languages)
- `s3Key` is the source of truth (not URL); URL composed at response time

---

## 5. Billing & Analytics

### `ConferenceBillingLine`

Per-conference billing record.

```sql
CREATE TABLE "ConferenceBillingLine" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conferenceId UUID NOT NULL UNIQUE,
  ownerId UUID NOT NULL,

  -- Metrics
  participantCount INT,
  durationSeconds INT,

  -- Costs (all in cents USD)
  sttCostCents INT, -- STT API cost (Deepgram, etc.)
  translationCostCents INT, -- Gemini API cost
  ttsCostCents INT, -- TTS API cost (if using cloud)
  recordingStorageCostCents INT, -- R2 storage

  -- Rate Card
  costPerParticipantMinute INT, -- Your rate (cents)
  baseChargeCents INT, -- Calculated: costPerParticipantMinute * participantCount * durationSeconds / 60

  -- Payment
  status ENUM('unbilled', 'billed', 'paid', 'waived') DEFAULT 'unbilled',
  invoiceId VARCHAR(256), -- Link to payment processor

  createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  billedAt TIMESTAMPTZ,

  FOREIGN KEY (conferenceId) REFERENCES "Conference"(id),
  FOREIGN KEY (ownerId) REFERENCES "User"(id)
);

-- Indexes
CREATE INDEX ON "ConferenceBillingLine"(ownerId, billedAt DESC);
CREATE INDEX ON "ConferenceBillingLine"(status) WHERE status != 'paid';
```

**Notes:**

- `baseChargeCents` = cost per participant-minute × participants × duration
- Additional costs (STT, TTS) summed separately for analytics
- Reuse `PostgREST` or create a billing service endpoint to list user's charges

---

## 6. AI Context (Reuse from Conversation)

### Extend `TranslationContext`

Already exists; reuse for per-meeting context.

```sql
-- EXISTING: TranslationContext
CREATE TABLE "TranslationContext" (
  id UUID PRIMARY KEY,
  ownerId UUID NOT NULL,
  clientId VARCHAR(256), -- Browser-minted UUID
  name VARCHAR(256),
  -- ... glossary, hotwords, etc.
);

-- Reference it in Conference:
ALTER TABLE "Conference"
ADD COLUMN translationContextId UUID,
ADD FOREIGN KEY (translationContextId) REFERENCES "TranslationContext"(id);
```

**Usage:** Conference.translationContextId → shared by all participants

---

## 7. Constraints & Uniqueness

### Enforced Constraints

```sql
-- One user per conference
@@unique([conferenceId, userId]) ON ConferenceParticipant

-- One translation per message per language
@@unique([messageId, targetLanguage]) ON ConferenceMessageTranslation

-- One recording per conference
@@unique([conferenceId]) ON ConferenceRecording

-- One billing line per conference
@@unique([conferenceId]) ON ConferenceBillingLine
```

### Business Rules (App Logic)

```
1. ConferenceParticipant.sourceLanguage must be in Conference.languages
2. ConferenceParticipant.targetLanguages ⊆ Conference.languages
3. ConferenceTurn.sourceLanguage must match ConferenceParticipant.sourceLanguage
4. ConferenceSpeaker.ordinal < 6 (max participants decision)
5. Recording.status='completed' ⟹ Conference.recordingKey IS NOT NULL
6. ConferenceBillingLine.status='billed' ⟹ Conference.endedAt IS NOT NULL
```

---

## 8. Data Retention & Cleanup

### Archive Policy

```
Retention Period:
├─ Active conference:       7 days (keep live subtitles in memory)
├─ Ended, pre-summary:      30 days (generate minutes async)
├─ Completed + summary:     90 days (archive to cold storage)
└─ Deleted by user:         0 days (hard delete immediately)

Cleanup Query (monthly):
DELETE FROM "ConferenceMessage" WHERE conferenceId IN (
  SELECT id FROM "Conference"
  WHERE endedAt < NOW() - INTERVAL '90 days'
  AND recordingStatus = 'completed'
);

Archive Recording:
├─ Move `recordings/{id}.mp4` from R2 → Glacier (AWS)
├─ Keep metadata in DB, update s3Key → glacier://...
├─ User retrieves via presigned URL (48hr validity)
```

---

## 9. Migration Strategy

### Initial Migration (Week 1)

```sql
-- Phase 1: Create all new tables (no FK yet)
CREATE TABLE "Conference" (...);
CREATE TABLE "ConferenceParticipant" (...);
... etc

-- Phase 2: Add FKs
ALTER TABLE "ConferenceParticipant" ADD CONSTRAINT fk_conference FOREIGN KEY (...);
... etc

-- Phase 3: Create indexes
CREATE INDEX ON "Conference"(ownerId, startedAt DESC);
... etc

-- Phase 4: Add GIN index for full-text search (may take time)
CREATE INDEX ON "ConferenceTurn"(sourceTextNormalized) USING GIN (pg_trgm);
```

### Prisma Schema Fragment

```prisma
model Conference {
  id              String   @id @default(dbgenerated("gen_random_uuid()"))
  ownerId         String
  title           String?  @db.VarChar(256)
  description     String?
  startedAt       DateTime?
  endedAt         DateTime?
  createdAt       DateTime @default(now())

  recordingKey    String?  @db.VarChar(512)
  recordingStatus String   @default("not_requested") // enum
  recordingSize   BigInt?

  translationContextId String? // FK

  participants    ConferenceParticipant[]
  turns           ConferenceTurn[]
  messages        ConferenceMessage[]
  recording       ConferenceRecording?
  billing         ConferenceBillingLine?
  speakers        ConferenceSpeaker[]

  @@index([ownerId, startedAt(sort: Desc)])
  @@index([ownerId, createdAt(sort: Desc)])
}

model ConferenceParticipant {
  id              String   @id @default(dbgenerated("gen_random_uuid()"))
  conferenceId    String
  userId          String

  joinedAt        DateTime @default(now())
  leftAt          DateTime?

  displayName     String?  @db.VarChar(256)
  sourceLanguage  String   @db.VarChar(2)
  targetLanguages String[] @default([])
  voiceGender     String   @default("female") @db.VarChar(16)
  voicePresetId   String?  @db.VarChar(64)

  isMuted         Boolean  @default(false)
  speakerId       String?

  turnCount       Int      @default(0)
  messageCount    Int      @default(0)

  conference      Conference @relation(fields: [conferenceId], references: [id], onDelete: Cascade)
  user            User       @relation(fields: [userId], references: [id])
  speaker         ConferenceSpeaker? @relation(fields: [speakerId], references: [id])
  messages        ConferenceMessage[]

  @@unique([conferenceId, userId])
  @@index([conferenceId, joinedAt])
  @@index([userId])
}

// ... (repeat for other models)
```

---

## 10. Query Examples

### Get conference transcript for summary

```sql
SELECT
  t.id,
  s.ordinal AS speaker_ordinal,
  t.sourceText,
  t.translations->>'en' AS translatedToEnglish,
  t.audioStartMs,
  t.audioDurationMs
FROM "ConferenceTurn" t
JOIN "ConferenceSpeaker" s ON t.speakerId = s.id
WHERE t.conferenceId = $1
ORDER BY t.audioStartMs;
```

### Find user's past meetings

```sql
SELECT DISTINCT c.*
FROM "Conference" c
JOIN "ConferenceParticipant" cp ON c.id = cp.conferenceId
WHERE cp.userId = $1 AND c.endedAt IS NOT NULL
ORDER BY c.endedAt DESC
LIMIT 20;
```

### Search transcript for a keyword

```sql
SELECT DISTINCT c.id, c.title
FROM "ConferenceTurn" t
JOIN "Conference" c ON t.conferenceId = c.id
WHERE c.ownerId = $1
AND t.sourceTextNormalized % $2 -- pg_trgm similarity
ORDER BY t.audioStartMs;
```

### Calculate costs for a meeting

```sql
SELECT
  c.id,
  COUNT(DISTINCT cp.id) AS participant_count,
  EXTRACT(EPOCH FROM (c.endedAt - c.startedAt)) / 60 AS duration_minutes,
  (EXTRACT(EPOCH FROM (c.endedAt - c.startedAt)) / 60) * COUNT(DISTINCT cp.id) * $1 AS estimated_cost_cents
FROM "Conference" c
LEFT JOIN "ConferenceParticipant" cp ON c.id = cp.conferenceId
WHERE c.id = $2
GROUP BY c.id;
```

---

## 11. Normalization & Dependencies

| Table                        | Depends On                                        | Key FK                                        |
| ---------------------------- | ------------------------------------------------- | --------------------------------------------- |
| Conference                   | User                                              | ownerId                                       |
| ConferenceParticipant        | Conference, User, TranslationContext              | conferenceId, userId                          |
| ConferenceSpeaker            | Conference, ConferenceParticipant                 | conferenceId, primaryParticipantId (nullable) |
| ConferenceTurn               | Conference, ConferenceSpeaker                     | conferenceId, speakerId                       |
| ConferenceMessage            | Conference, ConferenceParticipant                 | conferenceId, participantId                   |
| ConferenceMessageTranslation | ConferenceMessage                                 | messageId                                     |
| ConferenceSubtitle           | Conference, ConferenceTurn, ConferenceParticipant | conferenceId, turnId, participantId           |
| ConferenceRecording          | Conference                                        | conferenceId (unique)                         |
| ConferenceBillingLine        | Conference, User                                  | conferenceId, ownerId                         |

**Circular dependencies:** None (clean DAG)

---

## 12. Performance Considerations

### Indexes for Common Queries

| Query Pattern            | Index                                                      |
| ------------------------ | ---------------------------------------------------------- |
| "Get recent conferences" | `Conference(ownerId, startedAt DESC)`                      |
| "Get participant list"   | `ConferenceParticipant(conferenceId, joinedAt)`            |
| "Search transcript"      | `ConferenceTurn(sourceTextNormalized) USING GIN (pg_trgm)` |
| "Get speaker's turns"    | `ConferenceTurn(speakerId)`                                |
| "Get messages in order"  | `ConferenceMessage(conferenceId, createdAt DESC)`          |
| "Find failed recordings" | `ConferenceRecording(status)` WHERE status != 'completed'  |

### Partition Strategy (Optional, for scale)

```sql
-- If conference table grows > 100M rows, partition by ownerId
CREATE TABLE "Conference_Partitioned" (
  ...
) PARTITION BY HASH (ownerId) PARTITIONS 256;
```

---

## Appendix: Comparison to ConversationTurn

| Field               | ConversationTurn          | ConferenceTurn                  | Reason                             |
| ------------------- | ------------------------- | ------------------------------- | ---------------------------------- |
| Merge strategy      | One direction (merge all) | No merge (one per speaker)      | Multi-participant, no merge        |
| Participant         | Session-scoped (2 users)  | Multi-participant (6 max)       | Routing change                     |
| Speaker attribution | Optional (future)         | Mandatory + embedding           | Conference identifies all speakers |
| Audio offset        | Relative to upload        | Relative to conference start    | Recording sync                     |
| Translation targets | One (targetLanguage)      | Multiple (each listener's lang) | Fan-out architecture               |

---

**Document Version:** 1.0  
**Last Updated:** 2026-09-29
