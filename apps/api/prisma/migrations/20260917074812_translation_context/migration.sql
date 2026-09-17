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

    CONSTRAINT "TranslationContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlossaryTerm" (
    "id" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "vi" TEXT NOT NULL,
    "en" TEXT NOT NULL,

    CONSTRAINT "GlossaryTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TranslationContext_ownerId_clientId_key" ON "TranslationContext"("ownerId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "GlossaryTerm_contextId_position_key" ON "GlossaryTerm"("contextId", "position");

-- AddForeignKey
ALTER TABLE "GlossaryTerm" ADD CONSTRAINT "GlossaryTerm_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "TranslationContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;
