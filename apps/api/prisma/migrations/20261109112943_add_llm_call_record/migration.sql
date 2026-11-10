-- CreateTable
CREATE TABLE "LlmCallRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "kind" TEXT NOT NULL,
    "purpose" TEXT,
    "host" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "ms" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "promptHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmCallRecord_userId_createdAt_idx" ON "LlmCallRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LlmCallRecord_sessionId_idx" ON "LlmCallRecord"("sessionId");
