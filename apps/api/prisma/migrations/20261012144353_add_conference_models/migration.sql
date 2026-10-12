-- CreateTable
CREATE TABLE "Conference" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "translationContextId" TEXT,
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
    "searchText" TEXT,
    "translations" JSONB,
    "audioStartMs" INTEGER,
    "audioDurationMs" INTEGER,
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

-- CreateIndex
CREATE INDEX "Conference_ownerId_createdAt_idx" ON "Conference"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ConferenceParticipant_conferenceId_idx" ON "ConferenceParticipant"("conferenceId");

-- CreateIndex
CREATE INDEX "ConferenceParticipant_userId_idx" ON "ConferenceParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ConferenceParticipant_conferenceId_userId_key" ON "ConferenceParticipant"("conferenceId", "userId");

-- CreateIndex
CREATE INDEX "ConferenceTurn_conferenceId_audioStartMs_idx" ON "ConferenceTurn"("conferenceId", "audioStartMs");

-- CreateIndex
CREATE INDEX "ConferenceTurn_participantId_idx" ON "ConferenceTurn"("participantId");

-- CreateIndex
CREATE INDEX "ConferenceMessage_conferenceId_createdAt_idx" ON "ConferenceMessage"("conferenceId", "createdAt" DESC);

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
