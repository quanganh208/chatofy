-- Diacritic-insensitive history search: "hop" finds "họp".
--
-- The index matches a NORMALIZED copy of each turn's text — no diacritics, lower
-- case — and the query term is folded the same way before it is matched, which
-- makes the match work in both directions. Indexing the raw columns would match
-- a term only when it was spelled with exactly the same accents.
--
-- `unaccent` is needed only for the backfill below. Everything written afterwards
-- is normalized by `normalizeForSearch` in @chatofy/types, which is the single
-- implementation the write path and the query path share. The two folds agree on
-- VIETNAMESE, which is all this app stores: `unaccent` maps đ → d and Đ → D
-- exactly as the JS mapping does (verified against `unaccent('Đường Đi')` →
-- 'Duong Di'). They are not equivalent in general — Postgres `unaccent.rules`
-- also folds ß → ss, æ → ae, ø → o and ł → l, while stripping combining marks
-- after NFD leaves all four unchanged.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- AlterTable
ALTER TABLE "ConversationTurn" ADD COLUMN     "searchText" TEXT;

-- Backfill, for rows written before this column existed: they would otherwise be
-- unsearchable, with no signal in the row to say why.
--
-- On any real deployment this UPDATE touches ZERO rows. `ConversationTurn` is
-- created three migrations earlier in this same release, so no deployment ever
-- ran with the table and without the column. It matters only for a development
-- database that applied the earlier migrations on their own.
UPDATE "ConversationTurn"
SET "searchText" = lower(
  unaccent(
    coalesce("displayText", '') || ' ' || "sourceText" || ' ' || "targetText"
  )
);

-- CreateIndex
CREATE INDEX "ConversationTurn_searchText_idx" ON "ConversationTurn" USING GIN ("searchText" gin_trgm_ops);
