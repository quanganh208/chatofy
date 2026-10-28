-- Link TranslationContext to Glossary for preferred renderings.
-- SetNull so deleting a Glossary degrades gracefully rather than cascading.
ALTER TABLE "TranslationContext" ADD COLUMN "glossaryId" TEXT;

ALTER TABLE "TranslationContext"
  ADD CONSTRAINT "TranslationContext_glossaryId_fkey"
  FOREIGN KEY ("glossaryId") REFERENCES "Glossary"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
