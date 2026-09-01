-- CreateTable
CREATE TABLE "GlossaryTerm" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "vi" TEXT NOT NULL,
    "en" TEXT NOT NULL,
    "keepVerbatim" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlossaryTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlossaryTerm_ownerId_idx" ON "GlossaryTerm"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "GlossaryTerm_ownerId_vi_en_key" ON "GlossaryTerm"("ownerId", "vi", "en");
