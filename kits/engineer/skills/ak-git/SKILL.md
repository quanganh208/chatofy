---
name: ak-git
description: "Run Git staging, commits, pushes and merges with conventional commits, auto-split by type/scope, and secret scanning."
when_to_use: "Invoke for merges, PRs, stacked PRs, branch hygiene or release steps."
category: workflow
keywords: [git, commits, staging, PR, merge, merge-pr, stack, stacked-prs, ci]
argument-hint: "cm|cp|pr|merge|merge-pr|stack [args]"
metadata:
  author: agentkit
  version: "1.2.3"
---

# Git Operations

## Default (No Arguments)

If invoked without arguments, use `ask_user capability` to present available git operations:

| Operation | Description |
|-----------|-------------|
| `cm` | Stage files & create commits |
| `cp` | Stage files, create commits and push |
| `pr` | Create Pull Request |
| `merge` | Merge branches |
| `merge-pr` | Merge a GitHub PR + watch CI to green |
| `stack` | Drive GitHub native Stacked PRs (`gh stack`) |

Present as options via `ask_user capability` with header "Git Operation", question "What would you like to do?".

Execute simple scoped operations directly when supported. Delegate only when isolation
or coordination benefits the task and delegation is permitted. Load context-engineering
only for an actual context/budget problem.

**IMPORTANT:**
- Lead with the outcome. Keep reports short by being selective, not by compressing the writing into fragments or arrow chains; write complete sentences.
- When you do delegate, put the resolved rules, paths and branch names in the brief.

## Arguments
- `cm`: Stage files & create commits
- `cp`: Stage files, create commits and push
- `pr`: Create Pull Request [to-branch] [from-branch]
  - `to-branch`: Target branch (default: main)
  - `from-branch`: Source branch (default: current branch)
- `merge`: Merge [to-branch] [from-branch]
  - `to-branch`: Target branch (default: main)
  - `from-branch`: Source branch (default: current branch)
- `merge-pr`: Merge PR [pr-ref] via `gh`, then watch post-merge CI until green and verify
  - `pr-ref`: PR number or URL (required)
  - Readiness-gated: refuses on conflicts, red CI, or `CHANGES_REQUESTED`; uses `--auto` when checks are pending
- `stack`: Drive GitHub native Stacked PRs through the `gh stack` extension
  - Lifecycle: `init` → `add` → `submit --auto` → `sync`/`rebase` → `merge`
  - Guardrail: history-rewriting and multi-PR merge steps are user-gated; force-push stays scoped to stack branches
  - See `references/workflow-stacked-prs.md` for the full command surface and exit-code stop conditions

## Quick Reference

| Task | Reference |
|------|-----------|
| Commit | `references/workflow-commit.md` |
| Push | `references/workflow-push.md` |
| Pull Request | `references/workflow-pr.md` |
| Merge | `references/workflow-merge.md` |
| Merge PR | `references/workflow-merge-pr.md` |
| Stacked PRs | `references/workflow-stacked-prs.md` |
| Standards | `references/commit-standards.md` |
| Safety | `references/safety-protocols.md` |
| Branches | `references/branch-management.md` |
| GitHub CLI | `references/gh-cli-guide.md` |

## Core Workflow

### Step 1: Stage + Analyze
```bash
git status --short
git diff -- <authorized-paths>
git add -- <authorized-paths>
git diff --cached --stat
git diff --cached --name-only --no-renames
```

### Step 2: Security Check
Scan the staged diff for value-shaped secrets, not bare keywords. Prefer an installed
scanner (for example `gitleaks protect --staged --redact`); otherwise scan the staged files:
```bash
git diff --cached --name-only -z --diff-filter=ACMR \
  | xargs -0 git grep --cached -nE '(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|(^|[^A-Za-z0-9])sk-(proj-|live_|test_)?[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|[a-z][a-z0-9+.-]*://[^/[:space:]:@]+:[^/[:space:]@]+@)' -- \
  | cut -d: -f1,2
```
Check each hit's context once. A keyword such as `token` or `password` alone is not a secret.
**Only a real credential blocks the commit:** report `file:line` with the value redacted and
suggest `.gitignore` or a secret store. See `references/safety-protocols.md`.

### Step 3: Split Decision

**NOTE:**
- Search for related issues on GitHub and add to body.
- Choose commit type/scope from repository policy and actual change, including skill/docs edits. Preserve unrelated staged changes; verify staged scope before committing.

**Split commits if:**
- Different types mixed (feat + fix, code + docs)
- Multiple scopes (auth + payments)
- Config/deps + code mixed
- FILES > 10 unrelated

**Single commit if:**
- Same type/scope, FILES ≤ 3, LINES ≤ 50

### Step 4: Commit
```bash
git commit -m "type(scope): description"
```

## Output Format
```
✓ staged: N files (+X/-Y lines)
✓ security: passed
✓ commit: HASH type(scope): description
✓ pushed: yes/no
```

## Error Handling

| Error | Action |
|-------|--------|
| Real credential detected | Block commit, report `file:line` redacted |
| No changes | Exit cleanly |
| Push rejected | Suggest `git pull --rebase` |
| Merge conflicts | Suggest manual resolution |

## References

- `references/workflow-commit.md` - Commit workflow with split logic
- `references/workflow-push.md` - Push workflow with error handling
- `references/workflow-pr.md` - PR creation with remote diff analysis
- `references/workflow-merge.md` - Branch merge workflow
- `references/workflow-merge-pr.md` - PR merge with post-merge CI watch and verification
- `references/workflow-stacked-prs.md` - GitHub native Stacked PRs via `gh stack` (lifecycle + safety)
- `references/commit-standards.md` - Conventional commit format rules
- `references/safety-protocols.md` - Secret detection, branch protection
- `references/branch-management.md` - Naming, lifecycle, strategies
- `references/gh-cli-guide.md` - GitHub CLI commands reference
