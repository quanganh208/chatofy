-- Additive and non-destructive: one column with a constant default, which
-- Postgres 11+ adds without rewriting the table. Still taken behind the
-- pg_dump in docs/deployment-guide.md, like every migration.
--
-- Every existing row reads 0, which is exactly what its duration meant: those
-- conversations were saved while the live clock ran straight through a pause,
-- so `endedAt - startedAt` already was their displayed length. No backfill.
ALTER TABLE "Conversation" ADD COLUMN "pausedMs" INTEGER NOT NULL DEFAULT 0;
