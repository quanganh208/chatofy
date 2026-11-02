---
phase: 1
title: 'Review-arm replay rig'
status: completed
effort: '0.5d'
---

# Phase 01: Review-arm replay rig

## Goal

For every judged corpus turn, produce the translation a candidate review pass would have shown, using the prod prompt and the prod acceptance rules. The output is a turns file that `judge.mjs` can read unchanged.

## Context

- **Corpus:** `benchmarks/translation-judge/data/turns.scribed.jsonl` holds 162 turns with a translation.
  - Each row has `conv`, `pos`, `direction`, `source` (the app's hearing), `scribe_source`, `translation` (as stored) and `context` (the previous 4 turns as {source, translation}).
- **Prod pass:** `OpenAiCompatibleTranslationPolisher` with `buildPolishInstruction` and `buildPolishUserMessage`, all exported by `@chatofy/ai-providers`.
  - The prompt uses at most 3 context turns (`MAX_CONTEXT_TURNS`).
  - `accept()` rejects answers that do not look like a translation; a rejected answer means the draft stands.
- **Prod context:** `ConversationContext.recall(socket)` returns the earlier utterances' source texts, in every language. The arm feeds the same thing, the earlier turns' `source`.

## Arms

| arm | translation shown                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------- |
| 0   | the stored translation (baseline; no call)                                                                        |
| 1   | the polisher on the app's hearing, **no context**: what prod does today                                           |
| 2   | the polisher with the earlier turns' sources as `context`                                                         |
| 3   | optional, built only if phase 02 says arm 2 leaves more than half of the vi→en `mt` errors: critique-then-rewrite |

The polisher is called on **every direction**, as prod calls it, so the en→vi guard is measured.

The draft fed to the polisher is the stored translation. This is not quite what prod polished: a stored line may already be a polished line, and no record says which. This is the plan's main validity caveat. It cuts in the direction of a conservative estimate, because polishing an already-polished line has less to fix.

## Files

- **Create `benchmarks/translation-judge/review-arms.mjs`.**
  - Flags: `--arm 1|2`, `--model` (default `deepseek-v4-pro`), `--out`, `--budget-usd` (default 0.5), `--concurrency`, `--limit`, `--resume`.
  - Key: `OPENAI_COMPATIBLE_API_KEY`, from the env or `apps/api/.env`, as `loadAnthropicKey` does. Never printed.
  - Before the first call it checks `GET https://api.deepseek.com/user/balance` and refuses below $1.00.
  - Builds `OpenAiCompatibleTranslationPolisher` with base URL `https://api.deepseek.com`, thinking disabled (as the `deepseek` host row does), and an `onCall` hook that records tokens and latency.
  - Writes `data/arms/arm-<n>-<model>.jsonl`. Each row is the corpus row with `translation` replaced and `arm`, `rewritten`, `ms`, `costUsd` added.
  - Cost comes from the reported tokens × the DeepSeek price, cached in the file with its date.
- **Modify `benchmarks/translation-judge/package.json`:** only if the provider package must be referenced explicitly. Prefer the workspace import the other `benchmarks/*` harnesses use (`benchmarks/translation-providers.mjs`).
- **Modify `benchmarks/translation-judge/judge.test.mjs`:** add tests for the pure parts: the context built for a row, the arm-0 passthrough, and the budget stop. No network.
- **Modify `benchmarks/translation-judge/README.md`:** add an "Arms" section with the commands.

## Steps

1. Read `benchmarks/translation-providers.mjs` for how benchmarks import `@chatofy/ai-providers` (it needs a built package).
2. Write the rig and its tests, then run `node --test judge.test.mjs`.
3. Smoke run: `--arm 2 --limit 5`. Check that the rows are well formed, `rewritten` makes sense, and the cost per call is measured.
4. Full arms 1 and 2. Record cost, p95 `ms` and rewrite rate per direction.

## Validation

- Tests pass.
- Each arm file has 162 rows, failures marked as such.
- Reviewer spend stays under `--budget-usd`, and the DeepSeek balance after the run is ≥ $1.00.

## Risks and rollback

- **Low balance:** the rig stops at its cap. Ask the user to top up; never drain the prod key.
- **Rollback:** the rig is a benchmark file, so deleting it is the rollback.
