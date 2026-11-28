# Workflow Modes

## Auto-Detection (Default Planning Mode)

When no flag specified, analyze task and pick mode:

| Signal | Mode |
|--------|------|
| Simple task, clear scope, no unknowns | fast |
| Complex task, unfamiliar domain, new tech | hard |
| Major refactor, 5+ areas, architectural debt | deep |
| 3+ independent features/layers/modules | parallel |
| Ambiguous approach, multiple valid paths | two |

Use `ask_user capability` if detection is uncertain. `debate` and `ultra` are never detection outcomes — each is explicit opt-in only (`--debate`, `--ultra`).

The scope challenge (`scope-challenge.md`) runs before mode detection and can suggest a mode; explicit mode flags still win. `--fast` changes planning depth only; it does not authorize scope reduction. Preserve the full requested scope unless the user passes `--yagni` or directly instructs a named cut.

## Fast Mode (`--fast`)

No research. Analyze → Plan → Hydrate Tasks. Fast mode reduces workflow depth, not the requested product scope.

1. Read repository instructions and the current requirements, architecture, and standards they point to; confirm them against relevant source and tests.
2. Write the plan.
3. Hydrate tasks (unless `--no-tasks`).
4. **Implementation option:** `/ak-cook {absolute-plan-path}/plan.md`, run only after the user chooses it.

## Hard Mode (`--hard`)

Research → Scout → Plan → Red Team → Validate → Hydrate Tasks.

1. Research with at most 2 `researcher` agents in parallel.
2. Use `/ak-scout` when owning evidence is missing or ambiguous.
3. Plan from the research and scout reports (the `planner` subagent can take this when the plan is large).
4. Post-plan red team review (see `red-team-workflow.md`) and validation (see `validate-workflow.md`).
5. Hydrate tasks (unless `--no-tasks`).

## Deep Mode (`--deep`)

Per-phase scouting for large architectural overhauls.

1. Research + Scout Phase 1.
2. Plan Phase 1 in detail, outline Phases 2+.
3. During cook, each subsequent phase gets a dedicated scout pass before execution.
4. Post-plan red team review & validation.

## Parallel Mode (`--parallel`)

1. Design a decoupled modular architecture.
2. Decompose into phases with strictly disjoint file ownership, declared per phase, so parallel executors cannot conflict.
3. Post-plan red team review & validation.
4. Offer `/ak-cook --parallel` as the implementation option; run it only after the user chooses it.

## Two Approaches Mode (`--two`)

1. Research two viable technical approaches.
2. Draft candidate architectures and a trade-off matrix.
3. Present approaches via `ask_user capability`.
4. Materialize the selected approach into full plan phases.

## Debate Mode (`--debate`)

3 independent planner subagents draft candidate plans in parallel; the orchestrator synthesizes one plan. See `debate-mode.md`.

## Ultra Verifier Mode (`--ultra`)

Best-of-5 independent candidate plans scored by a single strongest-model verifier (`kongming`); the winning plan is materialized unchanged. See `ultra-mode.md`.
