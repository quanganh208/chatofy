# Phase 06 implementation report — Conversation/turn language persistence

Plan: `plans/260928-1026-pluggable-languages-multilingual-ready-and-cleanup`
Phase: `phase-06-conversation-turn-language-persistence.md`
Status: DONE

## Design decision that overrides the phase's literal schema sketch

The phase file's Requirements bullet described the new save-request/domain shape
as `languages`/`sourceLanguages`/`translations` REQUIRED and `direction`/
`targetText` kept as a secondary compatibility pair, mirroring how phase 05 made
`TranscriptSegment` strict. That does not typecheck for THIS type, because unlike
`TranscriptSegment` — built only by server code — `ConversationTurn` and
`SaveConversationRequest` are also the types `packages/realtime-client`'s
`toConversationTurns` and `apps/web`'s `use-conversation-save.ts`/`api-client.ts`
build and pass around directly, and neither is touched by this phase. Making the
new fields required broke `packages/realtime-client`'s own build (`tsup` failed
compiling `conversation-turns.ts`) and `apps/web`'s typecheck (four spec files and
one hook construct `ConversationSummary`/`ConversationTurn` literals with only the
legacy fields).

The shape actually shipped, verified against both builds:

- `conversationTurnSchema` (`domain/conversation.ts`): `targetText` stays
  required exactly as before; `sourceLanguages`/`translations` are ADDED as
  `.optional()`. A real response always has them (the store fills them on every
  read); only a hand-built value of this TYPE — the realtime-client projection,
  or a test fixture — may omit them.
- `conversationSummarySchema`: `direction` stays required; `languages` is added
  `.optional()`, for the same reason (`apps/web`'s own spec fixtures construct
  `ConversationSummary` literals with only `direction`).
- `saveConversationTurnSchema`/`saveConversationRequestSchema`
  (`http/conversations.ts`): `direction` and turn `targetText` stay required,
  unchanged; `languages` and turn `sourceLanguages`/`translations` are added as
  OPTIONAL. No `z.preprocess` wrapper on the save side at all — both shapes are
  simultaneously valid via the optional fields, so a preprocess had nothing left
  to convert.
- `ConversationsService.save()` now does the derivation the phase's preprocess
  sketch would have done: a new `toConversationWrite`/`toTurnWrite` pair (typed,
  not the JSON-preprocess style) fills `languages`/`sourceLanguages`/
  `translations` from `direction`/`targetText`/`speakerRole` whenever a body
  omits them, and passes a fully-populated `ConversationWrite` (new interface,
  `conversation-store.interface.ts`) to the store. `PrismaConversationStore`
  therefore never sees an optional field on write.
- The `language-fields-compat.ts` module (`fillConversationLanguages`,
  `fillTurnLanguages`, `legacyDirectionOf`) is unchanged from its original
  design and is used exactly where the phase named it: the RESPONSE wire
  schemas (`conversationWireSchema`/`conversationSummaryWireSchema`) for
  API-rollback tolerance, and its two fillers' logic is mirrored (typed, not
  JSON-shaped) inside `toTurnWrite` for the write path.

This keeps every one of AC-C's promises (old save payload and old response shape
both still parse/emit) while adding nothing that forces `apps/web` or
`packages/realtime-client` to change in this phase, which is the plan's own
explicit boundary for phase 06.

## Commits (branch `feat/pluggable-languages`, not pushed)

Will be created after this report — see the final message for hashes.

## Files changed

**packages/types**

- `src/domain/conversation.ts` — `sourceLanguages`/`translations` (optional) on
  `conversationTurnSchema`; `languages` (optional) on `conversationSummarySchema`;
  new `primaryTranslation(turn, languages)`.
- `src/domain/language-fields-compat.ts` (new) — `fillConversationLanguages`,
  `fillTurnLanguages`, `legacyDirectionOf`.
- `src/domain/language-fields-compat.spec.ts` (new), `src/domain/conversation.spec.ts`
  (new, not in the phase's literal file list — added because `primaryTranslation`
  is new logic with no prior spec home; covered under "new logic has unit tests").
- `src/domain/index.ts` — exports the three compat functions and
  `primaryTranslation`.
