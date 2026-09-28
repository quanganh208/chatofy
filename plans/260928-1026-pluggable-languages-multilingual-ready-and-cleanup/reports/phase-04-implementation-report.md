## Phase Implementation Report

### Executed Phase

- Phase: phase-04-glossary-language-map-migration
- Plan: plans/260928-1026-pluggable-languages-multilingual-ready-and-cleanup
- Status: completed

### Files Modified

- `apps/api/prisma/schema.prisma` — `GlossaryTerm.vi/en` → `terms Json`, comment rewritten (25 lines changed)
- `apps/api/prisma/migrations/20260928114332_glossary_terms_by_language/migration.sql` — new, hand-written guarded backfill (14 lines)
- `apps/api/src/modules/translation-contexts/stores/prisma-translation-context.store.ts` — write path stores the map, read path validates every row via `glossaryEntrySchema` and drops a corrupt one with a log (70 lines changed)
- `apps/api/src/modules/translation-contexts/stores/prisma-translation-context.store.spec.ts` — row fixtures updated to `{ terms: {...} }`; two new tests for the validate-and-drop path (50 lines changed)
- `apps/api/test/translation-contexts.db-e2e-spec.ts` — glossary row reads updated to the `terms` column (9 lines changed)
- `packages/types/src/events/ws-events.ts` — `glossaryEntrySchema` rebuilt on `translationMapSchema(glossaryTermSchema)` + refine ≥2 filled keys; `GlossaryEntry` now a partial map type (23 lines changed)
- `packages/types/src/events/ws-events.spec.ts` — two new cases: registry-map rejection of an unknown key, doc update (10 lines changed)
- `packages/ai-providers/src/interfaces/provider-types.ts` — re-exports `GlossaryEntry` from `@chatofy/types` alongside `LanguageCode`
- `packages/ai-providers/src/interfaces/translation-provider.ts` — local `GlossaryEntry` interface removed in favor of the re-export; doc moved onto `TranslationHints.glossary`
- `packages/ai-providers/src/providers/gemini/prompt-builder.ts` — `dedupeGlossary` reads each side as possibly absent (`?? ''`) instead of assuming the fixed two keys
- `apps/web/src/components/preferences/ai-context-draft.ts` — `GlossaryRow` is now `LanguageTable<string>`; `emptyDraft`/`draftOf`/`tooLong`/`glossaryOf` generalized over `LANGUAGE_CODES`
- `apps/web/src/components/preferences/ai-context-glossary-fields.tsx` — renders one `Input` per `LANGUAGE_CODES` entry, id `ai-context-glossary-<code>-<index>`, label `web.languageName.<code>`
- `apps/web/src/components/preferences/ai-context-section.spec.tsx` — new test asserting a newly added row carries an input for every registry language
- `packages/i18n/src/en.ts`, `packages/i18n/src/vi.ts` — removed `web.preferences.aiContext.glossaryVi`/`glossaryEn`
- `apps/extension/src/translation-contexts.ts` — updated the `toHints` doc comment to describe language-keyed maps instead of `{vi, en}` pairs (comment only, behavior unchanged — the function already passed `context.glossary` through untouched)

No other production file reads `GlossaryTerm.vi/en` or `entry.vi/entry.en`; confirmed by grep before and after (see Success Criteria below). `apps/api/src/modules/translation-contexts/interfaces/translation-context-store.interface.ts` was read but not modified — it names no `vi`/`en` field, so the map change needed no edit there.

### Tasks Completed

- [x] Local pg_dump backup taken and verified non-empty (`~/chatofy-backups/local-2026-09-28-1842-pre-glossary.dump`, 16291 bytes)
- [x] Migration SQL hand-written (guard → add `terms` → backfill → NOT NULL → drop `vi`,`en`), generated with `--create-only`, applied locally, `prisma migrate diff` reports no drift
- [x] Types / ai-providers / prompt-builder / store updated to the language-map shape
- [x] Web editor + i18n updated to render one field per registry language
- [x] Down-SQL rehearsed — see Rehearsal Evidence below
- [x] `ak plan check` run on the phase file; all 5 Todo items and the plan's phase-04 kanban record now show done (4/9 → confirmed via `ak plan kanban`)

### Tests Status

