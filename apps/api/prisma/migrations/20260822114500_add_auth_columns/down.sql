-- Hand-written reverse of migration.sql. Prisma Migrate has no down mechanism,
-- so reverting the code without running this leaves the database ahead of the
-- schema; `prisma migrate dev` then offers to resolve that drift by RESETTING,
-- which cascades through ConversationSession and TranscriptSegment.
--
-- Apply with: psql "$DATABASE_URL" -f down.sql
-- Then delete this migration directory so the history matches the database.

-- DropIndex
DROP INDEX "User_googleSub_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "googleSub",
DROP COLUMN "passwordHash";
