# Phase 4 — Persistence (PrismaMinutesStore)

**State: complete (code + unit tests). The db-e2e requires a Postgres container
and was NOT run in the offline authoring session — it runs in CI / `test:e2e:db`.**

## Delivered

- [x] Prisma models `MeetingMinutes` + `MinutesActionItem` in
      `apps/api/prisma/schema.prisma`. `@@unique([ownerId, sessionId])` (one
      artifact per owner+session — regenerate overwrites); `keyPoints`/`decisions`
      as `String[]` (Postgres preserves order); action items a cascade-deleted
      child table with `position` for ordering and the app-minted `id` stored as
      given.
- [x] Migration `20260830000000_add_meeting_minutes/migration.sql` (hand-authored
      to Prisma DDL conventions — `prisma migrate diff --from-migrations` needs a
      shadow DB unavailable offline; **validate with `prisma migrate dev` against
      Postgres before release**). `prisma generate` run so the client types the
      new models.
- [x] `PrismaMinutesStore implements MinutesStore` — `put` upserts on the
      compound key and, on update, replaces the whole action-item set atomically
      (`deleteMany` + `create`); `get` joins ordered by `position` and maps to the
      domain shape (never leaks `ownerId`/join ids).
- [x] Bound in `minutes.module.ts` behind `MINUTES_STORE_BACKEND`
      (`memory` default / `prisma`), the StorageModule/AVATAR_STORAGE pattern — no
      per-environment code edit.
- [x] No shared mutable state leaks: `get` maps into a fresh domain object;
      `put` returns the caller's own object (already the stored value).

## Cost note (per `managed-datastore-write-cost-discipline` if this ever moves to a row-billed store)

Minutes are an aggregate artifact (one row per session), not raw events — this is
exactly the shape that belongs in a relational/row store. No raw transcript rows
are written here; the transcript stays client-side or in object storage if it is
ever persisted at all.

## Verify

- Done offline (2026-08-30): `prisma generate` clean; `tsc --noEmit` green for
  `apps/api`; `prisma-minutes.store.spec.ts` (compound-key read + mapping, upsert
  with positions, action-item replacement, null `generatedAt`) passes within the
  26-test minutes unit suite; the memory-default plain e2e still 6/6.
- **Owed against Postgres (CI / `test:e2e:db`):** apply the migration, then
  `minutes.db-e2e-spec.ts` (round-trip, regenerate-replaces-not-appends, foreign
  user 404). Written but unrun offline — treat as unverified until it runs green.
