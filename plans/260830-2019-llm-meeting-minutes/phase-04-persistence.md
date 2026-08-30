# Phase 4 — Persistence (PrismaMinutesStore)

**State: open. Only needed once minutes must outlive a restart or be read on
another instance — the in-memory store is correct until then.**

## Tasks

- [ ] Prisma model `MeetingMinutes` (+ `ActionItem` relation) in
      `apps/api/prisma/schema.prisma`. Keys: `sessionId` unique (one artifact per
      session — regeneration overwrites), `status`, `summary`, `keyPoints`
      (string[]), `decisions` (string[]), `generatedAt` nullable, `model`
      nullable. Action items as a child table with `owner` / `dueDate` nullable.
- [ ] Migration.
- [ ] `PrismaMinutesStore implements MinutesStore` — `put` is an upsert on
      `sessionId`, replacing child action items in a transaction. `get` joins.
- [ ] Bind it in `minutes.module.ts` behind config (env selects memory vs prisma,
      the way storage/avatar chooses its backend at construction), NOT a code edit
      per environment.
- [ ] Reuse the same defensive-copy discipline `MemorySessionStore` follows so a
      caller cannot mutate stored state.

## Cost note (per `managed-datastore-write-cost-discipline` if this ever moves to a row-billed store)

Minutes are an aggregate artifact (one row per session), not raw events — this is
exactly the shape that belongs in a relational/row store. No raw transcript rows
are written here; the transcript stays client-side or in object storage if it is
ever persisted at all.

## Verify

Migration applies clean; store unit tests (upsert overwrites, action items
replaced not appended, get returns null for unknown session); existing e2e green
against the Prisma store.
