-- Prisma's own diff for this schema change is DROP + ADD with no backfill,
-- because a two-column-to-map reshape is not an ALTER it can express. This
-- migration is hand-written instead: add the map column, backfill it from the
-- two columns it replaces, then drop the columns once every row has been
-- covered. The guard runs BEFORE any column is added, so a row this migration
-- cannot backfill correctly stops the whole migration rather than silently
-- losing a rendering.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "GlossaryTerm" WHERE "vi" = '' OR "en" = '') THEN
    RAISE EXCEPTION 'GlossaryTerm has an empty side; review rows before migrating';
  END IF;
END $$;

ALTER TABLE "GlossaryTerm" ADD COLUMN "terms" JSONB;

UPDATE "GlossaryTerm" SET "terms" = jsonb_build_object('vi', "vi", 'en', "en");

ALTER TABLE "GlossaryTerm" ALTER COLUMN "terms" SET NOT NULL;

ALTER TABLE "GlossaryTerm" DROP COLUMN "vi", DROP COLUMN "en";
