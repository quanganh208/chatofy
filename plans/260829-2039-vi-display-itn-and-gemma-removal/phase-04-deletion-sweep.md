---
phase: 4
title: 'Deletion sweep'
status: complete
priority: P1
effort: '1d'
dependencies: [3]
---

## Result — 2026-08-29

**2,423 lines deleted across 45 files, 7 files removed outright.** Every suite
green afterwards: API 51/51 suites and 753/753 tests, realtime-client 262,
web 36/506, workspace typecheck 16/16.

| criterion                                                                                                                                               | result                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `repairForDisplay` / `repairsInFlight` / `MAX_CONCURRENT_DISPLAY_REPAIRS` / `REPAIR_TIMEOUT_MS` / `repairDivergence` / `DisplayRepair` / `recordRepair` | grep over `apps` + `packages` returns **nothing**                                                        |
| `DEFAULT_MODELS`                                                                                                                                        | exactly two entries, both flash                                                                          |
| provider spec                                                                                                                                           | asserts the ladder **cannot** reach the reserve                                                          |
| `display-repaired.jsonl`                                                                                                                                | **byte-identical** (SHA-256 verified — `data/` is gitignored, so `git diff` could never have shown this) |
| `ws-events.ts`                                                                                                                                          | untouched this phase; its additive change landed in Phase 3                                              |
| `TranslationProvider.repair`                                                                                                                            | gone; it was declared optional, so no implementor broke                                                  |
| `benchmarks/prompt-injection`                                                                                                                           | parses, 34 cases, 0 in repair mode                                                                       |

Deleted: `repair-divergence.ts` (364), `transcript-repair-prompt.ts` (120),
`repair-divergence.spec.ts` (328), `gemini-transcript-repair.spec.ts` (138),
`repair_display_hypotheses.mjs` (127), plus the two session/pipeline repair specs
Phase 3 stranded, the `DisplayRepair` / `REPAIR_TIMEOUT_MS` / `withDeadline` /
`repairDisplay()` block in `pipeline-translator.service.ts`, the provider's
`repair()` and `REPAIR_MODELS`, the `DisplayRepairMetrics` / `recordRepair()`
machinery, and the `MAX_CONCURRENT_DISPLAY_REPAIRS` ceiling with its doc comment.

### A11 as written could not be satisfied, and satisfying it literally would have

### been worse

The criterion said `grep -ri gemma` should return only `development-journey.md`.
Four references remain outside it, and all four are the RIGHT kind:

```
translation-session.service.spec.ts:457  expect(...includes('gemma')).toBe(false)
gemini-translation-provider.spec.ts:389  expect(walked).not.toContain('gemma-4-31b-it')
gemini-translation-provider.spec.ts:373  the comment explaining that assertion
gemini-translation-provider.ts:71        the comment at the ladder it was removed from
```

