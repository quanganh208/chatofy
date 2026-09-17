-- Baseline: the whole schema, as one migration.
--
-- This replaces ten migrations that built it incrementally between 2026-08-23
-- and 2026-09-14. Their end state is reproduced here EXACTLY -- verified by
-- applying both chains to empty databases and diffing `pg_dump --schema-only`
-- output, not by reading them side by side. What is gone is only the path
-- taken: a `preferredLanguage` column added and dropped a day later in favour
-- of `locale`, `MeetingMinutes` created keyed by a browser-minted session id
-- and re-parented onto `Conversation` a week on, and a backfill over a table
-- that had been created three migrations earlier in the same release and so
-- never held a row for it to touch.
--
-- Two of those steps guarded themselves at the time and are not carried over,
-- because the conditions they guarded no longer exist: the re-key raised unless
-- `MeetingMinutes` was empty, and it has since run on every database this
-- project has. A baseline creates the table empty. There is nothing left to
-- assert.
--
-- `unaccent` is NOT created here, and the omission is deliberate. It was only
-- ever used by that one backfill, to fold rows written before `searchText`
-- existed. Nothing queries through it: `normalizeForSearch` in @chatofy/types
-- is the single fold, applied by the write path and the query path alike
-- (`prisma-conversation.store.ts`), which is what makes the match work in both
-- directions. A database created from this baseline will not have the
-- extension, and nothing reads it.

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
    "direction" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "audioKey" TEXT,
    "audioOffsetMs" INTEGER,
    "audioDurationMs" INTEGER,

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
    "targetText" TEXT NOT NULL,
    "searchText" TEXT,
    "offsetMs" INTEGER,

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinutesActionItem" ADD CONSTRAINT "MinutesActionItem_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "MeetingMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

