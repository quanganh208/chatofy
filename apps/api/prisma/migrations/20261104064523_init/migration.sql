-- Baseline: the whole schema, as one migration.
--
-- This replaces eleven migrations that built the schema between 2026-09-17 and
-- 2026-11-04, starting from the previous baseline (itself a squash of ten
-- earlier ones). The end state is reproduced EXACTLY: both chains were applied
-- to empty databases and their `pg_dump --schema-only` output compared, rather
-- than read side by side. Only the path is gone: the per-language glossary
-- columns folded into `terms`, the `direction` column replaced by `languages`,
-- and the conference columns that were added and later dropped unused. Their
-- data backfills are not carried over: a database built from this baseline
-- starts empty, so there is nothing for them to rewrite.
--
-- On a database that already has the old chain recorded, this file must never
-- be APPLIED. Replace the ledger and leave the tables alone; README.md
-- ("If `migrate deploy` refuses on a database you already had") has the commands.

-- Column order and the NOT NULL on the two language arrays are written to match
-- the old chain, not what `prisma migrate diff` emits: Prisma compares neither,
-- and the old chain added `languages` / `sourceLanguages` NOT NULL by hand after
-- a backfill. With them, a fresh database's `pg_dump --schema-only` is identical
-- to the old chain's. Production, compared the same way, matches in every type,
-- constraint and index; it differs only in column order on `User`,
-- `Conversation` and `MeetingMinutes` (history from before the first squash) and
-- in carrying `pgcrypto`, `unaccent` and `uuid-ossp`, which nothing uses.

-- `pg_trgm` IS required, and must exist before the GIN index below that names
-- `gin_trgm_ops`. It is created in migration SQL rather than declared on the
-- datasource because the `extensions = [...]` form is deprecated as of Prisma
-- 6.16 and this repo is on 7. `postgres:16-alpine` -- what both compose files
-- and the CI service run -- ships contrib, so this succeeds there.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "googleSub" TEXT,
    "passwordChangedAt" TIMESTAMP(3),
    "locale" TEXT NOT NULL DEFAULT 'en',
    "avatarKey" TEXT,
    "avatarChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingMinutes" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "keyPoints" TEXT[],
    "decisions" TEXT[],
    "generatedAt" TIMESTAMP(3),
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingMinutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinutesActionItem" (
    "id" TEXT NOT NULL,
    "minutesId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner" TEXT,
    "dueDate" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "MinutesActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "audioKey" TEXT,
    "audioOffsetMs" INTEGER,
    "audioDurationMs" INTEGER,
    "languages" TEXT[] NOT NULL,
    "pausedMs" INTEGER NOT NULL DEFAULT 0,
    "mode" TEXT,
    "searchTitle" TEXT,
    "title" TEXT,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "speakerRole" TEXT NOT NULL,
    "speakerLabel" TEXT,
    "sourceText" TEXT NOT NULL,
    "displayText" TEXT,
    "searchText" TEXT,
    "offsetMs" INTEGER,
    "sourceLanguages" TEXT[] NOT NULL,
    "translations" JSONB NOT NULL,

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationContext" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT,
    "hotwords" TEXT[],
    "style" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "glossaryId" TEXT,

    CONSTRAINT "TranslationContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlossaryTerm" (
    "id" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "terms" JSONB NOT NULL,

    CONSTRAINT "GlossaryTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conference" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenceParticipant" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT,
    "sourceLanguage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'joined',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "ConferenceParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenceTurn" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "sourceLanguage" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "translations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConferenceTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenceMessage" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sourceLanguage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConferenceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenceMinutes" (
    "id" TEXT NOT NULL,
    "conferenceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "keyPoints" TEXT[],
    "decisions" TEXT[],
    "generatedAt" TIMESTAMP(3),
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConferenceMinutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenceMinutesActionItem" (
    "id" TEXT NOT NULL,
    "minutesId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner" TEXT,
    "dueDate" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ConferenceMinutesActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Glossary" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceLang" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Glossary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlossaryItem" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "glossaryId" TEXT NOT NULL,
    "original" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlossaryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingMinutes_conversationId_key" ON "MeetingMinutes"("conversationId");

-- CreateIndex
CREATE INDEX "MinutesActionItem_minutesId_idx" ON "MinutesActionItem"("minutesId");

-- CreateIndex
CREATE INDEX "Conversation_ownerId_createdAt_idx" ON "Conversation"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_ownerId_clientId_key" ON "Conversation"("ownerId", "clientId");

-- CreateIndex
CREATE INDEX "ConversationTurn_searchText_idx" ON "ConversationTurn" USING GIN ("searchText" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_conversationId_position_key" ON "ConversationTurn"("conversationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationContext_ownerId_clientId_key" ON "TranslationContext"("ownerId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "GlossaryTerm_contextId_position_key" ON "GlossaryTerm"("contextId", "position");

-- CreateIndex
CREATE INDEX "Conference_ownerId_createdAt_idx" ON "Conference"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ConferenceParticipant_userId_idx" ON "ConferenceParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConferenceParticipant_conferenceId_userId_key" ON "ConferenceParticipant"("conferenceId", "userId");

-- CreateIndex
CREATE INDEX "ConferenceTurn_conferenceId_createdAt_idx" ON "ConferenceTurn"("conferenceId", "createdAt");

-- CreateIndex
CREATE INDEX "ConferenceTurn_participantId_idx" ON "ConferenceTurn"("participantId");

-- CreateIndex
CREATE INDEX "ConferenceMessage_conferenceId_createdAt_idx" ON "ConferenceMessage"("conferenceId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ConferenceMinutes_conferenceId_key" ON "ConferenceMinutes"("conferenceId");

-- CreateIndex
CREATE INDEX "ConferenceMinutesActionItem_minutesId_idx" ON "ConferenceMinutesActionItem"("minutesId");

-- CreateIndex
CREATE UNIQUE INDEX "Glossary_ownerId_clientId_key" ON "Glossary"("ownerId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "GlossaryItem_glossaryId_clientId_key" ON "GlossaryItem"("glossaryId", "clientId");

-- AddForeignKey
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinutesActionItem" ADD CONSTRAINT "MinutesActionItem_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "MeetingMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationContext" ADD CONSTRAINT "TranslationContext_glossaryId_fkey" FOREIGN KEY ("glossaryId") REFERENCES "Glossary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlossaryTerm" ADD CONSTRAINT "GlossaryTerm_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "TranslationContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceParticipant" ADD CONSTRAINT "ConferenceParticipant_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceTurn" ADD CONSTRAINT "ConferenceTurn_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceTurn" ADD CONSTRAINT "ConferenceTurn_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ConferenceParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceMessage" ADD CONSTRAINT "ConferenceMessage_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceMessage" ADD CONSTRAINT "ConferenceMessage_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "ConferenceParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceMinutes" ADD CONSTRAINT "ConferenceMinutes_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceMinutesActionItem" ADD CONSTRAINT "ConferenceMinutesActionItem_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "ConferenceMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Glossary" ADD CONSTRAINT "Glossary_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlossaryItem" ADD CONSTRAINT "GlossaryItem_glossaryId_fkey" FOREIGN KEY ("glossaryId") REFERENCES "Glossary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

