-- Re-key MeetingMinutes onto Conversation.
--
-- Every existing row is keyed by (ownerId, sessionId) where sessionId is a UUID
-- the web client minted PER COMPONENT MOUNT and discarded on reload. No shipped
-- client can address one again, and synthesizing a parent conversation would
-- mean inventing timestamps and an empty transcript. So the rows are deleted
-- rather than migrated.
--
-- The expected count is zero: the minutes store defaulted to in-memory and no
-- deployment ever selected the Postgres one. But "expected zero" is not the same
-- as "verified zero", and `prisma migrate deploy` reports migration NAMES, not
-- per-statement row counts — the deploy step checks only the exit code, so a
-- non-empty table would be destroyed silently and nobody would learn of it.
--
-- Hence the guard. It aborts the migration non-zero, which the deploy DOES
-- observe, leaving the previous stack serving. Recovery: pg_restore the dump
-- taken immediately before this ran, then decide what the rows were worth.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "MeetingMinutes") THEN
    RAISE EXCEPTION 'MeetingMinutes is not empty; the re-key assumed zero rows';
  END IF;
END $$;

DELETE FROM "MeetingMinutes";

-- DropIndex
DROP INDEX "MeetingMinutes_ownerId_sessionId_key";

-- AlterTable
ALTER TABLE "MeetingMinutes" DROP COLUMN "ownerId",
DROP COLUMN "sessionId",
ADD COLUMN     "conversationId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "MeetingMinutes_conversationId_key" ON "MeetingMinutes"("conversationId");

-- AddForeignKey
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
