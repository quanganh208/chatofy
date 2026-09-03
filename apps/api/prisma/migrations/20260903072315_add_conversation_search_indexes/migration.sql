-- Trigram search over the stored transcript.
--
-- The extension is created HERE rather than declared on the datasource: the
-- `extensions = [...]` form is deprecated as of Prisma 6.16 and this repo is on
-- 7. `postgres:16-alpine` — what both compose files and the CI service run —
-- ships contrib, so this succeeds there. A managed Postgres without pg_trgm
-- fails on THIS migration rather than on the one that creates history, which is
-- the point of keeping them separate.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "ConversationTurn_sourceText_idx" ON "ConversationTurn" USING GIN ("sourceText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ConversationTurn_displayText_idx" ON "ConversationTurn" USING GIN ("displayText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ConversationTurn_targetText_idx" ON "ConversationTurn" USING GIN ("targetText" gin_trgm_ops);
