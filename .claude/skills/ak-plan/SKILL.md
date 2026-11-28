---
name: ak-plan
description: "Create, validate or review implementation plans with acceptance criteria and executable phases; cook implements them."
when_to_use: "Invoke when work needs phases, architecture or a roadmap."
category: workflow
keywords: [planning, architecture, phases, roadmap, html, github, wiki, agentwiki, publish]
argument-hint: "[task] [--fast|--hard|--deep|--parallel|--two|--debate|--ultra] [--tdd|--no-tasks] [--html] [--ak-render] [--github] [--wiki] [--advice] [--yagni] [--skip-journal] [--no-antv|--no-diagram-design|--no-editorial-visuals] OR [archive|red-team|validate]"
license: Proprietary
metadata:
  author: agentkit
  version: "2.3.2"
---

# Plan (`ak-plan`)

Create structured, verifiable implementation plans with phased execution roadmaps, architecture diagrams, and testing strategies.

## Plan Location & Invariants

- **Location**: All plans live under `plans/<timestamp>-<descriptive-slug>/`.
- **Primary Files**: `plan.md` (index/summary) and `phase-NN-<name>.md` (execution details). `NN` is a whole number (`phase-02-api.md`); split work gets its own number, never a letter suffix such as `phase-02a-*`, which `ak plan` does not track and `ak plan validate` rejects.
- **HTML Artifact**: When `--html` is passed, `plan.html` is the authoritative user-facing plan deliverable.
- **Task Hydration**: Phases hydrate into project task management unless `--no-tasks` is specified.

## Mode & Subcommand Routing

| Mode / Subcommand | Flag / Argument | Purpose | Reference |
|---|---|---|---|
| **Auto-Detect** | (none) | Analyzes task complexity and chooses appropriate mode | `references/workflow-modes.md` |
| **Fast** | `--fast` | 0 research; direct analysis and rapid plan creation | `references/workflow-modes.md` |
| **Hard** | `--hard` | Deep research, codebase scouting, red-team review, validation | `references/workflow-modes.md` |
| **Deep** | `--deep` | Multi-phase exploration for complex/large-scale migrations | `references/workflow-modes.md` |
| **Parallel** | `--parallel` | Generates parallel-executable phases with strict file ownership | `references/workflow-modes.md` |
| **Two Approaches** | `--two` | Compares two distinct architectural approaches with trade-offs | `references/workflow-modes.md` |
| **Debate** | `--debate` | Persona debate before selecting the optimal strategy | `references/workflow-modes.md` |
| **Ultra** | `--ultra` | Best-of-5 verifier pass; strongest-model selection | `../ak-brainstorm/references/ultra-verifier-mode.md` |
| **Validate** | `validate <path>` | Runs critical questions validation gate on a plan | `references/validate-workflow.md` |
| **Red-Team** | `red-team <path>` | 4-persona adversarial review (Assumptions, Failure, Scope, Security) | `references/red-team-workflow.md` |
| **Archive** | `archive [slug]` | Finalizes and archives closed/completed plans | `references/archive-workflow.md` |

## Flag Modifiers

- **`--html`**: Outputs a self-contained, interactive editorial HTML plan (`plan.html`). Follows the shared contract in `../ak-preview/references/html-skill-composition.md` (activates `ak-frontend-design` then `ak-diagram`). See `references/html-output.md`.
- **`--ak-render`**: Opt-in (implies `--html`): compile `plan.html` from `plan.page.yaml` with the pinned AK Render CLI instead of hand-writing it (also selected by a project `.ak-render/` directory). See `../ak-preview/references/ak-render-route.md`.
- **`--github`**: Creates/updates a GitHub issue with plan summary and links. See `references/github-wiki-publish.md`.
- **`--wiki`**: Publishes reviewed plan to AgentWiki. See `references/github-wiki-publish.md`.
- **`--advice`**: Runs under `kongming` advisory supervision and writes the plan for handover to a lower-capability executor model: per-task success criteria, mechanical verification, and a per-phase Failure Protocol. See `references/advice-handover-plan.md` for the artifact contract and `../ak-brainstorm/references/advisory-supervision.md` for supervisor identity and model routing.
- **`--tdd`**: Enforces test-first design, test matrix, and verification commands in every phase.
- **`--no-tasks`**: Skips hydrating phases into task management.
- **`--yagni`**: Actively challenges and eliminates any scope not strictly necessary for the stated outcome (see `references/scope-challenge.md`).
- **`--skip-journal`**: Skips session journal entry generation during plan archive.
- **Visual Kill Switches**: `--no-antv`, `--no-diagram-design`, `--no-editorial-visuals` disable specific editorial visual layers (see `references/html-output.md`).

