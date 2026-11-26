# Plan Creation & Organization

## Directory Structure

### Plan Location

Use `Plan dir:` from `## Naming` section injected by hooks. This is the full computed path.

Default scope:
- project scope → `plans/<timestamp>-authentication/`
- global scope → `{configured-global-plans-root}/<timestamp>-authentication/`
  - Default when unset: `~/.claude/plans/<timestamp>-authentication/`

Use global scope only when `--global` is explicit or there is no project context.

### File Organization

```
{plan-dir}/                                    # From `Plan dir:` in ## Naming
├── research/                                  # researcher-XX-report.md
├── reports/                                   # scout and researcher reports
├── assets/                                    # Generated image sources for plan.html
├── plan.md                                    # Overview access point
├── plan.html                                  # Primary artifact when --html is used
├── wiki-publish.md                            # Optional combined doc when --wiki publishes Markdown
├── phase-01-setup-environment.md
└── phase-02-implement-database.md
```

### Active Plan State

Check `## Plan Context` injected by hooks for active/suggested/none state. After
creating a plan, use the active plan mechanism provided by the host project or
dashboard. Active plans use the plan-specific reports path; suggested plans use
the default path.

## File Structure

### Overview Plan (plan.md)

Frontmatter schema: see `output-standards.md`. When `--html` is active,
`plan.md` may be a concise index that links to `plan.html`, summarizes phases,
and keeps GitHub issue metadata stable. Keep `plan.md` under about 80 lines and
link to the phase files for detail.

**Example plan.md body:**
```markdown
# Feature Implementation Plan

## Overview

Brief description of what this plan accomplishes.

## Cross-Plan Dependencies

| Relationship | Plan | Status |
|-------------|------|--------|
| Blocks | `global:<timestamp>-user-dashboard` | pending |

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Setup Environment](./<setup-phase>.md) | Pending |
| 2 | [Core Implementation](./<implementation-phase>.md) | Pending |
| 3 | [Testing & Validation](./<test-phase>.md) | Pending |

<!-- Link text is the human-readable phase name, not the filename. -->

## Dependencies

- List key dependencies here
```

Reference rules:
- Bare refs stay in the current scope.
- Use `global:` or `project:` when the dependency crosses scopes.
- The live plan CLI's status operation is authoritative for resolved dependency state; confirm its invocation through help.

### Phase Files (phase-XX-name.md)

Follow the consuming repository's instruction and development-standard
documents; do not assume a fixed docs path. Start from the canonical template in
`cli-integration.md` and add, where relevant: context links, key insights from
research, functional and non-functional requirements, architecture and data
flow, related files to create/modify/delete, a todo checklist, success criteria,
risk assessment, security considerations, and next steps.

### Deep / TDD Extensions

When `--deep` is used, add:
- a file inventory table with action, rough size, and test impact
- a test scenario matrix for critical, high, and medium paths
- a dependency map that calls out links to other phases

When `--tdd` is used, add:
- a **Tests Before** section for regression coverage written first
- a **Refactor** section describing the protected code changes
- a **Tests After** section for new behavior introduced in that phase
- a regression gate listing the compile/test command that must pass
