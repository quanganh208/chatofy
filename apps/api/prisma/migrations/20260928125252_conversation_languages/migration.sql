-- Destructive: run inside the migration window in docs/deployment-guide.md
-- (stop api/web, migrate, up), behind a pg_dump taken immediately before it.
--
-- Guard first, before any DDL, on the squashed rekey_meeting_minutes pattern:
-- abort loudly on a value neither backfill branch below can handle, rather than
-- silently mis-deriving a language pair or a translation from it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Conversation" WHERE direction NOT IN ('vi_to_en','en_to_vi'))
    THEN RAISE EXCEPTION 'unknown Conversation.direction; review before migrating'; END IF;
  IF EXISTS (SELECT 1 FROM "ConversationTurn" WHERE "speakerRole" NOT IN ('speaker_a','speaker_b'))
    THEN RAISE EXCEPTION 'unknown ConversationTurn.speakerRole; review before migrating'; END IF;
END $$;

-- Conversation.languages replaces direction, declared source first: 'vi_to_en'
-- becomes ['vi','en'] and 'en_to_vi' becomes ['en','vi'] — the pair
-- `legacyDirectionOf` (@chatofy/types) derives the old value back from, on
-- every read, rather than storing it twice.
ALTER TABLE "Conversation" ADD COLUMN "languages" TEXT[];
UPDATE "Conversation" SET "languages" = CASE direction
  WHEN 'vi_to_en' THEN ARRAY['vi','en']
  ELSE ARRAY['en','vi']
END;
ALTER TABLE "Conversation" ALTER COLUMN "languages" SET NOT NULL, DROP COLUMN "direction";

-- ConversationTurn.sourceLanguages/translations replace targetText. Backfilled
-- PER TURN from speakerRole, not from the parent's direction: speaker_a is
-- always the conversation's Vietnamese side (see PrismaConversationStore.save's
-- docblock), so this keeps that invariant for both directions and for any row
-- whose speakerRole happens to disagree with its conversation's direction.
ALTER TABLE "ConversationTurn" ADD COLUMN "sourceLanguages" TEXT[], ADD COLUMN "translations" JSONB;
UPDATE "ConversationTurn" SET
  "sourceLanguages" = CASE "speakerRole" WHEN 'speaker_a' THEN ARRAY['vi'] ELSE ARRAY['en'] END,
  "translations"    = CASE "speakerRole"
    WHEN 'speaker_a' THEN jsonb_build_object('en', "targetText")
    ELSE jsonb_build_object('vi', "targetText")
  END;
ALTER TABLE "ConversationTurn" ALTER COLUMN "sourceLanguages" SET NOT NULL,
  ALTER COLUMN "translations" SET NOT NULL, DROP COLUMN "targetText";
