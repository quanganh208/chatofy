# CLI Integration & Plan Scaffolding

The AgentKit CLI (`ak`) owns plan file scaffolding and phase state mutations.

## Files-First Architecture

- `plan.md` + `phase-NN-*.md` under `<timestamp>-<slug>/` in the configured plans directory (`plans/` by default) ARE the plan.
- `ak plan` (backed by a local `plans.db`) is a rebuildable index over those files, not the source of truth. Run `ak plan reindex` if index and files drift.
- A GitHub issue is an optional visibility projection; plans remain fully functional as local files without GitHub.

## CLI Scaffolding Rules

- Run `ak plan --help`, then the selected scaffolding subcommand with `--help`. Live help owns syntax and flags; do not copy a command schema into the plan.
- Default scope is project-local (`plans/` under current workspace root).
- Markdown plan creation goes through the CLI. If the selected scaffolding operation fails, report the error; do not fall back to direct Markdown file scaffolding.
- Do not edit the Phases table directly when it is CLI-owned; the CLI rewrites it from its own state, so a hand edit is silently discarded. Use the status and structure operations exposed by live help.
- In `--html` mode, write `plan.html` after the planning gates finish so it reflects the reviewed plan; `plan.md` stays the concise index.

## Mandatory Generated-File Read Pass

After CLI scaffolding and before composing replacement content, read `plan.md`
and every generated `phase-*.md` stub, including future phases. Write or edit
the full content only after that read pass.

## Canonical Phase File Template

```markdown
---
phase: <N>
title: "<Phase Name>"
status: pending       # pending | in-progress | completed
priority: P2          # P1 | P2 | P3
effort: ""            # e.g. "4h", "2d"
dependencies: []      # phase IDs this blocks on
---

# Phase <id>: <Name>

## Goal
[One clear sentence defining what this phase accomplishes]

## Files to Create / Modify
- Create: `path/to/file.ts`
- Modify: `path/to/existing.ts`

## Tasks & Steps
1. [Concrete actionable step]
2. [Concrete actionable step]

## Verification
- [Command to verify]
```
