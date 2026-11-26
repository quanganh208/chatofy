# Output Standards

## Plan File Format

### YAML Frontmatter (Required for plan.md)

Every `plan.md` starts with this frontmatter; the plan index parses it, and a
file without it is invisible to the store:

```yaml
---
title: "{Brief plan title}"
description: "{One-sentence summary for card preview}"
status: pending  # pending | in-progress | completed | cancelled
priority: P2     # P1 (High) | P2 (Medium) | P3 (Low)
effort: 4h       # Estimated total effort
issue: <issue-number>  # GitHub issue number (if applicable)
branch: <owner>/feat/<feature-name>
tags: [frontend, api]  # Category tags
blockedBy: []    # Same-scope refs by default; use global:/project: for cross-scope
blocks: []       # Example: [project:<timestamp>-user-dashboard]
created: <date>
---
```

### Auto-Population Rules

- **title**: from the task description
- **description**: first sentence of the Overview section
- **status**: `pending` for new plans
- **priority**: from the request, default `P2`
- **effort**: sum of phase estimates
- **issue**: parsed from branch name or context
- **branch**: `git branch --show-current`
- **tags**: inferred from task keywords
- **blockedBy** / **blocks**: detected during the pre-creation scan (`[]` if none)
- **created**: today's date in YYYY-MM-DD format

### Cross-Scope Reference Syntax

- Bare reference: `<timestamp>-auth-system`
  - Meaning: same scope as the current plan.
- Global reference: `global:<timestamp>-auth-system`
  - Meaning: resolve against the configured global plans root.
- Project reference: `project:<timestamp>-auth-system`
  - Meaning: resolve against the current project plans root.

Missing references should warn and render as `not found`. They should not block plan creation.

### Tag Vocabulary (Recommended)

- **Type**: `feature`, `bugfix`, `refactor`, `docs`, `infra`
- **Domain**: `frontend`, `backend`, `database`, `api`, `auth`
- **Scope**: `critical`, `tech-debt`, `experimental`

## Output Requirements

- Provide the plan file path and a summary. With `--html`, give the `plan.html`
  path first and say it is authoritative.
- Make plans self-contained: specific file paths, concrete steps, and
  acceptance criteria per task.
- Ask the user about unresolved questions at the end via `ask_user capability`
  (decisions needing input, unknowns affecting implementation, business
  trade-offs), then revise the plan and phases based on the answers.
