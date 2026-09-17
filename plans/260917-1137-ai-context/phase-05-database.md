---
phase: 5
title: 'Database — backup, models, migration, store'
status: complete
priority: P2
effort: '6h'
dependencies: [4]
---

# Phase 5: Database — backup, models, migration, store

## Goal

Persist a named context library owner-scoped in a shape where omitting the owner
does not compile, on top of the squashed baseline `20260917024800_init`.

## Files to Create / Modify

- Create: a database dump outside the repository (path recorded in the phase report)
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_translation_context/migration.sql` (generated)
- Create: `apps/api/src/modules/translation-contexts/interfaces/translation-context-store.interface.ts`
- Create: `apps/api/src/modules/translation-contexts/stores/prisma-translation-context.store.ts`
- Create: `apps/api/src/modules/translation-contexts/stores/prisma-translation-context.store.spec.ts`

## Tasks & Steps

1. **BACK UP THE DATABASE. This is step one and it is a real step.** The
   migration history was squashed to a single baseline one week ago (commit
   2e02f8e, 2026-09-17) and this is the first migration on top of it.

   ```bash
   mkdir -p ~/chatofy-db-backups
   docker compose up -d --wait postgres
   docker compose exec -T postgres pg_dump -U chatofy -d chatofy \
     > ~/chatofy-db-backups/pre-translation-context-$(date +%Y%m%d-%H%M%S).sql
   ls -l ~/chatofy-db-backups/
   ```

   Record the absolute path and the byte count in the phase report. Do **not**
   continue if the file is zero bytes or does not contain `CREATE TABLE`.
   Do **not** write the dump inside the repository — `.gitignore` has no rule
   for `*.sql` and a dump is exactly the kind of file that must never be
   committed.

2. Add both models to `schema.prisma` (337 lines today; the header at `:1-26`
   says FIVE models, so update that count to SEVEN in the same edit). Place them
   after `Conversation`/`ConversationTurn`, carrying the reasoning the contract
   specifies:

   ```prisma
   // A saved AI Context: what the translator is told about a KIND of conversation.
   //
   // `ownerId` is a plain column, not a `User` relation, for the reason
   // `Conversation` already gives (schema.prisma:166-169): scoping is by the
   // verified token subject for the IDOR guard, the store never joins the
   // identity row, and a context library can be pruned without touching the
   // identity schema.
   //
   // `clientId` is client-minted and deliberately NOT the primary key — not
   // because this editor works offline (it is a form that needs the network
   // anyway) but because `@@unique([ownerId, clientId])` is the only Prisma
   // shape where OMITTING the owner does not compile. `MeetingMinutes` records
   // what a server-cuid key costs (schema.prisma:100-108): the ownership-free
   // read becomes the SHORTER query and the store pays it back by hand.
   model TranslationContext {
     id        String         @id @default(cuid())
     ownerId   String
     clientId  String
     name      String
     topic     String?
     hotwords  String[]
     style     String?
     glossary  GlossaryTerm[]
     createdAt DateTime       @default(now())
     updatedAt DateTime       @updatedAt

     @@unique([ownerId, clientId])
   }
   ```

   With per-field comments recording: `name` is required because an unnamed row
   is a row the picker cannot render; `topic` shares
   `translationHintsSchema.topic`'s 200-character ceiling because it reaches the
   prompt as `Subject:`; `hotwords` is an ordered `String[]` for the reason
   `MeetingMinutes.keyPoints` gives (`schema.prisma:120-124`) and the order is
   NOT cosmetic — it decides which entries survive the provider's cap
   (`prompt-builder.ts:204-225`); `style` is text not a Postgres enum, for the
   reason `User.locale` gives (`schema.prisma:57-66`).

   **NO `@@index([ownerId, updatedAt])`**, deliberately, in the spirit of
   `ConversationTurn.offsetMs` (`schema.prisma:296-312`): the unique above is
   already an `ownerId`-prefixed index so the filter is served, and the sort runs
   over at most `MAX_CONTEXTS_PER_OWNER` rows. **No `searchText`, no GIN index** —
   the list is unpaged and bounded at 20; the trigram machinery
   (`schema.prisma:316-335`) here would be the speculative column the header
   forbids. **No relation to `Conversation`** — nothing on the history screen
   reads it, and the header's rule is explicit (`schema.prisma:14-16`).

   ```prisma
   // One dictionary entry: a term in each language.
   //
   // A child table rather than two parallel `String[]` columns, and the
   // distinction from `keyPoints` is the reason: a keyPoint is ONE string, while
   // an entry is TWO correlated strings, and parallel arrays make a
   // desynchronized pair REPRESENTABLE. The precedent is `ConversationTurn` — an
   // ordered list of multi-field rows written as a unit by a transactional
   // replace — not `MinutesActionItem`, whose justification was a stable id the
   // client addresses. Nothing addresses one entry: the whole context is PUT.
   //
   // Keyed by LANGUAGE, not by role. There is no fold column and no uniqueness
   // on the terms, deliberately: which side is the SOURCE depends on the
   // direction the session runs in, the prompt builder folds that side
   // (`prompt-builder.ts`), and a row knows of no session. A unique index here
   // would have to pick a direction and would be wrong half the time.
   model GlossaryTerm {
     id        String             @id @default(cuid())
     contextId String
     context   TranslationContext @relation(fields: [contextId], references: [id], onDelete: Cascade)
     position  Int
     vi        String
     en        String

     @@unique([contextId, position])
   }
   ```

3. Generate and apply the migration:
   `pnpm --filter api exec prisma migrate dev --name translation_context`.
   Read the generated SQL before accepting it: it must contain exactly two
   `CREATE TABLE`, two `CREATE UNIQUE INDEX`, one `ADD CONSTRAINT ... FOREIGN KEY
