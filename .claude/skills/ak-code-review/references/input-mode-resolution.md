---
name: input-mode-resolution
description: How to parse code-review arguments and resolve PR number, commit hash, pending changes, or default context into a reviewable diff
---

# Input Mode Resolution

Resolve `the installed code-review skill` arguments into a diff for the review pipeline.

## Auto-Detection Rules

Parse arguments left-to-right. First match wins.

| Pattern | Mode | Example |
|---------|------|---------|
| `#\d+` | PR | `#123`, `#45` |
| GitHub PR URL | PR | `https://github.com/org/repo/pull/123` |
| `[0-9a-f]{7,40}` | Commit | `abc1234`, full SHA |
| `--pending` | Pending | explicit flag |
| `codebase` | Codebase | existing mode |
| *(none + context)* | Default | recent changes |
| *(none + no context)* | Prompt | ask user via `ask_user capability` |

Input that could be a PR or a commit resolves as a PR; state the assumption.

## Context per mode

Resolve the diff with `gh pr diff` (PR), `git show` (commit) or `git diff HEAD` (pending:
staged plus unstaged). Pass reviewers the intent, the full diff and the changed-file list:

- PR: title, description and base branch.
- Commit: commit message and parent.
- Pending: there is no commit message yet, so ask the user for a one-line intent.
- Default: recent changes already in the conversation; with none, fall back to Prompt.
- Prompt: for a PR or commit choice, ask a second question for the number or hash.

Codebase modes skip diff resolution: `codebase` hands off to
`references/codebase-scan-workflow.md`, `codebase parallel` to
`references/parallel-review-workflow.md`.

## Pipeline Handoff

```
Resolved diff
  ├─ Changed files → Edge case scout
  ├─ Full diff → Stage 1 (Spec compliance, if plan exists)
  ├─ Full diff → Stage 2 (Code quality review)
  └─ Findings → Fix accepted issues and verify
```

Report a missing PR, an unknown commit (it may be unpushed) or an empty pending diff
instead of reviewing nothing.
