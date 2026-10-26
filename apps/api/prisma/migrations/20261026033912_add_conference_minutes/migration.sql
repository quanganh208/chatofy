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

-- CreateIndex
CREATE UNIQUE INDEX "ConferenceMinutes_conferenceId_key" ON "ConferenceMinutes"("conferenceId");

-- CreateIndex
CREATE INDEX "ConferenceMinutesActionItem_minutesId_idx" ON "ConferenceMinutesActionItem"("minutesId");

-- AddForeignKey
ALTER TABLE "ConferenceMinutes" ADD CONSTRAINT "ConferenceMinutes_conferenceId_fkey" FOREIGN KEY ("conferenceId") REFERENCES "Conference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConferenceMinutesActionItem" ADD CONSTRAINT "ConferenceMinutesActionItem_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "ConferenceMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