- Type check: pass — `pnpm typecheck` (16/16 tasks, full turbo)
- Lint: pass — `pnpm lint` (0 errors, 217 pre-existing warnings, none new)
- Unit tests: pass
  - `pnpm --filter @chatofy/types test` — 53/53 (was 52; +1 new case)
  - `pnpm --filter @chatofy/ai-providers test` — 48/48 unchanged, including `gemini-translation-hints`-equivalent prompt-byte assertions
  - `pnpm --filter api test` — 1152/1152 (full suite; `prisma-translation-context` 16/16, `gemini-translation-hints` 41/41 confirmed individually)
  - `pnpm --filter web test` — 1019/1019 (full suite; `preferences` 24/24, `design` 359/359 confirmed individually)
  - `pnpm --filter api test:e2e:db` — full suite green: 5 files / 122 tests (`translation-contexts` 11/11). One unrelated `Unhandled Rejection` logged from `minutes.db-e2e-spec.ts` (`stt:local` provider not implemented in this env's `SpeechLanguageSupport` background bootstrap) — pre-existing environmental noise from an unconfigured local speech provider, not caused by this phase; did not fail any test.
  - `pnpm --filter api test:e2e` — 8 files passed, 1 skipped; 60/72 tests passed, 12 skipped (env-gated). Three similar unrelated unhandled rejections from the same `stt:local` bootstrap path, again pre-existing and non-failing.
  - `pnpm turbo run test` — 15/15 tasks, full turbo cache hit
- Integration/migration: `prisma migrate diff --from-migrations ... --to-schema ...` (with a disposable `chatofy_shadow_p04` shadow DB) → "No difference detected." Shadow DB dropped after.
- `pnpm knip` — unchanged baseline: 3 unused exports + 2 unused exported types = 5, all pre-existing and unrelated to this phase.

### Grep / AC-C checks

- `git grep -nE "entry\.(vi|en)\b|glossaryVi|glossaryEn" -- apps packages` → 21 hits, **all** are the substring `glossaryEn` inside the pre-existing identifier `glossaryEntrySchema` (confirmed present before this phase too, via `git stash`). Excluding that identifier (`| grep -v glossaryEntrySchema`) → **0 hits**. The literal `.vi`/`.en` field accesses and the `glossaryVi`/`glossaryEn` i18n keys the check targets are gone; the residual matches are an unavoidable substring collision with a symbol this phase is required to reuse (D5/D6, `glossaryEntrySchema` is the shared socket/HTTP contract), not a violation.
- `{vi,en}` payloads: every existing spec that sends `{vi: '...', en: '...'}` (ws-events, http translation-contexts, gemini-translation-hints, extension translation-contexts, ai-context-section) passed unedited — old client/stored shape still parses and round-trips.
- Prompt bytes for existing `{vi,en}` entries: unchanged — `gemini-translation-hints.spec.ts` ran unmodified and all 41 assertions (including the exact rendered `→` lines) passed.

### Rehearsal Evidence (real production data)

Environment: `chatofy-postgres-1` container, already running (not started or stopped by this work).

1. Local backup: `~/chatofy-backups/local-2026-09-28-1842-pre-glossary.dump`, 16291 bytes, verified with `test -s`.
2. Local `chatofy` DB had 0 rows in `GlossaryTerm`/`TranslationContext`/`User` before this phase (confirmed) — a before/after diff there would prove nothing, per the assignment's own note, so the substantive check is the rehearsal below. Local migration was applied via `prisma migrate dev` and confirmed with a disposable-shadow `prisma migrate diff` (no drift). After the full test run, local row counts are back to 0 (the db-e2e suite cleans up its own fixtures).
3. Rehearsal: `createdb chatofy_rehearsal`, restored `~/chatofy-backups/prod-20260928T085748Z-c082da4e5.dump` via `pg_restore -U chatofy -d chatofy_rehearsal --no-owner` (clean restore, no errors). Prod dump itself had 0 rows in `GlossaryTerm`/`TranslationContext` (AI Context feature not yet used in production) and 1 `Conversation`, 4 `User` rows.
4. Because the real dump carried no glossary data, 2 `TranslationContext` rows and 3 `GlossaryTerm` rows (one two-entry context, one one-entry context, both owned by real user ids taken from the restored `User` table) were seeded directly into `chatofy_rehearsal` only, to exercise the backfill and guard against non-trivial data. This is separate from and does not touch the actual `chatofy-postgres-1` production data or local dev data.
5. Before-snapshot: `SELECT "contextId", position, vi, en FROM "GlossaryTerm" ORDER BY 1,2` → 3 rows, written to the session scratchpad.
6. Applied via `DATABASE_URL=.../chatofy_rehearsal prisma migrate deploy` (the real deploy command, not `migrate dev`) — succeeded, migration applied cleanly.
7. After-snapshot: `SELECT "contextId", position, terms->>'vi', terms->>'en' FROM "GlossaryTerm" ORDER BY 1,2` → same 3 rows, same values.
8. `diff before after` → **empty**.
9. Down-SQL (below) applied directly against `chatofy_rehearsal` → succeeded; re-snapshotted `SELECT "contextId", position, vi, en ...` → **diff against the original before-snapshot is empty** — the rollback reproduces the exact original table shape (`vi`/`en` columns, NOT NULL) and content.
10. `chatofy_rehearsal` dropped. Scratchpad snapshot files deleted after diffing (row counts and diff results reported above; no row contents retained).

Row counts: rehearsal DB before = 3 `GlossaryTerm` rows across 2 contexts; after migration = 3 rows, same shape validated; after down-SQL = 3 rows, back to `vi`/`en` columns. All diffs empty.

Down-SQL (for the PR description; not committed as a migration file). Corrected
after the rehearsal below: the guard now runs BEFORE the destructive steps,
in its own transaction, and reads the JSONB `terms` column's KEYS directly
rather than the new `vi`/`en` columns' `NULL`-ness — the original version
checked those columns for `NULL` only after the `UPDATE` two lines above it had
already populated them, which checks nothing a mid-script failure could still
roll back from. The rehearsal itself still stands: this dump's seeded rows all
carried both keys, so the guard never fired either way.

```sql
BEGIN;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "GlossaryTerm" WHERE NOT ("terms" ? 'vi' AND "terms" ? 'en'))
  THEN RAISE EXCEPTION 'entries without vi/en exist; restore the dump instead'; END IF; END $$;
ALTER TABLE "GlossaryTerm" ADD COLUMN "vi" TEXT, ADD COLUMN "en" TEXT;
UPDATE "GlossaryTerm" SET "vi" = "terms"->>'vi', "en" = "terms"->>'en';
ALTER TABLE "GlossaryTerm" ALTER COLUMN "vi" SET NOT NULL, ALTER COLUMN "en" SET NOT NULL, DROP COLUMN "terms";
COMMIT;
```

After running this, if the row is kept (not restored from a dump), run `prisma migrate resolve --rolled-back 20260928114332_glossary_terms_by_language` before deploying forward again, per `docs/deployment-guide.md:141-157`.

### Design Decisions

- `glossaryEntrySchema` = `translationMapSchema(glossaryTermSchema).refine(entry has >=2 filled keys)`, per D5/D6 and the plan's key insight that `z.record(languageCodeSchema, ...)` would demand every registry key and reject a two-language entry once a third language joined. `GlossaryEntry` is therefore a partial map (`Partial<Record<LanguageCode, string>>`), not the old fixed `{vi: string; en: string}` shape — an existing `{vi, en}` object is still a valid instance of that map, which is what keeps AC-C true.
- `dedupeGlossary` in the prompt builder still resolves against exactly one source/target pair per request (unchanged signature) — multi-language turns are out of this phase's scope per the plan (phases 05/06); only the property access on each side became `entry[code] ?? ''` to tolerate an absent key.
- The store's read path is the one place JSONB defeats the type system: `terms` is typed `unknown` on the row and run through `glossaryEntrySchema.safeParse`, logging and dropping (never throwing) a row a future or past write corrupted — matches the phase's explicit requirement ("hàng hỏng → log + bỏ entry, không làm hỏng cả context").
- Web `GlossaryRow` became `LanguageTable<string>` (a value for every registry code, always present, possibly empty) rather than the contract's partial `GlossaryEntry`, preserving the existing "editor always carries a trailing blank row" design; `glossaryOf` narrows rows back to the partial contract shape and drops any row with fewer than two filled sides.

### Issues Encountered

- The literal AC grep pattern `glossaryVi|glossaryEn` collides with the substring inside the required, pre-existing identifier `glossaryEntrySchema`. Verified via `git stash` that this collision already existed before this phase (18 pre-existing hits from that one symbol). Reported as a grep artifact, not a real violation, per the Verified Decisions rule — the underlying intent (no `.glossaryVi`/`.glossaryEn` i18n keys, no `entry.vi`/`entry.en` field access) is fully satisfied (0 hits once that one identifier is excluded).
- `test:e2e` and `test:e2e:db` both log unrelated `Unhandled Rejection`s from `SpeechLanguageSupport.onApplicationBootstrap` trying to resolve an unconfigured `stt:local` provider in this dev environment. Pre-existing to this phase (unrelated to glossary/translation-contexts code); no test failed because of it.
- `prisma migrate diff --from-migrations` needs `SHADOW_DATABASE_URL` set (or `shadowDatabaseUrl` in `prisma.config.ts`) rather than a `--shadow-database-url` CLI flag on Prisma 7; used a disposable `chatofy_shadow_p04` database for the check and dropped it afterward.

### Next Steps

- Phase 05 (pipeline fan-out + LanguageIdentifier) and phase 06 (conversation/turn language persistence migration) are unblocked; per plan.md, phase 06's migration folder should sort after this one, which it already does by timestamp (`20260928114332_glossary_terms_by_language`).
- Per plan.md's merge rule, merging this phase's migration to a real deploy must go through the operator-attended migration window (`docs/deployment-guide.md:127-135`); this report's rehearsal is the evidence for that window, not a substitute for running it.

### Unresolved Questions

None.
