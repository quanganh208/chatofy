---
name: ak-ship
description: "Ship a completed branch via tests, review, commit, push and PR, with official/beta aliases, Kongming advice and reviewed merge plus CI convergence."
when_to_use: "Invoke when work is done and needs a PR."
category: workflow
keywords: [ship, PR, merge, push, release, advice, kongming, review-pr]
argument-hint: "[official|stable|main|beta|dev|next] [--both] [--advice] [--merge] [--skip-tests] [--skip-review] [--skip-journal] [--skip-docs] [--social] [--yes-post] [--yes-post-private] [--dry-run]"
license: Proprietary
metadata:
  author: agentkit
  version: "2.4.2"
---

# Ship: Unified Ship Pipeline

Single command to ship a feature branch. Continue through authorized repairs and verification; stop for evidenced external blockers or unresolved material decisions.

## Arguments

| Flag | Effect |
|------|--------|
| `official`, `stable`, `main` | Canonical mode `official`: ship to the detected default branch with docs + journal |
| `beta`, `dev`, `next` | Canonical mode `beta`: ship to the detected development branch; skips docs update |
| `--both` | Dual-target ship: beta stage, then a gated stable stage (see Dual-target ship) |
| `--advice` | Run the ship-to-PR path under advisory-only `kongming` supervision |
| `--merge` | After PR creation, activate `ak-review-pr <PR> --fix --reply --merge`; append `--advice` when both flags are present |
| `--skip-tests` | Skip Step 4 (tests already passed on this revision) |
| `--skip-review` | Skip Step 5 local review only |
| `--skip-journal` | Skip Step 8 journal (also honors `journal.auto=false`) and the whole social step |
| `--skip-docs` | Skip Step 9 docs update |
| `--social` | Opt-in Step 14 build-in-public post; dry-run unless `--yes-post` |
| `--yes-post` | With `--social`, actually publish |
| `--yes-post-private` | With `--social --yes-post`, second opt-in required for a private repo |
| `--dry-run` | Show what would happen without executing |

## Ship Mode Detection

```
Normalize one positional mode token before side effects:
  - official | stable | main → official
  - beta | dev | next        → beta
  - multiple or unknown tokens, including unknown `--flags` → stop and ask; never guess
If mode = "official" → target = main/master (auto-detect default branch)
If mode = "beta"     → target = dev/beta/develop (auto-detect dev branch)
If no mode token      → infer from current branch naming:
  - feature/* hotfix/* bugfix/* → official (target main)
  - dev/* beta/* experiment/*  → beta (target dev/beta)
  - unclear                    → ask_user capability
```

Aliases select a canonical mode; they do not force a literal branch name.

## Dual-target ship (`--both`)

`--both` runs the beta pipeline first, then a gated stable stage. It
supersedes a positional mode token (warn once and continue) and composes with
`--advice`, `--merge`, and the skip flags. With `--dry-run`, it simulates the
beta stage only. Load `references/dual-stage-workflow.md` for the stable stage
gate, the promotion path with its unrelated-work stop, and the completion
contract.

## Advisory supervision (`--advice`)

When `--advice` is present, the workflow MUST spawn `kongming` to supervise
the local ship-to-PR path, because the flag's entire contract is that a
supervisor saw the change. Load `../ak-brainstorm/references/advisory-supervision.md`
for supervisor identity, host detection, and model routing. Kongming returns
counsel, never code; the main agent remains responsible for every decision,
edit, and gate.

Mandatory checkpoints:

- **After pre-flight, before mutation:** canonical mode, target, branch/diff
  summary, constraints; ask for go/no-go and the highest risk to watch.
- **After tests and local review, before versioning/commit/push/PR writes:**
  test evidence, findings and fixes, intended PR scope; ask whether the
  evidence supports proceeding.
- **When stuck or before a high-stakes decision:** approaches tried and the
  exact blocker or irreversible choice.

Empty/error counsel is recorded as a non-fatal advisory failure; authoritative
ship gates still decide whether to proceed. If `--advice` is present and no
delegation call occurs, the workflow is incomplete.

When `--merge` is also present, forward `--advice` to `ak-review-pr`. That skill
exclusively owns PR-level advisory checkpoints, review/fix/reply, merge
readiness, and post-merge CI. `--advice` never bypasses tests, review
blockers, branch protection, security policy, or the downstream
merge-readiness gate.

## Batch-landing repositories

Some repositories land pull requests through their own batch-landing owner (a
merge train, landing bot, or scheduled routine) rather than per-PR CI and
author merges. Treat a repository as batch-landing only when its own
instructions (`CLAUDE.md`, `AGENTS.md`, or its contributing or workflow docs)
declare that owner; never infer it from branch names or missing CI. When they
do:

- Run the local verification those instructions require, and put the evidence
  they name (for example a verification receipt line) in the PR body.
- Create the PR ready for review. Keep it draft only when that evidence is
  missing.