Two are **guard assertions that fail if the model is ever put back**, and two
explain them. Deleting them to satisfy a grep would remove the only mechanical
protection against the thing the criterion exists to prevent. Everything else
went: every model list, every current-architecture doc, and the code comments
that justified defensive behaviour by naming it — those were reworded to describe
the behaviour instead ("a model on this path was measured returning the wrapper
verbatim"), because the defence is still wanted and its reason is still true.

### Removed attack surface, not reduced coverage

The 9 same-language repair cases left `benchmarks/prompt-injection/corpus.mjs`.
They measured a nastier exposure than translation — an injected answer comes back
as a fluent sentence in the right language, sitting exactly where the speaker's
own words belong, with no wrong-language tell — and they are gone because the
surface is gone, not because it was judged safe. Said in three places so it
cannot be misread later: at the cut in `corpus.mjs`, in that benchmark's README,
and here.

### Beyond the inventory

- `metrics-jsonl-sink.ts`'s `'repair'` source **kept**, writer removed. The files
  are append-only history and rows written before today still carry the kind; a
  reader that cannot name it cannot read the file.
- `dump_display_hypotheses.py` and `benchmarks/stt/README.md` rewritten around the
  new step 2, with the old arm marked historical and **not runnable** — its
  producer is deleted, which is exactly why `display-repaired.jsonl` is protected.
- `cascade-panel.tsx` had one comment claiming "a deployment whose model cannot
  repair simply shows raw transcripts", which is now false. Reworded. This is the
  only `apps/web` change in the plan and it is a comment.
- `run_display_baseline.py` header, `register-default-providers.ts`'s
  "fell back to gemma" line.

`docs/development-journey.md` left entirely alone, including its references to
the deleted script: it is a dated record of what was tried, and rewriting it to
match the present is what a journey document must not do.

# Phase 4: Deletion sweep

## Overview

Delete everything whose last consumer died in Phase 3 — roughly 1,700 lines
including specs — and remove `gemma-4-31b-it` from the system. Gemma removal
belongs here because it is the same act: deleting a model nothing calls any more.

## Deletion inventory (LOC verified 2026-08-29)

| file / symbol                                                            | LOC | note                                                                                                                                                                                  |
| ------------------------------------------------------------------------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ai-providers/src/text/repair-divergence.ts`                    | 364 | only consumer was the repair                                                                                                                                                          |
| `packages/ai-providers/src/providers/gemini/transcript-repair-prompt.ts` | 120 |                                                                                                                                                                                       |
| `apps/api/.../providers/repair-divergence.spec.ts`                       | 328 |                                                                                                                                                                                       |
| `apps/api/.../providers/gemini-transcript-repair.spec.ts`                | 138 |                                                                                                                                                                                       |
| `benchmarks/stt/scripts/repair_display_hypotheses.mjs`                   | 127 | see hazard below                                                                                                                                                                      |
| `pipeline-translator.service.ts`                                         | —   | `DisplayRepair` (`:69`), `REPAIR_TIMEOUT_MS` (`:136`), `withDeadline` (`:144`), `repairDisplay()` (`:259`), the `repairDivergence` import (`:12`)                                     |
| Gemini provider                                                          | —   | `REPAIR_MODELS` (`:90`), `repair()`                                                                                                                                                   |
| `TranslationProvider.repair`                                             | —   | interface member, **declared optional at `translation-provider.ts:130`**, so no implementor breaks                                                                                    |
| `packages/ai-providers/src/index.ts`                                     | —   | `repairDivergence` / `MAX_REPAIR_DIVERGENCE` exports                                                                                                                                  |
| `benchmarks/prompt-injection`                                            | —   | the `kind: 'repair'` arm (`run.mjs:202` `REPAIR_MODEL`) and its corpus cases                                                                                                          |
| `session/turn-concurrency.ts`                                            | —   | `MAX_CONCURRENT_DISPLAY_REPAIRS` **and its `:100-110` doc comment**, which explains the ceiling by reference to the 25.1s repair — leave it and the code lies                         |
| `services/turn-metrics.recorder.ts`                                      | —   | `DisplayRepairMetrics` (`:85`), `recordRepair()` (`:197`), the `'repair'` sink kind (`:203`), and the `:75` latency comment. **Stranded by Phase 3's deletion of the `:463` caller.** |
| `providers/gemini-translation-provider.spec.ts`                          | —   | gemma assertions incl. `:381` (ladder ends at gemma) — **invert**, do not merely delete                                                                                               |
| `providers/register-default-providers.ts`                                | —   | `:102` "fell back to gemma" log comment                                                                                                                                               |

**KEPT: `repair-number-vocabulary.ts` (345 LOC).** The ITN needs its tiers; header
rewritten in Phase 2.

**PROTECTED — do not delete: `benchmarks/stt/data/display-repaired.jsonl`.** It is
the evidence record behind every number quoted in the brainstorm and cost real
quota. A thorough sweep will reach for it. It stays, and Phase 5 still scores it.

**`ws-events.ts` is NOT touched in this phase.** Two earlier drafts were wrong
about it and both were corrected:

- Red-team found the bidirectional contract doc at `:142-143` would become false.
  **D9 removed that problem at the source** — English gets its own ITN, so
  _"on `en_to_vi` the thing repaired is the English transcript"_ stays true.
- The additive `display?: string` field on `server.transcript.final` (D10) lands in
  **Phase 3**, with the wiring that produces it.

`server.transcript.display` stays declared and stops being emitted. Do not delete
it here — that is a breaking client change this plan does not take.

**KEPT: `score_display_repair.py`.** It scores the historical arm. The ITN arm got
its own entry in Phase 2; do not mutate this one's guard logic to serve both.

## D5 — `DEFAULT_MODELS` loses its last resort, deliberately

`packages/ai-providers/src/providers/gemini/gemini-translation-provider.ts:74`

```
- const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-31b-it'];
+ const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
```

This is the ladder for `POST /translate`, the REST **measurement baseline**, not
the product path. Measured p50s at `:68`: 3.5-flash-lite 553 ms, 3.1-flash-lite
557 ms, **gemma-4-31b-it 6884 ms**.

The live conversation path already contained no gemma
(`translation-model-policy.ts`: `FINAL_MODELS`, `SPECULATION_MODELS`,
`LIVE_TRANSLATION_MODELS` are all flash), which is why "remove gemma entirely" is
a day's work and not a week's.

Also removed: the shared-cooldown coupling at `:131-134`, where a repair 429 cooled
gemma for `POST /translate` too.

## Ordering hazards inside this phase

- **`repair_display_hypotheses.mjs` imports `repairDivergence` (`:27`) and drives
  `provider.repair()`.** It must die in the same commit as, or before,
  `repair-divergence.ts` and `repair()` — never after.
- **The prompt-injection `'repair'` arm calls `provider.repair()`.** Same commit.
  This is a **removal of an injection surface, not a mitigation** — with no model in
  the display path there is nothing left to attack. Say that in the commit message,
  or the deleted corpus reads as reduced coverage.
- `packages/ai-providers/src/index.ts` is touched in Phase 2 (add ITN export) and
  again here (remove guard exports). Sequential; never parallelize those phases.
- The `'repair'` metrics sink kind is append-only history. Removing the **writer**
  is safe; do not rewrite existing rows. No in-repo reader was found — confirm
  before deleting if any dashboard consumes the sink.

## Documentation

- Modify: `docs/codebase-summary.md`, `docs/system-architecture.md`, `README.md`,
  `benchmarks/stt/README.md`, `benchmarks/prompt-injection/README.md`
- Modify: `dump_display_hypotheses.py` and `score_display_repair.py` header docs —
  both describe a 3-step sequence whose step 2 is being replaced
- Modify: `score_display_repair.py:30` — its `MAX_REPAIR_DIVERGENCE` comment says
  "Must equal ... in `repair-divergence.ts`", a file this phase deletes. Reword it
  to a historical constant describing the repaired arm it still scores; do not
  delete the constant, which that arm's `shown()` still needs.
- **Leave `docs/development-journey.md`'s existing entries alone.** It is a dated
  record of what was tried; rewriting history there to match the present is exactly
  what a journey document must not do. Phase 5 adds a new dated entry.
- **Out of scope:** `.claude/skills/**` and `kits/**` mention gemma in unrelated
  vendor docs.

## Implementation Steps

1. Delete `repair_display_hypotheses.mjs` and the prompt-injection `'repair'` arm
   **first**, so nothing still imports what follows.
2. Delete `repair-divergence.ts`, its spec, and the index exports.
3. Delete the provider's `repair()` / `REPAIR_MODELS`, the interface member, and
   `transcript-repair-prompt.ts`.
4. Clean `pipeline-translator.service.ts` of the five symbols above.
5. Delete the `turn-metrics.recorder.ts` repair machinery and rewrite the
   `turn-concurrency.ts` doc comment.
6. `DEFAULT_MODELS` -> two flash models; update the comment above it, which
   currently justifies a 14,400/day reserve that no longer exists.
7. Invert `gemini-translation-provider.spec.ts:381` to assert the ladder **cannot**
   reach gemma.
8. Documentation sweep.
9. `pnpm -w typecheck && pnpm -w test` plus `benchmarks/prompt-injection`.

## Success Criteria

- [x] `grep -rn "repairForDisplay\|repairsInFlight\|MAX_CONCURRENT_DISPLAY_REPAIRS\|REPAIR_TIMEOUT_MS\|repairDivergence\|DisplayRepair\|recordRepair" apps packages` returns nothing outside `dist/`
- [x] A11 — `grep -rin gemma apps packages benchmarks docs README.md` returns only
      historical narrative in `docs/development-journey.md`
- [x] `DEFAULT_MODELS` has exactly two entries, both flash
- [x] Provider spec asserts the ladder cannot reach gemma
- [x] `display-repaired.jsonl` byte-identical (`git diff` empty)
- [x] `ws-events.ts` untouched by this phase (its additive change landed in Phase 3)
- [x] `TranslationProvider.repair` gone; no implementor broken
- [x] `benchmarks/prompt-injection` green with the repair arm removed
- [x] Full typecheck + test green

## Risk Assessment

**The REST endpoint's failure mode changes.** With both flash models exhausted,
`POST /translate` now errors instead of answering slowly.

**Signal:** benchmark runs that used to complete report failures near the daily
flash cap (500/day, against a measured 1.84 flash requests/turn from live traffic
on the same key).

**Pre-decided response:** this is intended (D5), not a regression to patch. For a
measurement baseline, failing clearly beats a number silently produced by a 6.9 s
model where a 553 ms one was assumed. If it becomes operationally painful the fix
is a separate key or a scheduled window — **not** re-adding gemma. D5 is a recorded
user decision; do not reverse it without asking.

**Largest deletion in the plan.** Keep it as its own commit series, separate from
Phase 3's wiring, so the wiring can be reverted without resurrecting 1,700 lines.
