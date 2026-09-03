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

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversation_ownerId_createdAt_idx" ON "Conversation"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_ownerId_clientId_key" ON "Conversation"("ownerId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_conversationId_position_key" ON "ConversationTurn"("conversationId", "position");

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