- Stop after Step 12b, even with `--merge`: skip Step 13, and do not enable
  auto-merge, update the branch, merge, or wait for PR checks. Report
  `Merge=delegated` with the landing owner and `CI=n/a`.
- Social publishing (Step 14) waits for the landing owner's merge; report it
  as not yet eligible.

## When to stop and ask

- On the target branch already: abort.
- Merge conflicts that can't be auto-resolved: stop and show them.
- Test failures outside repair authority, unavailable dependencies/credentials, or repeated unresolved failure: report exact evidence and remaining work.
- Critical findings that need a scope/product decision, or a major/minor version bump: ask_user capability.

Decide everything else yourself (patch bump, changelog, commit message; skip
version/changelog steps when the files are absent). Ship only files owned by
this task; preserve unrelated dirty files.

## Pipeline

```
Step 1:  Pre-flight      → Branch check, mode detection, status, diff analysis
Step 2:  Link Issues      → Find/create related GitHub issues
Step 3:  Merge target     → Fetch + merge origin/<target-branch>
Step 4:  Run tests        → Auto-detect test runner, run, check results
Step 5:  Review           → Two-pass checklist review (critical + informational)
Step 6:  Version bump     → Auto-detect version file, bump patch/minor
Step 7:  Changelog        → Auto-generate from commits + diff
Step 8:  Journal          → Write technical journal via /ak-journal (see the shared "Journal step — opt-out" contract: --skip-journal flag or journal.auto config skips)
Step 9:  Docs update      → Update project docs via /ak-docs update (official only)
Step 9b: Finalize plan    → ak plan update --status completed (plan-backed; foreground, staged by Step 10)
Step 10: Commit           → Conventional commit with version/changelog
Step 11: Push             → git push -u origin <branch>
Step 12: Create PR        → gh pr create with structured body + linked issues
Step 12b: Link plan↔PR    → ak plan update --linked-pr <n> (plan-backed; no close until merge)
Step 13: Review + merge   → if --merge: ak-review-pr <PR> --fix --reply --merge [--advice] (skipped in batch-landing repositories)
Step 14: Social publish   → if --social: after Step 13 terminal-green when merging; otherwise after the existing green-PR-check gate
```

**Detailed steps:** Load `references/ship-workflow.md`
**Auto-detection:** Load `references/auto-detect.md`
**PR template:** Load `references/pr-template.md`

## Build-in-public publishing (`--social`)

Without `--social`, no social step runs. With it, Step 14 composes a
build-in-public draft from the PR/issue/plan context, persists it via
`ak journal create`, then publishes to the `groups.build_in_public` channels
in `.agentkit/journal.yaml` (all configured channels if that group is absent).
No flag bypasses its guardrails: green CI, a journal record (so
`--skip-journal` skips the step, while `journal.auto = false` does not),
collaborator-only review quotes, dry-run without `--yes-post`, and
`--yes-post-private` for private repos. Commands:
`references/release-and-social-workflow.md` (Step 14).

## Output Format

```
✓ Pre-flight: branch feature/foo, 5 commits, +200/-50 lines (mode: official)
✓ Issues: linked #42, created #43
✓ Merged: origin/main (up to date)
✓ Tests: 42 passed, 0 failed
✓ Review: 0 critical, 2 informational
✓ Version: 1.2.3 → 1.2.4
✓ Changelog: updated
✓ Journal: written (background) / skipped (opt-out via --skip-journal or journal.auto)
✓ Docs: updated (background)
✓ Committed: feat(auth): add OAuth2 login flow
✓ Pushed: origin/feature/foo
✓ PR: https://github.com/org/repo/pull/123 (linked: #42, #43)
✓ Advice: 2 checkpoints completed / failed with reason / not requested
✓ Review: Approve / blocked(reason) / not requested
✓ Merge: merged / delegated(landing owner) / blocked(reason) / not requested
✓ CI: green / red / pending / n/a
```

## Rules

- **Tests gate the ship.** Run them unless valid same-revision evidence supports `--skip-tests`. Fix authorized branch-caused defects and rerun affected checks; do not advance to publication with red evidence.
- **Never force-push.** A force push rewrites history other people have already pulled.
- **Fresh-context review.** Step 5 goes to a `code-reviewer` subagent that has not seen this conversation.
- **Reviewed merge delegation.** `--skip-review` skips only Step 5; the downstream `ak-review-pr` review still runs.
- **Fail closed on downstream state.** When `--merge` is requested, social publishing and merged/green completion claims require terminal `Verdict=Approve`, `Merge=merged`, and `CI=green`; a blocked, red, pending, or unavailable tuple stops those actions. Without `--merge`, the existing Step 14 green-PR-check gate still owns social eligibility.
- **Dry-run has no delegation side effects.** `--dry-run` stops before `kongming`, `ak-review-pr`, or social publishing.

## Workflow Position

**Typically follows:** `/ak-code-review` (ship after review passes)
**Typically precedes:** `/ak-journal` (document after shipping)
**Related:** `/ak-code-review` (review before shipping), `/ak-test` (test before shipping)
