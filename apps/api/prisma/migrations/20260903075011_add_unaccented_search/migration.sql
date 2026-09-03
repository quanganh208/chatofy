-- Diacritic-insensitive history search: "hop" finds "họp".
--
-- The previous three trigram indexes matched the raw columns, so a term only
-- matched text spelled with exactly the same accents. This replaces them with one
-- index over a NORMALIZED copy of the same text — no diacritics, lower case — and
-- the query term is folded the same way before it is matched, which makes the
-- match work in both directions.
--
-- `unaccent` is needed only for the one-time backfill below. Everything written
-- afterwards is normalized by `normalizeForSearch` in @chatofy/types, which is the
-- single implementation the write path and the query path share. The two agree on
-- Vietnamese: `unaccent` maps đ → d and Đ → D exactly as the JS mapping does
-- (verified against `unaccent('Đường Đi')` → 'Duong Di').
CREATE EXTENSION IF NOT EXISTS unaccent;

-- AlterTable
ALTER TABLE "ConversationTurn" ADD COLUMN     "searchText" TEXT;

-- Backfill. Rows written before this column existed would otherwise be
-- unsearchable, and there is no signal in the row to say why.
UPDATE "ConversationTurn"
SET "searchText" = lower(
  unaccent(
    coalesce("displayText", '') || ' ' || "sourceText" || ' ' || "targetText"
  )
);

-- DropIndex
DROP INDEX "ConversationTurn_displayText_idx";

-- DropIndex
DROP INDEX "ConversationTurn_sourceText_idx";

-- DropIndex
DROP INDEX "ConversationTurn_targetText_idx";

-- CreateIndex
CREATE INDEX "ConversationTurn_searchText_idx" ON "ConversationTurn" USING GIN ("searchText" gin_trgm_ops);