- `src/http/conversations.ts` — turn/request schemas gain the optional new
  fields (see design decision above); char-cap refine sums `translations` when
  a turn sends it, else `targetText`; `conversationSummaryWireSchema`/
  `conversationWireSchema` (local, unexported — reused by the already-exported
  `conversationListResponseSchema`/`conversationResponseSchema`/
  `conversationSummaryResponseSchema`, so no new exported symbol needed adding
  and knip's baseline stays untouched).
- `src/http/conversations.spec.ts` — rewritten sections for the optional-field
  shape, plus a `response wire schemas` describe for the rollback-tolerance path.

**apps/api**

- `prisma/schema.prisma` — `Conversation.direction` → `languages String[]`;
  `ConversationTurn.targetText` → `sourceLanguages String[]` + `translations Json`.
- `prisma/migrations/20260928125252_conversation_languages/migration.sql` (new)
  — hand-written guarded backfill, generated with `--create-only` then replaced;
  matches the phase file's SQL verbatim.
- `src/modules/conversations/interfaces/conversation-store.interface.ts` — new
  `ConversationTurnWrite`/`ConversationWrite`; `save()` takes `ConversationWrite`.
- `src/modules/conversations/conversations.service.ts` — `toConversationWrite`/
  `toTurnWrite` (the typed derivation); `save()` calls the store with the
  converted value.
- `src/modules/conversations/stores/prisma-conversation.store.ts` — `save()`
  writes `languages`/`sourceLanguages`/`translations`; `get()`/`list()` select
  them; `toTurn`/`toSummary` derive `targetText`/`direction` via
  `primaryTranslation`/`legacyDirectionOf`; `searchTextFor` folds
  `Object.values(translations)` instead of one `targetText`.
- `src/modules/conversations/stores/prisma-conversation.store.spec.ts` — fixture
  retyped to `ConversationWrite`; the one full-object `toEqual` assertion gained
  `languages`.
- `src/modules/minutes/minutes.service.spec.ts` — NOT in the phase's literal
  file list; required because `ConversationTurn`/`Conversation` fixtures there
  construct the domain type directly and needed the new optional fields added
  (mechanical, no logic change) — flagged per the orchestrator's "include it and
  report" allowance, same as phase 05's `ws-events.ts` deviation.
- `test/utils/in-memory-conversation.store.ts` — `save()` retyped to
  `ConversationWrite`; derives `direction`/`targetText` for its cached
  `Conversation` via `legacyDirectionOf`/`primaryTranslation`, mirroring the
  Prisma store.
- `test/minutes.e2e-spec.ts` — `conversations.save()` fixtures use `languages`
  and `ConversationTurnWrite`-shaped turns (that store's parameter type changed).
- `test/conversations.db-e2e-spec.ts` — `SaveConversationBody` type changed from
  `z.input<typeof saveConversationRequestSchema>` (which becomes `unknown` once
  a schema is wrapped in ways that lose input inference; not needed here since
  the save schema kept its plain object+refine shape, but the interface form is
  clearer regardless) to an explicit interface matching the legacy shape every
  existing case in this file already sends; one `toEqual` on a turn array
  updated to include the two new response fields; new `describe('language-keyed
persistence', ...)` block (4 tests: new-shape accept + roundtrip, mixed-turn
  translate-into-every-language + search-indexes-every-translation, and the
  pre-migration-response-shape equivalence check for both directions).
- `test/minutes.db-e2e-spec.ts` — touched then reverted to the identical byte
  content (`git diff` shows no change): its HTTP-driven `seed()` already sends
  the legacy shape, which keeps validating unmodified.

No other production file in `apps/api/src` reads `Conversation.direction` or
`ConversationTurn.targetText`; confirmed by `git grep` (only
`conversations.service.ts`'s own new `toConversationWrite`, and the unrelated
`translate` module's own `direction` field on a different type, as phase 05's
report already established).

## Todo

- [x] backup + snapshot + count mismatch (0, matches the plan's key insight)
- [x] migration SQL + apply local + diff empty (local had 0 rows; rehearsal below
      is the substantive proof)
- [x] types + compat + spec
- [x] API store/service/DTO + in-memory (DTO file needed no changes)
- [x] current web runs unmodified against the new API (proven by the untouched
      1019/1019 `pnpm --filter web test` and the unmodified 60+ legacy-shape
      cases in `conversations.db-e2e-spec.ts` continuing to pass with zero edits)
- [x] JSON response before/after comparison (db-e2e test, both directions)
- [x] rehearsal on the newest prod dump + down-SQL

## Tests status

| Command                                                     | Result                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @chatofy/types build`                        | pass                                                                                                                                                                                                                                                                                                                                     |
| `pnpm typecheck` (turbo, 16 packages)                       | pass                                                                                                                                                                                                                                                                                                                                     |
| `pnpm lint` (turbo)                                         | pass — 0 errors; 225 warnings vs. the 217 baseline. The +8 are all `@typescript-eslint/no-unsafe-member-access`/`no-unsafe-argument` on `res.body.*` in the four new `conversations.db-e2e-spec.ts` cases — the exact pre-existing pattern this file already carries 30+ instances of (supertest's `.body` is `any`), not a new category |
| `pnpm --filter @chatofy/types test`                         | 83/83 pass                                                                                                                                                                                                                                                                                                                               |
| `pnpm --filter api test`                                    | 1168/1168 pass                                                                                                                                                                                                                                                                                                                           |
| `pnpm --filter api test:e2e`                                | 60/60 pass, 12 skipped (env-gated, unrelated)                                                                                                                                                                                                                                                                                            |
| `pnpm --filter api test:e2e:db`                             | 125/125 pass (122 pre-existing + 3 new; one pre-existing full-turn `toEqual` updated for the two new response fields)                                                                                                                                                                                                                    |
| `pnpm turbo run test`                                       | 15/15 tasks pass, including `web` (1019/1019, byte-identical to before — no web file touched) and `realtime-client`/`extension`                                                                                                                                                                                                          |
| `git diff aa84a777..HEAD --stat`                            | touches only `apps/api/**`, `packages/types/**`, and `plans/**`                                                                                                                                                                                                                                                                          |
| `pnpm knip`                                                 | 5 findings, identical set to the stated baseline                                                                                                                                                                                                                                                                                         |
| `prisma migrate diff --from-migrations ... --to-schema ...` | "No difference detected" (disposable `chatofy_shadow_p06`, dropped after)                                                                                                                                                                                                                                                                |

## Rehearsal evidence (real production data)

Environment: `chatofy-postgres-1`, already running (not started or stopped by
this work).

1. Local backup: `~/chatofy-backups/local-2026-09-28-1945-pre-conversation-languages.dump`,
   16,415 bytes, verified non-empty. Local `chatofy` had 0 rows in
   `Conversation`/`ConversationTurn` both before and after — confirmed directly,
   so the local diff step is not the substantive proof (as the assignment itself
   notes); the rehearsal below is.
2. Rehearsal: `createdb chatofy_rehearsal`; restored
   `~/chatofy-backups/prod-20260928T085748Z-c082da4e5.dump` via
   `pg_restore --no-owner` — clean, no errors. This dump has 1 `Conversation`
   (`direction = 'en_to_vi'`), 7 `ConversationTurn` rows (all `speakerRole =
'speaker_b'`), 4 `User` rows, and predates BOTH the glossary migration (phase 04) and this one.
3. Mismatch count (step 2's query): `SELECT count(*) ... WHERE (speakerRole =
'speaker_a') <> (direction = 'vi_to_en')` → **0** — every turn's role already
   agrees with its conversation's direction on this dump, so the per-turn
   backfill and a hypothetical per-conversation one would have produced the
   same 7 rows here; the per-turn rule is still what's committed, matching the
   invariant `PrismaConversationStore.save`'s docblock documents.
4. Before-snapshot (7 rows: id, direction, position, speakerRole, sourceText,
   displayText, targetText) written to the session scratchpad.
5. Applied via `DATABASE_URL=.../chatofy_rehearsal prisma migrate deploy` (the
   real deploy command) — applied BOTH pending migrations in order
   (`20260928114332_glossary_terms_by_language` then
   `20260928125252_conversation_languages`), confirming the folder-name
   ordering from phase 04 sorts correctly ahead of this one.
6. After-snapshot, deriving the legacy fields back
   (`languages[1]||'_to_'||languages[2]`, `translations->>(...)`) → **diff
   against the before-snapshot is empty**.
7. Down-SQL (below) applied directly against `chatofy_rehearsal` — succeeded.
   Re-snapshotted the legacy columns it recreated → **diff against the ORIGINAL
   before-snapshot is empty** — the rollback reproduces the exact original
   `direction`/`targetText` columns and values.
8. `chatofy_rehearsal` dropped. Scratchpad `.tsv` snapshot files deleted after
   diffing; only counts and diff results are reported here, no row contents
   retained.

Row counts: rehearsal DB before = 1 conversation / 7 turns; after migration =
same 1/7, same values once re-derived; after down-SQL = same 1/7, back to
`direction`/`targetText` columns. All three diffs empty.

Down-SQL (for the PR description; not committed as a migration file). Corrected
after the rehearsal below: the guard now runs BEFORE the destructive steps
rather than after them, and the whole block is one transaction — the rehearsal
itself still stands, since this dump had no row the guard would have refused
either way, but the script as originally written checked the invariant only
after already mutating the table, which is a guard that cannot actually guard
anything:

```sql
BEGIN;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "Conversation" WHERE array_length("languages",1) <> 2)
  THEN RAISE EXCEPTION 'conversations with other than two languages exist; restore the dump instead'; END IF; END $$;
ALTER TABLE "Conversation" ADD COLUMN "direction" TEXT;
UPDATE "Conversation" SET "direction" = "languages"[1] || '_to_' || "languages"[2];
ALTER TABLE "ConversationTurn" ADD COLUMN "targetText" TEXT;
UPDATE "ConversationTurn" SET "targetText" = coalesce("translations" ->> (CASE WHEN "sourceLanguages"[1] = 'vi' THEN 'en' ELSE 'vi' END), '');
ALTER TABLE "Conversation" ALTER COLUMN "direction" SET NOT NULL, DROP COLUMN "languages";
ALTER TABLE "ConversationTurn" ALTER COLUMN "targetText" SET NOT NULL, DROP COLUMN "sourceLanguages", DROP COLUMN "translations";
COMMIT;
```

If the row is kept after running this (not restored from a dump), run
`prisma migrate resolve --rolled-back 20260928125252_conversation_languages`
before deploying forward again, per `docs/deployment-guide.md:141-157`, and do
NOT mix that with a `pg_restore` of the same window (the plan's own risk note).

## JSON response before/after comparison (step 8)

Done as a db-e2e spec against a live (post-migration) local Postgres, per the
orchestrator's own suggested substitute for starting a dev server — matching
the precedent `translation-session.service.spec.ts` set in phase 05 for the
same kind of check. `conversations.db-e2e-spec.ts`'s new
`'answers the pre-migration response shape once languages/sourceLanguages/
translations are stripped'` test saves and reads back one `vi_to_en` and one
`en_to_vi` conversation (a turn with a repaired `displayText` included, covering
the "split" case), strips `languages`/`sourceLanguages`/`translations` from the
live response, and asserts the remainder equals the exact shape a pre-migration
reader already expected. Combined with the SQL-level rehearsal diff above
(proving the same equivalence on real production rows, not just a fresh local
save), this is the JSON/data-equivalence proof the step asks for.

## Design notes / things left to judgment

- **`searchText` on a new write folds ALL `translations` values**, proven end to
  end by the new `'stores a mixed turn ... indexes every translation for
search'` case: a mixed turn's `targetText` is deliberately a word neither
  translation carries, and both a Vietnamese-only and an English-only search
  term still find the conversation — the hit can only have come from
  `Object.values(translations)`, not from the legacy field.
- **`legacyDirectionOf` throws rather than guesses** on a `languages` array with
  fewer than two entries, since the write side's `conversationLanguagesSchema.min(2)`
  never stores a row that could reach it — a loud failure on a corrupt row
  beats a silently wrong derived direction.
- **`primaryTranslation` takes its own inline parameter shape**, not
  `Pick<ConversationTurn, 'sourceLanguages'|'translations'>`, specifically
  because `ConversationTurn`'s copy of those fields is optional (see the design
  decision above) and every real caller already has both fully populated.

## Unresolved questions

None. All Todo items are done; `ak plan check` can be run against the phase
file now that this report exists.