... ON DELETE CASCADE`, and **no `DROP`**.
4. Write `translation-context-store.interface.ts` with a
   `TRANSLATION_CONTEXT_STORE` symbol and an interface whose every method takes
   `ownerId` first, with the docblock
   `apps/api/src/modules/conversations/interfaces/conversation-store.interface.ts:30-41`
   already carries for the same guarantee: a `contextId` guessed or copied from
   another user resolves to `null` rather than to their data, so a foreign id and
   an absent one are indistinguishable. Methods: `list(ownerId)`,
   `save(ownerId, clientId, body)`, `remove(ownerId, clientId)`,
   `count(ownerId)`.
5. Write `prisma-translation-context.store.ts`:
   - every read, write and delete addresses
     `where: { ownerId_clientId: { ownerId, clientId } }`;
   - `save` replaces the glossary in ONE transaction (`deleteMany` then
     `createMany` with `position` from the array index), mirroring the
     conversation-turn replace and including its `RETRYABLE_CODES` handling for
     `P2034` under SERIALIZABLE
     (`apps/api/src/modules/conversations/stores/prisma-conversation.store.ts:19-32`
     — and note why `P2002` is deliberately NOT retryable there);
   - `remove` returns whether a row was deleted, so the controller can answer 204
     either way without a second read.
6. Write `prisma-translation-context.store.spec.ts`, modelled on
   `apps/api/src/modules/minutes/stores/prisma-minutes.store.spec.ts:1-60` (a
   hand-rolled `fakePrisma` of `vi.fn()`s, no database), asserting **by
   inspecting the arguments**:
   - `list scopes the query by ownerId`
   - `save addresses the row by ownerId_clientId`
   - `delete addresses the row by ownerId_clientId`
   - `a save replaces the glossary rather than appending` (deleteMany precedes
     createMany inside one `$transaction`)
   - `glossary positions come from the array index`
   - `a serialization conflict is retried and then surfaces`

## Verification

- The backup exists:
  `test -s ~/chatofy-db-backups/pre-translation-context-*.sql && grep -qc 'CREATE TABLE' ~/chatofy-db-backups/pre-translation-context-*.sql && echo BACKUP_OK`
  → prints `BACKUP_OK`.
- `SHADOW_DATABASE_URL="postgresql://chatofy:chatofy@127.0.0.1:5432/chatofy_shadow" pnpm --filter api exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema ./prisma/schema.prisma --exit-code`
  → prints `No difference detected.` and exits **0**. (`SHADOW_DATABASE_URL`
  must name an empty scratch database; the key exists in
  `apps/api/.env.example:253`. If no shadow database is available, the fallback
  is `pnpm --filter api exec prisma migrate status` printing
  `Database schema is up to date!`.)
- `pnpm --filter api test prisma-translation-context.store`
  → prints **6 passed**, 0 failed.
- `pnpm --filter api typecheck` → exits 0.
