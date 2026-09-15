-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "audioDurationMs" INTEGER,
ADD COLUMN     "audioKey" TEXT,
ADD COLUMN     "audioOffsetMs" INTEGER;

-- AlterTable
ALTER TABLE "ConversationTurn" ADD COLUMN     "offsetMs" INTEGER;
