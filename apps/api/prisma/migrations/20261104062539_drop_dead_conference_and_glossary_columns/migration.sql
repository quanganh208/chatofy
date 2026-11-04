/*
  Warnings:

  - You are about to drop the column `translationContextId` on the `Conference` table. All the data in the column will be lost.
  - You are about to drop the column `audioDurationMs` on the `ConferenceTurn` table. All the data in the column will be lost.
  - You are about to drop the column `audioStartMs` on the `ConferenceTurn` table. All the data in the column will be lost.
  - You are about to drop the column `searchText` on the `ConferenceTurn` table. All the data in the column will be lost.
  - You are about to drop the column `isDefault` on the `Glossary` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "ConferenceTurn_conferenceId_audioStartMs_idx";

-- AlterTable
ALTER TABLE "Conference" DROP COLUMN "translationContextId";

-- AlterTable
ALTER TABLE "ConferenceTurn" DROP COLUMN "audioDurationMs",
DROP COLUMN "audioStartMs",
DROP COLUMN "searchText";

-- AlterTable
ALTER TABLE "Glossary" DROP COLUMN "isDefault";

-- CreateIndex
CREATE INDEX "ConferenceTurn_conferenceId_createdAt_idx" ON "ConferenceTurn"("conferenceId", "createdAt");