### Mode Exclusivity

The mode flags — `--fast`, `--hard`, `--deep`, `--parallel`, `--two`, `--debate`, `--ultra`, and this skill's own `--auto` (mode-detection, distinct from `/ak-cook`'s auto-approve `--auto`) — are mutually exclusive. Passing two is a hard stop naming both flags and the reason, never a silent override. `--debate` and `--ultra` are explicit opt-in only and are never auto-selected.

## Planning pipeline

Resolve modes and modifiers before reading their references, and load only the
selected route. Reuse the accepted outcome, constraints, non-goals and acceptance
criteria. Plan files remain execution authority; HTML is the requested
presentation, not a replacement for phase state.

1. **Intake & Scope Challenge**: see `references/scope-challenge.md`.
2. **Research & Scout** (when the mode calls for it): see `references/research-phase.md`, `references/codebase-understanding.md`.
3. **Plan Drafting**: scaffold with `ak plan` per `references/cli-integration.md`, then write the plan per `references/plan-organization.md`, `references/output-standards.md`, `references/solution-design.md`, and the Extension trace below.
4. **Red-Team Gate (when selected mode requires it)**: resolve all blockers (see `references/red-team-workflow.md`).
5. **Validation Gate**: see `references/validate-workflow.md`.
6. **Whole-Plan Sweep**: verify links, frontmatter, and invariants across all phase files.
7. **HTML Artifact (if `--html`)**: see `references/html-output.md`.
8. **Hydrate Tasks** (unless `--no-tasks`): see `references/task-management.md`.
9. **GitHub / Wiki (if `--github` / `--wiki`)**: see `references/github-wiki-publish.md`.
10. **Handoff**: report plan path, summary, and the next-step options (implement with `/ak-cook`, validate, red-team, revise, or end), then stop for the user's choice. Planning never starts implementation; see the approval boundary in `references/post-plan-handoff.md`.
11. **Journal**: Run `/ak-journal` to write a concise technical journal entry on completion. See the shared "Journal step — opt-out" block below.

Plans create only the plan; they do not implement it.

### Extension trace

During Plan Drafting, when the plan creates or changes a boundary that evidenced variants share, trace one credible next variant (provider, runtime, tenant, workflow, or policy) through it: name the contract that stays stable, the pieces that must change, and how the plan proves that claim. A material risk becomes an ordinary task or acceptance check in the owning phase, never a new mode, phase, or speculative scaffolding (registry, factory, plugin system, config layer) with no second real case. Keep one real case concrete unless the user requested the seam; then plan it and record its cost. A local fix or a plan with no meaningful variation skips the trace.

### Journal step — opt-out

Skip the automatic `/ak-journal` step when either applies:
- The invocation includes the `--skip-journal` flag, OR
- `ak config prefs resolve --json | jq -r 'if [.prefs?.journal?.auto?] == [false] then "false" else "true" end'` returns `false`. If the command errors or prints anything other than the exact string `false`, treat as `true` (default) — corrupt or missing config never suppresses the automatic journal.

Precedence: flag > project config > user config > default (`true`). When skipped, print one line: `journal skipped by --skip-journal` (flag) or `journal skipped by preference` (config). Explicit `/ak-journal` and `ak journal create` are unaffected.
